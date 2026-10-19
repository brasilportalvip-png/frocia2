import { createHash, randomBytes } from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import type { OperationalEvent } from '../observability/operationalTelemetryService.js';
import type { ImprovementCandidate } from './selfEvolutionTypes.js';
import { SelfEvolutionPolicyEngine } from './selfEvolutionPolicyEngine.js';

// Producao: apenas dados medidos; nao inventar problemas na ausencia de telemetria.
const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEDUP_MS = 14 * WINDOW_MS;
const MAX_EVENTS = 1000;
const MIN_OBSERVATIONS = 10;
const MIN_FAILURES = 5;
const MIN_ERROR_RATE = 0.25;

// Arquivos existentes no repositorio, mapeados por dominio conhecido.
// A correspondencia indica area de investigacao, NAO causa raiz confirmada.
const HTTP_SCOPES: ReadonlyArray<readonly [string, string]> = [
  ['/api/conversations', 'server/routes/conversationRoutes.ts'],
  ['/api/projects', 'server/routes/projectRoutes.ts'],
  ['/api/tools', 'server/routes/toolRoutes.ts'],
  ['/api/memories', 'server/routes/memoryRoutes.ts'],
  ['/api/site-audits', 'server/routes/siteAuditRoutes.ts'],
  ['/api/site-factory', 'server/routes/siteFactoryRoutes.ts'],
  ['/api/social-search', 'server/routes/socialSearchRoutes.ts'],
  ['/api/ai/media', 'server/routes/mediaRoutes.ts'],
];
const CATEGORY_SCOPES: Readonly<Record<string, string>> = {
  ai: 'server/ai/requestOrchestrator.ts',
  tool: 'server/ai/toolExecutionService.ts',
  job: 'server/ai/durableExecutionService.ts',
};

export interface OperationalProblemPattern {
  category: string;
  operation: string;
  probableFile: string;
  signature: string;
  failureCount: number;
  observationCount: number;
  affectedUsersCount: number;
  errorRate: number;
  eventIds: string[];
}

function eligibleScope(event: OperationalEvent): { probableFile: string; safeOperation: string } | null {
  if (typeof event.operation !== 'string' ||
      !/^[\w\-.:/ ]{1,100}$/.test(event.operation) ||
      /secret|password|token|credential|api.?key/i.test(event.operation)) {
    return null;
  }

  if (event.category !== 'http') {
    const probableFile = CATEGORY_SCOPES[event.category];
    return probableFile ? { probableFile, safeOperation: event.operation } : null;
  }

  // Erros HTTP 4xx (incluindo falta de login) nao sao defeitos confirmados.
  const pathMatch = event.operation.match(/^(GET|POST|PUT|PATCH|DELETE) (\/api\/[\w/.:\-]+)$/);
  if (!pathMatch || pathMatch[2].includes('/admin/') ||
      pathMatch[2].startsWith('/api/internal/')) {
    return null;
  }
  const path = pathMatch[2];
  const match = HTTP_SCOPES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  if (!match) return null;
  // Nunca copiar parametros de caminho HTTP para a fila de melhorias.
  return { probableFile: match[1], safeOperation: `${pathMatch[1]} ${match[0]}` };
}

