import crypto from 'node:crypto';
import {
  adminDb,
  isFirebaseAdminConfigured,
} from '../lib/firebaseAdmin.js';

export type OperationalEventCategory =
  | 'http'
  | 'ai'
  | 'tool'
  | 'memory'
  | 'deployment'
  | 'job'
  | 'quality';

export interface OperationalEventInput {
  category: OperationalEventCategory;
  operation: string;
  resource: string;
  status: 'success' | 'error' | 'blocked';
  correlationId: string;
  traceId?: string | null;
  spanId?: string | null;
  parentSpanId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  projectId?: string | null;
  durationMs?: number | null;
  errorCode?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  costMicros?: number | null;
  costCredits?: number | null;
  attempts?: number | null;
  qualityScore?: number | null;
  memoryRetrieved?: number | null;
  memoryRelevant?: number | null;
  deploymentState?: string | null;
  jobState?: string | null;
  provider?: string | null;
  model?: string | null;
  toolName?: string | null;
  cacheStatus?: 'hit' | 'miss' | 'bypass' | null;
  occurredAt?: string;
}

export interface OperationalEvent extends OperationalEventInput {
  eventId: string;
  occurredAt: string;
  occurredAtMs: number;
}

export interface OperationalAlert {
  alertId: string;
  code:
    | 'high_error_rate'
    | 'high_latency'
    | 'stuck_jobs'
    | 'deployment_failures'
    | 'budget_pressure';
  severity: 'warning' | 'critical';
  status: 'firing';
  metric: string;
  observedValue: number;
  threshold: number;
  windowStart: string;
  windowEnd: string;
  tenantId: string | null;
  runbook: string;
  createdAt: string;
}

export interface OperationalTelemetryRepository {
  append(event: OperationalEvent): Promise<void>;
  query(input: {
    sinceMs: number;
    untilMs: number;
    tenantId?: string;
    limit: number;
  }): Promise<OperationalEvent[]>;
  saveAlerts(alerts: OperationalAlert[]): Promise<void>;
  listAlerts(input: {
    sinceMs: number;
    tenantId?: string;
    limit: number;
  }): Promise<OperationalAlert[]>;
}

export interface MetricValue {
  status: 'available' | 'absent';
  value: number | null;
  unit: 'count' | 'ms' | 'ratio' | 'tokens' | 'micros' | 'credits' | 'score';
  sampleCount: number;
}

export interface OperationalSnapshot {
  window: {
    start: string;
    end: string;
    durationMinutes: number;
  };
  scope: {
    tenantId: string | null;
  };
  metrics: {
    requestCount: MetricValue;
    latencyP50: MetricValue;
    latencyP95: MetricValue;
    errorRate: MetricValue;
    availability: MetricValue;
    inputTokens: MetricValue;
    outputTokens: MetricValue;
    cachedTokens: MetricValue;
    totalCostMicros: MetricValue;
    totalCostCredits: MetricValue;
    toolCalls: MetricValue;
    retryRate: MetricValue;
    stuckJobs: MetricValue;
    responseQuality: MetricValue;
    memoryPrecision: MetricValue;
    deploymentFailures: MetricValue;
    cacheHitRate: MetricValue;
  };
  costBreakdown: Array<{
    tenantId: string | null;
    userId: string | null;
    resource: string;
    costMicros: number;
    costCredits: number;
    samples: number;
  }>;
  generatedAt: string;
  truncated: boolean;
}

export class OperationalTelemetryError extends Error {
  constructor(
    readonly code:
      | 'invalid_telemetry_event'
      | 'telemetry_repository_unavailable'
      | 'invalid_snapshot_window',
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = 'OperationalTelemetryError';
  }
}

const SENSITIVE_PATTERN =
  /(authorization|cookie|password|secret|token(?!s$)|api[-_]?key|private[-_]?key|email|phone)/i;

function safeDimension(value: unknown, maximum = 160): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .normalize('NFKC')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maximum);
  if (!normalized || SENSITIVE_PATTERN.test(normalized)) return null;
  return normalized;
}

function nullableNumber(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < minimum || value > maximum) return null;
  return value;
}

function cloneEvent(event: OperationalEvent): OperationalEvent {
  return structuredClone(event);
}

