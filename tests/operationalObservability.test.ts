import { describe, expect, it } from 'vitest';
import {
  InMemoryOperationalTelemetryRepository,
  OperationalTelemetryService,
} from '../server/observability/operationalTelemetryService.js';
import {
  InMemoryResilienceStateRepository,
  OperationalGuardPolicy,
  OperationalResilienceService,
  SafeScopedCache,
  calculateBoundedBackoff,
} from '../server/observability/operationalResilienceService.js';

const fixedNow = new Date('2026-08-27T12:00:00.000Z');

function telemetryHarness() {
  const repository = new InMemoryOperationalTelemetryRepository();
  let sequence = 0;
  const service = new OperationalTelemetryService(
    repository,
    () => fixedNow,
    () => `event-${++sequence}`
  );
  return { repository, service };
}

describe('Operational telemetry without fabricated zeroes', () => {
  it('reports unobserved metrics as absent and null', async () => {
    const { service } = telemetryHarness();
    const snapshot = await service.snapshot({ durationMinutes: 60 });
    expect(snapshot.metrics.latencyP95).toEqual({
      status: 'absent',
      value: null,
      unit: 'ms',
      sampleCount: 0,
    });
    expect(snapshot.metrics.inputTokens.value).toBeNull();
    expect(snapshot.metrics.toolCalls.value).toBeNull();
    expect(snapshot.metrics.deploymentFailures.value).toBeNull();
  });

  it('aggregates latency, errors and availability from actual HTTP events', async () => {
    const { service } = telemetryHarness();
    for (const [durationMs, status] of [
      [100, 'success'],
      [200, 'success'],
      [900, 'error'],
    ] as const) {
      await service.record({
        category: 'http',
        operation: 'GET /api/projects',
        resource: '/api/projects',
        status,
        correlationId: `corr-${durationMs}`,
        durationMs,
        occurredAt: '2026-08-27T11:50:00.000Z',
      });
    }
    const snapshot = await service.snapshot({ durationMinutes: 60 });
    expect(snapshot.metrics.requestCount.value).toBe(3);
    expect(snapshot.metrics.latencyP50.value).toBe(200);
    expect(snapshot.metrics.latencyP95.value).toBe(900);
    expect(snapshot.metrics.errorRate.value).toBeCloseTo(1 / 3);
    expect(snapshot.metrics.availability.value).toBeCloseTo(2 / 3);
  });

  it('aggregates real tokens, credits, tools and retry rate by resource', async () => {
    const { service } = telemetryHarness();
    await service.record({
      category: 'ai',
      operation: 'ai.research',
      resource: 'ai-execution',
      status: 'success',
      correlationId: 'corr-ai',
      tenantId: 'tenant-acme',
      userId: 'user-a',
      inputTokens: 120,
      outputTokens: 80,
      costCredits: 10,
      occurredAt: '2026-08-27T11:45:00.000Z',
    });
    await service.record({
      category: 'tool',
      operation: 'tool.web-search',
      resource: 'web-search',
      status: 'success',
      correlationId: 'corr-tool',
      tenantId: 'tenant-acme',
      userId: 'user-a',
      attempts: 2,
      costCredits: 2,
      occurredAt: '2026-08-27T11:46:00.000Z',
    });
    const snapshot = await service.snapshot({
      durationMinutes: 60,
      tenantId: 'tenant-acme',
    });
    expect(snapshot.metrics.inputTokens.value).toBe(120);
    expect(snapshot.metrics.totalCostCredits.value).toBe(12);
    expect(snapshot.metrics.toolCalls.value).toBe(1);
    expect(snapshot.metrics.retryRate.value).toBe(1);
    expect(snapshot.costBreakdown).toHaveLength(2);
  });

  it('keeps tenant telemetry isolated in scoped snapshots', async () => {
    const { service } = telemetryHarness();
    for (const tenantId of ['tenant-a', 'tenant-b']) {
      await service.record({
        category: 'http',
        operation: 'GET /api/ready',
        resource: '/api/ready',
        status: 'success',
        correlationId: `corr-${tenantId}`,
        tenantId,
        durationMs: 20,
        occurredAt: '2026-08-27T11:40:00.000Z',
      });
    }
    const tenantA = await service.snapshot({
      durationMinutes: 60,
      tenantId: 'tenant-a',
    });
    expect(tenantA.metrics.requestCount.value).toBe(1);
    expect(tenantA.scope.tenantId).toBe('tenant-a');
  });

  it('computes response quality and memory precision only from observations', async () => {
    const { service } = telemetryHarness();
    await service.record({
      category: 'quality',
      operation: 'quality.response',
      resource: 'ai-response',
      status: 'success',
      correlationId: 'corr-quality',
      qualityScore: 0.8,
      occurredAt: '2026-08-27T11:30:00.000Z',
    });
    await service.record({
      category: 'memory',
      operation: 'memory.retrieve',
      resource: 'memory',
      status: 'success',
      correlationId: 'corr-memory',
      memoryRetrieved: 4,
      memoryRelevant: 3,
      occurredAt: '2026-08-27T11:31:00.000Z',
    });
    const snapshot = await service.snapshot({ durationMinutes: 60 });
    expect(snapshot.metrics.responseQuality.value).toBe(0.8);
    expect(snapshot.metrics.memoryPrecision.value).toBe(0.75);
  });

  it('creates alerts only when observed thresholds are breached', async () => {
    const { repository, service } = telemetryHarness();
    await service.record({
      category: 'http',
      operation: 'GET /api/fail',
      resource: '/api/fail',
      status: 'error',
      correlationId: 'corr-failure',
      durationMs: 3_000,
      occurredAt: '2026-08-27T11:50:00.000Z',
    });
    const snapshot = await service.snapshot({ durationMinutes: 60 });
    const alerts = await service.evaluateAndPersistAlerts(snapshot);
    expect(alerts.map((alert) => alert.code)).toEqual([
      'high_error_rate',
      'high_latency',
    ]);
    expect(repository.alerts).toHaveLength(2);
  });

  it('does not alert on an absent job or deployment metric', async () => {
    const { repository, service } = telemetryHarness();
    const snapshot = await service.snapshot({ durationMinutes: 60 });
    const alerts = await service.evaluateAndPersistAlerts(snapshot);
    expect(alerts).toEqual([]);
    expect(repository.alerts).toEqual([]);
  });

  it('rejects telemetry without a usable correlation id', async () => {
    const { service } = telemetryHarness();
    await expect(
      service.record({
        category: 'http',
        operation: 'GET /api/test',
        resource: '/api/test',
        status: 'success',
        correlationId: '',
      })
    ).rejects.toMatchObject({ code: 'invalid_telemetry_event' });
  });
});