export function detectRecurringOperationalFailures(
  events: readonly OperationalEvent[],
  nowMs: number = Date.now()
): OperationalProblemPattern[] {
  const groups = new Map<string, {
    category: string; operation: string; probableFile: string;
    observations: number; failures: number;
    correlationIds: Set<string>; userIds: Set<string>; eventIds: string[];
  }>();

  for (const event of events) {
    if (!Number.isFinite(event.occurredAtMs) ||
        event.occurredAtMs < nowMs - WINDOW_MS || event.occurredAtMs > nowMs ||
        (event.status !== 'success' && event.status !== 'error')) {
      continue;
    }
    const scope = eligibleScope(event);
    if (!scope) continue;
    const { probableFile, safeOperation } = scope;

    const isFailure = event.status === 'error' && (
      event.category !== 'http' || /^http_5\d\d$/.test(event.errorCode || '')
    );
    const key = `${event.category}|${safeOperation}|${probableFile}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        category: event.category, operation: safeOperation, probableFile,
        observations: 0, failures: 0, correlationIds: new Set(),
        userIds: new Set(), eventIds: [],
      };
      groups.set(key, group);
    }
    group.observations += 1;
    if (isFailure && typeof event.correlationId === 'string' &&
        event.correlationId !== 'missing-correlation-id') {
      group.failures += 1;
      group.correlationIds.add(event.correlationId);
      if (event.userId) group.userIds.add(event.userId);
      // Persistir apenas IDs de eventos; nunca payload, URL de usuario ou segredo.
      if (typeof event.eventId === 'string' &&
          /^[a-zA-Z0-9-]{8,100}$/.test(event.eventId) &&
          group.eventIds.length < 8) {
        group.eventIds.push(event.eventId);
      }
    }
  }

  return [...groups.values()]
    .filter((g) => g.observations >= MIN_OBSERVATIONS &&
      g.failures >= MIN_FAILURES &&
      g.correlationIds.size >= MIN_FAILURES &&
      g.failures / g.observations >= MIN_ERROR_RATE &&
      g.eventIds.length > 0)
    .map((g) => ({
      category: g.category,
      operation: g.operation,
      probableFile: g.probableFile,
      signature: createHash('sha256').update(`${g.category}|${g.operation}|${g.probableFile}`).digest('hex'),
      failureCount: g.failures,
      observationCount: g.observations,
      affectedUsersCount: g.userIds.size,
      errorRate: g.failures / g.observations,
      eventIds: g.eventIds,
    }))
    .sort((a, b) => (b.failureCount * b.errorRate) - (a.failureCount * a.errorRate));
}

export interface DiscoveryOutcome {
  status: 'no_evidence' | 'created' | 'duplicate' | 'insufficient_data';
  candidateId?: string;
  evidenceCount: number;
}

export class OperationalAutoDiscoveryService {
  static async discoverOne(now: Date = new Date()): Promise<DiscoveryOutcome> {
    if (!isFirebaseAdminConfigured()) {
      throw new Error('Autodescoberta exige Firestore Admin persistente.');
    }
    if (!(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted())) {
      return { status: 'no_evidence', evidenceCount: 0 };
    }

    const nowMs = now.getTime();
    const snapshot = await adminDb.collection('operational_telemetry_events')
      .where('occurredAtMs', '>=', nowMs - WINDOW_MS)
      .orderBy('occurredAtMs', 'desc')
      .limit(MAX_EVENTS)
      .get();

    // Nao calcular taxa de erros com amostragem truncada/viesada.
    if (snapshot.size === MAX_EVENTS) {
      return { status: 'insufficient_data', evidenceCount: snapshot.size };
    }
    const patterns = detectRecurringOperationalFailures(
      snapshot.docs.map((document) => document.data() as OperationalEvent), nowMs
    );
    if (patterns.length === 0) {
      return { status: 'no_evidence', evidenceCount: snapshot.size };
    }

    // No maximo um novo candidato por ciclo; controle de duplicacao transacional.
    for (const pattern of patterns.slice(0, 5)) {
      const signatureRef = adminDb.collection('self_evolution_discovery_signatures').doc(pattern.signature);
      const id = `cand-${nowMs}-${randomBytes(3).toString('hex')}`;
      const level = SelfEvolutionPolicyEngine.classifyRisk([pattern.probableFile]);
      const nowIso = now.toISOString();
      const candidate: ImprovementCandidate = {
        id,
        title: `Investigar falhas recorrentes: ${pattern.operation}`.slice(0, 160),
        summary: `${pattern.failureCount} erros em ${pattern.observationCount} eventos ` +
          `(taxa ${(pattern.errorRate * 100).toFixed(1)}%) nas ultimas 24h. ` +
          'A causa raiz ainda precisa ser comprovada pelo agente em testes.',
        evidence: [
          `Fonte: operational_telemetry_events; janela: 24h; grupo: ${pattern.category}/${pattern.operation}`,
          `Falhas: ${pattern.failureCount}; total: ${pattern.observationCount}; taxa: ${pattern.errorRate.toFixed(4)}`,
          ...pattern.eventIds.map((eventId) => `operational_telemetry_events/${eventId}`),
        ],
        frequency: pattern.failureCount,
        affectedUsersCount: pattern.affectedUsersCount,
        severity: pattern.errorRate >= 0.5 ? 'high' : 'medium',
        confidence: 0.8,
        affectedComponents: [pattern.category, pattern.operation],
        probableFiles: [pattern.probableFile],
        hypothesis: `Existe falha recorrente observada em ${pattern.operation}; causa raiz nao identificada.`,
        expectedBehavior: `A operacao ${pattern.operation} deve concluir sem falhas de servidor recorrentes.`,
        riskLevel: level,
        estimatedCostCredits: 10,
        testPlan: 'Reproduzir os erros a partir dos eventos, adicionar teste de regressao, executar lint, testes e build.',
        rollbackStrategy: 'Reverter o commit e restaurar a ultima versao estavel.',
        duplicates: [],
        requiresApproval: level === 'R2' || level === 'R3',
        state: 'detected',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const created = await adminDb.runTransaction(async (transaction) => {
        const previous = await transaction.get(signatureRef);
        const lastId = previous.data()?.candidateId;
        if (typeof lastId === 'string' && lastId.length > 0) {
          const priorCandidate = await transaction.get(
            adminDb.collection('self_evolution_candidates').doc(lastId)
          );
          const priorState = priorCandidate.data()?.state;
          const terminal = new Set(['accepted', 'rejected', 'cancelled', 'failed',
            'rolled_back', 'tests_failed', 'ci_failed', 'preview_failed', 'duplicate']);
          if (priorCandidate.exists && !terminal.has(priorState)) return false;
          const lastCreatedAtMs = Number(previous.data()?.lastCreatedAtMs || 0);
          if (lastCreatedAtMs > nowMs - DEDUP_MS) return false;
        }
        transaction.create(adminDb.collection('self_evolution_candidates').doc(id), candidate);
        transaction.set(signatureRef, { candidateId: id, lastCreatedAtMs: nowMs,
          category: pattern.category, operation: pattern.operation });
        return true;
      });
      if (created) return { status: 'created', candidateId: id, evidenceCount: snapshot.size };
    }
    return { status: 'duplicate', evidenceCount: snapshot.size };
  }
}