export class InMemoryOperationalTelemetryRepository
  implements OperationalTelemetryRepository
{
  readonly events: OperationalEvent[] = [];
  readonly alerts: OperationalAlert[] = [];

  async append(event: OperationalEvent): Promise<void> {
    this.events.push(cloneEvent(event));
  }

  async query(input: {
    sinceMs: number;
    untilMs: number;
    tenantId?: string;
    limit: number;
  }): Promise<OperationalEvent[]> {
    return this.events
      .filter(
        (event) =>
          event.occurredAtMs >= input.sinceMs &&
          event.occurredAtMs <= input.untilMs &&
          (!input.tenantId || event.tenantId === input.tenantId)
      )
      .sort((left, right) => right.occurredAtMs - left.occurredAtMs)
      .slice(0, input.limit)
      .map(cloneEvent);
  }

  async saveAlerts(alerts: OperationalAlert[]): Promise<void> {
    for (const alert of alerts) {
      if (!this.alerts.some((current) => current.alertId === alert.alertId)) {
        this.alerts.push(structuredClone(alert));
      }
    }
  }

  async listAlerts(input: {
    sinceMs: number;
    tenantId?: string;
    limit: number;
  }): Promise<OperationalAlert[]> {
    return this.alerts
      .filter(
        (alert) =>
          new Date(alert.createdAt).getTime() >= input.sinceMs &&
          (!input.tenantId || alert.tenantId === input.tenantId)
      )
      .slice(-input.limit)
      .reverse()
      .map((alert) => structuredClone(alert));
  }
}

export class FirestoreOperationalTelemetryRepository
  implements OperationalTelemetryRepository
{
  async append(event: OperationalEvent): Promise<void> {
    await adminDb
      .collection('operational_telemetry_events')
      .doc(event.eventId)
      .create(event);
  }

  async query(input: {
    sinceMs: number;
    untilMs: number;
    tenantId?: string;
    limit: number;
  }): Promise<OperationalEvent[]> {
    let query: FirebaseFirestore.Query = adminDb
      .collection('operational_telemetry_events')
      .where('occurredAtMs', '>=', input.sinceMs)
      .where('occurredAtMs', '<=', input.untilMs);
    if (input.tenantId) {
      query = query.where('tenantId', '==', input.tenantId);
    }
    const snapshot = await query
      .orderBy('occurredAtMs', 'desc')
      .limit(input.limit)
      .get();
    return snapshot.docs.map((document) => document.data() as OperationalEvent);
  }

  async saveAlerts(alerts: OperationalAlert[]): Promise<void> {
    if (alerts.length === 0) return;
    const batch = adminDb.batch();
    for (const alert of alerts) {
      batch.set(
        adminDb.collection('operational_alerts').doc(alert.alertId),
        alert,
        { merge: false }
      );
    }
    await batch.commit();
  }

  async listAlerts(input: {
    sinceMs: number;
    tenantId?: string;
    limit: number;
  }): Promise<OperationalAlert[]> {
    let query: FirebaseFirestore.Query = adminDb
      .collection('operational_alerts')
      .where('createdAt', '>=', new Date(input.sinceMs).toISOString());
    if (input.tenantId) {
      query = query.where('tenantId', '==', input.tenantId);
    }
    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(input.limit)
      .get();
    return snapshot.docs.map((document) => document.data() as OperationalAlert);
  }
}

function available(
  value: number,
  unit: MetricValue['unit'],
  sampleCount: number
): MetricValue {
  return { status: 'available', value, unit, sampleCount };
}

function absent(unit: MetricValue['unit']): MetricValue {
  return { status: 'absent', value: null, unit, sampleCount: 0 };
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  );
  return sorted[index];
}

function ratio(numerator: number, denominator: number): MetricValue {
  return denominator > 0
    ? available(numerator / denominator, 'ratio', denominator)
    : absent('ratio');
}

function sumMetric(
  values: Array<number | null | undefined>,
  unit: MetricValue['unit']
): MetricValue {
  const observed = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  return observed.length > 0
    ? available(
        observed.reduce((total, value) => total + value, 0),
        unit,
        observed.length
      )
    : absent(unit);
}

export class OperationalTelemetryService {
  constructor(
    private readonly repository: OperationalTelemetryRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = crypto.randomUUID
  ) {}

  static createDefault(): OperationalTelemetryService {
    if (isFirebaseAdminConfigured()) {
      return new OperationalTelemetryService(
        new FirestoreOperationalTelemetryRepository()
      );
    }
    if (process.env.NODE_ENV === 'production') {
      throw new OperationalTelemetryError(
        'telemetry_repository_unavailable',
        'Firestore não está configurado para telemetria operacional.',
        503
      );
    }
    return new OperationalTelemetryService(
      new InMemoryOperationalTelemetryRepository()
    );
  }