describe('Budgets, quotas, circuit breaker, backoff and safe cache', () => {
  const scope = {
    tenantId: 'tenant-acme',
    userId: 'user-a',
    resource: 'gemini',
  };
  const policy: OperationalGuardPolicy = {
    quota: { windowMs: 60_000, maximumRequests: 2 },
    budget: { dailyCostMicros: 1_000, monthlyCostMicros: 5_000 },
    circuitBreaker: { failureThreshold: 2, openDurationMs: 30_000 },
  };

  it('enforces a distributed-style quota atomically through the repository', async () => {
    const service = new OperationalResilienceService(
      new InMemoryResilienceStateRepository(),
      () => fixedNow.getTime()
    );
    expect(
      (await service.authorize({ scope, policy, estimatedCostMicros: 100 })).allowed
    ).toBe(true);
    expect(
      (await service.authorize({ scope, policy, estimatedCostMicros: 100 })).allowed
    ).toBe(true);
    const denied = await service.authorize({ scope, policy, estimatedCostMicros: 100 });
    expect(denied.code).toBe('quota_exceeded');
    expect(denied.retryAt).not.toBeNull();
  });

  it('blocks an estimated cost that exceeds the daily budget', async () => {
    const service = new OperationalResilienceService(
      new InMemoryResilienceStateRepository(),
      () => fixedNow.getTime()
    );
    const denied = await service.authorize({
      scope,
      policy,
      estimatedCostMicros: 1_001,
    });
    expect(denied).toMatchObject({
      allowed: false,
      code: 'daily_budget_exceeded',
    });
  });

  it('opens the circuit after repeated provider failures', async () => {
    let nowMs = fixedNow.getTime();
    const service = new OperationalResilienceService(
      new InMemoryResilienceStateRepository(),
      () => nowMs
    );
    for (let failure = 0; failure < 2; failure += 1) {
      await service.authorize({ scope, policy, estimatedCostMicros: 10 });
      await service.recordOutcome({
        scope,
        policy,
        success: false,
        reservedCostMicros: 10,
        actualCostMicros: 0,
      });
    }
    const blocked = await service.authorize({
      scope,
      policy,
      estimatedCostMicros: 10,
    });
    expect(blocked.code).toBe('circuit_open');
    nowMs += 31_000;
    const probe = await service.authorize({
      scope,
      policy: {
        ...policy,
        quota: { ...policy.quota, maximumRequests: 10 },
      },
      estimatedCostMicros: 10,
    });
    expect(probe.allowed).toBe(true);
    expect(probe.circuitState).toBe('half-open');
  });

  it('uses bounded exponential backoff with deterministic jitter in tests', () => {
    expect(
      calculateBoundedBackoff({
        attempt: 3,
        baseMs: 100,
        maximumMs: 1_000,
        jitterFraction: 0.2,
        random: () => 0.5,
      })
    ).toBe(400);
    expect(
      calculateBoundedBackoff({
        attempt: 10,
        baseMs: 100,
        maximumMs: 1_000,
        jitterFraction: 0,
      })
    ).toBe(1_000);
  });

  it('isolates cache entries by tenant and user and verifies content hashes', () => {
    const cache = new SafeScopedCache<{ result: string }>(
      () => fixedNow.getTime()
    );
    const contentHash = cache.set({
      scope,
      cacheKey: 'answer',
      value: { result: 'approved' },
      ttlMs: 60_000,
    });
    expect(cache.get({ scope, cacheKey: 'answer', expectedContentHash: contentHash }))
      .toEqual({ result: 'approved' });
    expect(
      cache.get({
        scope: { ...scope, userId: 'user-b' },
        cacheKey: 'answer',
      })
    ).toBeNull();
    expect(
      cache.get({ scope, cacheKey: 'answer', expectedContentHash: '0'.repeat(64) })
    ).toBeNull();
  });

  it('refuses to cache data explicitly marked as sensitive', () => {
    const cache = new SafeScopedCache<string>();
    expect(() =>
      cache.set({
        scope,
        cacheKey: 'secret',
        value: 'private',
        ttlMs: 1_000,
        containsSensitiveData: true,
      })
    ).toThrow(/sensíveis/i);
  });
});