  async record(input: OperationalEventInput): Promise<OperationalEvent> {
    const occurredAt = input.occurredAt || this.now().toISOString();
    const occurredAtMs = new Date(occurredAt).getTime();
    const operation = safeDimension(input.operation, 200);
    const resource = safeDimension(input.resource, 240);
    const correlationId = safeDimension(input.correlationId, 160);
    if (!operation || !resource || !correlationId || Number.isNaN(occurredAtMs)) {
      throw new OperationalTelemetryError(
        'invalid_telemetry_event',
        'Evento operacional inválido ou sem correlação.',
        400
      );
    }
    const event: OperationalEvent = {
      eventId: this.createId(),
      category: input.category,
      operation,
      resource,
      status: input.status,
      correlationId,
      traceId: safeDimension(input.traceId),
      spanId: safeDimension(input.spanId),
      parentSpanId: safeDimension(input.parentSpanId),
      tenantId: safeDimension(input.tenantId),
      userId: safeDimension(input.userId),
      projectId: safeDimension(input.projectId),
      durationMs: nullableNumber(input.durationMs, 0, 86_400_000),
      errorCode: safeDimension(input.errorCode),
      inputTokens: nullableNumber(input.inputTokens),
      outputTokens: nullableNumber(input.outputTokens),
      cachedTokens: nullableNumber(input.cachedTokens),
      costMicros: nullableNumber(input.costMicros),
      costCredits: nullableNumber(input.costCredits),
      attempts: nullableNumber(input.attempts, 1, 100),
      qualityScore: nullableNumber(input.qualityScore, 0, 1),
      memoryRetrieved: nullableNumber(input.memoryRetrieved),
      memoryRelevant: nullableNumber(input.memoryRelevant),
      deploymentState: safeDimension(input.deploymentState),
      jobState: safeDimension(input.jobState),
      provider: safeDimension(input.provider),
      model: safeDimension(input.model),
      toolName: safeDimension(input.toolName),
      cacheStatus: input.cacheStatus || null,
      occurredAt,
      occurredAtMs,
    };
    await this.repository.append(event);
    return cloneEvent(event);
  }

  async snapshot(input: {
    durationMinutes: number;
    tenantId?: string;
    until?: Date;
  }): Promise<OperationalSnapshot> {
    if (
      !Number.isInteger(input.durationMinutes) ||
      input.durationMinutes < 1 ||
      input.durationMinutes > 43_200
    ) {
      throw new OperationalTelemetryError(
        'invalid_snapshot_window',
        'A janela precisa ter entre 1 minuto e 30 dias.',
        400
      );
    }
    const until = input.until || this.now();
    const untilMs = until.getTime();
    const sinceMs = untilMs - input.durationMinutes * 60_000;
    const limit = 10_000;
    const events = await this.repository.query({
      sinceMs,
      untilMs,
      tenantId: input.tenantId,
      limit,
    });
    const httpEvents = events.filter((event) => event.category === 'http');
    const durations = httpEvents
      .map((event) => event.durationMs)
      .filter((value): value is number => typeof value === 'number');
    const errors = httpEvents.filter((event) => event.status === 'error').length;
    const tokenEvents = events.filter((event) => event.category === 'ai');
    const toolEvents = events.filter((event) => event.category === 'tool');
    const jobEvents = events.filter((event) => event.category === 'job');
    const quality = events
      .map((event) => event.qualityScore)
      .filter((value): value is number => typeof value === 'number');
    const memoryEvents = events.filter(
      (event) =>
        event.category === 'memory' &&
        typeof event.memoryRetrieved === 'number' &&
        typeof event.memoryRelevant === 'number'
    );
    const cacheEvents = events.filter(
      (event) => event.cacheStatus === 'hit' || event.cacheStatus === 'miss'
    );
    const deploymentEvents = events.filter(
      (event) => event.category === 'deployment'
    );
    const breakdown = new Map<
      string,
      {
        tenantId: string | null;
        userId: string | null;
        resource: string;
        costMicros: number;
        costCredits: number;
        samples: number;
      }
    >();
    for (const event of events) {
      if (
        typeof event.costMicros !== 'number' &&
        typeof event.costCredits !== 'number'
      ) continue;
      const key = `${event.tenantId || '-'}:${event.userId || '-'}:${event.resource}`;
      const current = breakdown.get(key) || {
        tenantId: event.tenantId || null,
        userId: event.userId || null,
        resource: event.resource,
        costMicros: 0,
        costCredits: 0,
        samples: 0,
      };
      current.costMicros += event.costMicros || 0;
      current.costCredits += event.costCredits || 0;
      current.samples += 1;
      breakdown.set(key, current);
    }
    const snapshot: OperationalSnapshot = {
      window: {
        start: new Date(sinceMs).toISOString(),
        end: new Date(untilMs).toISOString(),
        durationMinutes: input.durationMinutes,
      },
      scope: { tenantId: input.tenantId || null },
      metrics: {
        requestCount: available(httpEvents.length, 'count', httpEvents.length),
        latencyP50:
          durations.length > 0
            ? available(percentile(durations, 0.5), 'ms', durations.length)
            : absent('ms'),
        latencyP95:
          durations.length > 0
            ? available(percentile(durations, 0.95), 'ms', durations.length)
            : absent('ms'),
        errorRate: ratio(errors, httpEvents.length),
        availability: ratio(httpEvents.length - errors, httpEvents.length),
        inputTokens: sumMetric(
          tokenEvents.map((event) => event.inputTokens),
          'tokens'
        ),
        outputTokens: sumMetric(
          tokenEvents.map((event) => event.outputTokens),
          'tokens'
        ),
        cachedTokens: sumMetric(
          tokenEvents.map((event) => event.cachedTokens),
          'tokens'
        ),
        totalCostMicros: sumMetric(
          events.map((event) => event.costMicros),
          'micros'
        ),
        totalCostCredits: sumMetric(
          events.map((event) => event.costCredits),
          'credits'
        ),
        toolCalls:
          toolEvents.length > 0
            ? available(toolEvents.length, 'count', toolEvents.length)
            : absent('count'),
        retryRate: ratio(
          toolEvents.filter((event) => Number(event.attempts || 1) > 1).length,
          toolEvents.length
        ),
        stuckJobs:
          jobEvents.length > 0
            ? available(
                jobEvents.filter((event) => event.jobState === 'stuck').length,
                'count',
                jobEvents.length
              )
            : absent('count'),
        responseQuality:
          quality.length > 0
            ? available(
                quality.reduce((total, value) => total + value, 0) / quality.length,
                'score',
                quality.length
              )
            : absent('score'),
        memoryPrecision:
          memoryEvents.length > 0
            ? ratio(
                memoryEvents.reduce(
                  (total, event) => total + Number(event.memoryRelevant),
                  0
                ),
                memoryEvents.reduce(
                  (total, event) => total + Number(event.memoryRetrieved),
                  0
                )
              )
            : absent('ratio'),
        deploymentFailures:
          deploymentEvents.length > 0
            ? available(
                deploymentEvents.filter((event) => event.status === 'error').length,
                'count',
                deploymentEvents.length
              )
            : absent('count'),
        cacheHitRate: ratio(
          cacheEvents.filter((event) => event.cacheStatus === 'hit').length,
          cacheEvents.length
        ),
      },
      costBreakdown: [...breakdown.values()].sort(
        (left, right) =>
          right.costMicros - left.costMicros ||
          right.costCredits - left.costCredits
      ),
      generatedAt: this.now().toISOString(),
      truncated: events.length === limit,
    };
    return snapshot;
  }

  async evaluateAndPersistAlerts(
    snapshot: OperationalSnapshot
  ): Promise<OperationalAlert[]> {
    const definitions: Array<{
      code: OperationalAlert['code'];
      metric: keyof OperationalSnapshot['metrics'];
      threshold: number;
      severity: OperationalAlert['severity'];
      runbook: string;
    }> = [
      {
        code: 'high_error_rate',
        metric: 'errorRate',
        threshold: 0.05,
        severity: 'critical',
        runbook: 'audit-evidence/runbooks/high-error-rate.md',
      },
      {
        code: 'high_latency',
        metric: 'latencyP95',
        threshold: 2_000,
        severity: 'warning',
        runbook: 'audit-evidence/runbooks/high-latency.md',
      },
      {
        code: 'stuck_jobs',
        metric: 'stuckJobs',
        threshold: 0,
        severity: 'critical',
        runbook: 'audit-evidence/runbooks/stuck-jobs.md',
      },
      {
        code: 'deployment_failures',
        metric: 'deploymentFailures',
        threshold: 0,
        severity: 'critical',
        runbook: 'audit-evidence/runbooks/deployment-failure.md',
      },
    ];
    const alerts = definitions.flatMap((definition) => {
      const metric = snapshot.metrics[definition.metric];
      if (metric.status === 'absent' || metric.value === null) return [];
      if (metric.value <= definition.threshold) return [];
      const stableKey = [
        definition.code,
        snapshot.scope.tenantId || 'global',
        snapshot.window.start,
        snapshot.window.end,
      ].join(':');
      const alert: OperationalAlert = {
        alertId: crypto.createHash('sha256').update(stableKey).digest('hex'),
        code: definition.code,
        severity: definition.severity,
        status: 'firing',
        metric: definition.metric,
        observedValue: metric.value,
        threshold: definition.threshold,
        windowStart: snapshot.window.start,
        windowEnd: snapshot.window.end,
        tenantId: snapshot.scope.tenantId,
        runbook: definition.runbook,
        createdAt: this.now().toISOString(),
      };
      return [alert];
    });
    await this.repository.saveAlerts(alerts);
    return alerts;
  }

  async listAlerts(input: {
    durationMinutes: number;
    tenantId?: string;
    limit?: number;
  }): Promise<OperationalAlert[]> {
    return this.repository.listAlerts({
      sinceMs: this.now().getTime() - input.durationMinutes * 60_000,
      tenantId: input.tenantId,
      limit: Math.min(200, Math.max(1, input.limit || 50)),
    });
  }
}
