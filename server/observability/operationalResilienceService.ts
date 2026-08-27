import crypto from 'node:crypto';
import {
  adminDb,
  isFirebaseAdminConfigured,
} from '../lib/firebaseAdmin.js';

export interface OperationalScope {
  tenantId: string;
  userId: string;
  resource: string;
}

export interface OperationalGuardPolicy {
  quota: {
    windowMs: number;
    maximumRequests: number;
  };
  budget: {
    dailyCostMicros: number;
    monthlyCostMicros: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    openDurationMs: number;
  };
}

export interface CircuitState {
  state: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  openedAtMs: number | null;
  probeInFlight: boolean;
}

export interface GuardDecision {
  allowed: boolean;
  code:
    | 'allowed'
    | 'quota_exceeded'
    | 'daily_budget_exceeded'
    | 'monthly_budget_exceeded'
    | 'circuit_open';
  retryAt: string | null;
  quotaRemaining: number;
  dailyBudgetRemainingMicros: number;
  monthlyBudgetRemainingMicros: number;
  circuitState: CircuitState['state'];
}

export interface ResilienceStateRepository {
  authorize(input: {
    scope: OperationalScope;
    policy: OperationalGuardPolicy;
    estimatedCostMicros: number;
    nowMs: number;
  }): Promise<GuardDecision>;
  recordOutcome(input: {
    scope: OperationalScope;
    policy: OperationalGuardPolicy;
    success: boolean;
    reservedCostMicros: number;
    actualCostMicros: number;
    nowMs: number;
  }): Promise<CircuitState>;
}

interface LocalState {
  quotaCount: number;
  quotaResetAtMs: number;
  dailyKey: string;
  dailyUsedMicros: number;
  monthlyKey: string;
  monthlyUsedMicros: number;
  reservedMicros: number;
  circuit: CircuitState;
}

function stateKey(scope: OperationalScope): string {
  return crypto
    .createHash('sha256')
    .update(`${scope.tenantId}:${scope.userId}:${scope.resource}`)
    .digest('hex');
}

function dateKeys(nowMs: number): { day: string; month: string } {
  const iso = new Date(nowMs).toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

function initialState(nowMs: number): LocalState {
  const keys = dateKeys(nowMs);
  return {
    quotaCount: 0,
    quotaResetAtMs: nowMs,
    dailyKey: keys.day,
    dailyUsedMicros: 0,
    monthlyKey: keys.month,
    monthlyUsedMicros: 0,
    reservedMicros: 0,
    circuit: {
      state: 'closed',
      consecutiveFailures: 0,
      openedAtMs: null,
      probeInFlight: false,
    },
  };
}

function refreshState(
  current: LocalState,
  policy: OperationalGuardPolicy,
  nowMs: number
): LocalState {
  const keys = dateKeys(nowMs);
  const next = structuredClone(current);
  if (next.quotaResetAtMs <= nowMs) {
    next.quotaCount = 0;
    next.quotaResetAtMs = nowMs + policy.quota.windowMs;
  }
  if (next.dailyKey !== keys.day) {
    next.dailyKey = keys.day;
    next.dailyUsedMicros = 0;
    next.reservedMicros = 0;
  }
  if (next.monthlyKey !== keys.month) {
    next.monthlyKey = keys.month;
    next.monthlyUsedMicros = 0;
  }
  if (
    next.circuit.state === 'open' &&
    next.circuit.openedAtMs !== null &&
    next.circuit.openedAtMs + policy.circuitBreaker.openDurationMs <= nowMs
  ) {
    next.circuit.state = 'half-open';
    next.circuit.probeInFlight = false;
  }
  return next;
}

function authorizeState(input: {
  current: LocalState;
  policy: OperationalGuardPolicy;
  estimatedCostMicros: number;
  nowMs: number;
}): { decision: GuardDecision; next: LocalState } {
  const next = refreshState(input.current, input.policy, input.nowMs);
  const circuit = next.circuit;
  if (
    circuit.state === 'open' ||
    (circuit.state === 'half-open' && circuit.probeInFlight)
  ) {
    const retryAt =
      circuit.openedAtMs === null
        ? input.nowMs + input.policy.circuitBreaker.openDurationMs
        : circuit.openedAtMs + input.policy.circuitBreaker.openDurationMs;
    return {
      next,
      decision: {
        allowed: false,
        code: 'circuit_open',
        retryAt: new Date(retryAt).toISOString(),
        quotaRemaining: Math.max(
          0,
          input.policy.quota.maximumRequests - next.quotaCount
        ),
        dailyBudgetRemainingMicros: Math.max(
          0,
          input.policy.budget.dailyCostMicros -
            next.dailyUsedMicros -
            next.reservedMicros
        ),
        monthlyBudgetRemainingMicros: Math.max(
          0,
          input.policy.budget.monthlyCostMicros -
            next.monthlyUsedMicros -
            next.reservedMicros
        ),
        circuitState: circuit.state,
      },
    };
  }
  if (next.quotaCount >= input.policy.quota.maximumRequests) {
    return {
      next,
      decision: {
        allowed: false,
        code: 'quota_exceeded',
        retryAt: new Date(next.quotaResetAtMs).toISOString(),
        quotaRemaining: 0,
        dailyBudgetRemainingMicros: Math.max(
          0,
          input.policy.budget.dailyCostMicros - next.dailyUsedMicros - next.reservedMicros
        ),
        monthlyBudgetRemainingMicros: Math.max(
          0,
          input.policy.budget.monthlyCostMicros - next.monthlyUsedMicros - next.reservedMicros
        ),
        circuitState: circuit.state,
      },
    };
  }
  const dailyProjected =
    next.dailyUsedMicros + next.reservedMicros + input.estimatedCostMicros;
  if (dailyProjected > input.policy.budget.dailyCostMicros) {
    return {
      next,
      decision: {
        allowed: false,
        code: 'daily_budget_exceeded',
        retryAt: null,
        quotaRemaining: Math.max(
          0,
          input.policy.quota.maximumRequests - next.quotaCount
        ),
        dailyBudgetRemainingMicros: Math.max(
          0,
          input.policy.budget.dailyCostMicros - next.dailyUsedMicros - next.reservedMicros
        ),
        monthlyBudgetRemainingMicros: Math.max(
          0,
          input.policy.budget.monthlyCostMicros - next.monthlyUsedMicros - next.reservedMicros
        ),
        circuitState: circuit.state,
      },
    };
  }
  const monthlyProjected =
    next.monthlyUsedMicros + next.reservedMicros + input.estimatedCostMicros;
  if (monthlyProjected > input.policy.budget.monthlyCostMicros) {
    return {
      next,
      decision: {
        allowed: false,
        code: 'monthly_budget_exceeded',
        retryAt: null,
        quotaRemaining: Math.max(
          0,
          input.policy.quota.maximumRequests - next.quotaCount
        ),
        dailyBudgetRemainingMicros: Math.max(
          0,
          input.policy.budget.dailyCostMicros - next.dailyUsedMicros - next.reservedMicros
        ),
        monthlyBudgetRemainingMicros: Math.max(
          0,
          input.policy.budget.monthlyCostMicros - next.monthlyUsedMicros - next.reservedMicros
        ),
        circuitState: circuit.state,
      },
    };
  }

  next.quotaCount += 1;
  next.reservedMicros += input.estimatedCostMicros;
  if (next.circuit.state === 'half-open') next.circuit.probeInFlight = true;
  return {
    next,
    decision: {
      allowed: true,
      code: 'allowed',
      retryAt: null,
      quotaRemaining: Math.max(
        0,
        input.policy.quota.maximumRequests - next.quotaCount
      ),
      dailyBudgetRemainingMicros: Math.max(
        0,
        input.policy.budget.dailyCostMicros - next.dailyUsedMicros - next.reservedMicros
      ),
      monthlyBudgetRemainingMicros: Math.max(
        0,
        input.policy.budget.monthlyCostMicros - next.monthlyUsedMicros - next.reservedMicros
      ),
      circuitState: next.circuit.state,
    },
  };
}

function applyOutcome(input: {
  current: LocalState;
  policy: OperationalGuardPolicy;
  success: boolean;
  reservedCostMicros: number;
  actualCostMicros: number;
  nowMs: number;
}): LocalState {
  const next = refreshState(input.current, input.policy, input.nowMs);
  next.reservedMicros = Math.max(
    0,
    next.reservedMicros - input.reservedCostMicros
  );
  next.dailyUsedMicros += input.actualCostMicros;
  next.monthlyUsedMicros += input.actualCostMicros;
  if (input.success) {
    next.circuit = {
      state: 'closed',
      consecutiveFailures: 0,
      openedAtMs: null,
      probeInFlight: false,
    };
  } else {
    next.circuit.consecutiveFailures += 1;
    next.circuit.probeInFlight = false;
    if (
      next.circuit.state === 'half-open' ||
      next.circuit.consecutiveFailures >= input.policy.circuitBreaker.failureThreshold
    ) {
      next.circuit.state = 'open';
      next.circuit.openedAtMs = input.nowMs;
    }
  }
  return next;
}

export class InMemoryResilienceStateRepository
  implements ResilienceStateRepository
{
  private readonly states = new Map<string, LocalState>();

  async authorize(input: {
    scope: OperationalScope;
    policy: OperationalGuardPolicy;
    estimatedCostMicros: number;
    nowMs: number;
  }): Promise<GuardDecision> {
    const key = stateKey(input.scope);
    const result = authorizeState({
      current: this.states.get(key) || initialState(input.nowMs),
      policy: input.policy,
      estimatedCostMicros: input.estimatedCostMicros,
      nowMs: input.nowMs,
    });
    this.states.set(key, result.next);
    return result.decision;
  }

  async recordOutcome(input: {
    scope: OperationalScope;
    policy: OperationalGuardPolicy;
    success: boolean;
    reservedCostMicros: number;
    actualCostMicros: number;
    nowMs: number;
  }): Promise<CircuitState> {
    const key = stateKey(input.scope);
    const next = applyOutcome({
      current: this.states.get(key) || initialState(input.nowMs),
      policy: input.policy,
      success: input.success,
      reservedCostMicros: input.reservedCostMicros,
      actualCostMicros: input.actualCostMicros,
      nowMs: input.nowMs,
    });
    this.states.set(key, next);
    return structuredClone(next.circuit);
  }
}

export class FirestoreResilienceStateRepository
  implements ResilienceStateRepository
{
  private ref(scope: OperationalScope) {
    return adminDb.collection('operational_resilience_state').doc(stateKey(scope));
  }

  async authorize(input: {
    scope: OperationalScope;
    policy: OperationalGuardPolicy;
    estimatedCostMicros: number;
    nowMs: number;
  }): Promise<GuardDecision> {
    const ref = this.ref(input.scope);
    return adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const result = authorizeState({
        current: snapshot.exists
          ? (snapshot.data() as LocalState)
          : initialState(input.nowMs),
        policy: input.policy,
        estimatedCostMicros: input.estimatedCostMicros,
        nowMs: input.nowMs,
      });
      transaction.set(
        ref,
        {
          ...result.next,
          tenantId: input.scope.tenantId,
          userId: input.scope.userId,
          resource: input.scope.resource,
          updatedAt: new Date(input.nowMs).toISOString(),
        },
        { merge: false }
      );
      return result.decision;
    });
  }

  async recordOutcome(input: {
    scope: OperationalScope;
    policy: OperationalGuardPolicy;
    success: boolean;
    reservedCostMicros: number;
    actualCostMicros: number;
    nowMs: number;
  }): Promise<CircuitState> {
    const ref = this.ref(input.scope);
    return adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const next = applyOutcome({
        current: snapshot.exists
          ? (snapshot.data() as LocalState)
          : initialState(input.nowMs),
        policy: input.policy,
        success: input.success,
        reservedCostMicros: input.reservedCostMicros,
        actualCostMicros: input.actualCostMicros,
        nowMs: input.nowMs,
      });
      transaction.set(
        ref,
        {
          ...next,
          tenantId: input.scope.tenantId,
          userId: input.scope.userId,
          resource: input.scope.resource,
          updatedAt: new Date(input.nowMs).toISOString(),
        },
        { merge: false }
      );
      return next.circuit;
    });
  }
}

export class OperationalResilienceService {
  constructor(
    private readonly repository: ResilienceStateRepository,
    private readonly now: () => number = Date.now
  ) {}

  static createDefault(): OperationalResilienceService {
    if (isFirebaseAdminConfigured()) {
      return new OperationalResilienceService(
        new FirestoreResilienceStateRepository()
      );
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Firestore não configurado para controles de resiliência.');
    }
    return new OperationalResilienceService(
      new InMemoryResilienceStateRepository()
    );
  }

  authorize(input: {
    scope: OperationalScope;
    policy: OperationalGuardPolicy;
    estimatedCostMicros: number;
  }): Promise<GuardDecision> {
    if (!Number.isSafeInteger(input.estimatedCostMicros) || input.estimatedCostMicros < 0) {
      throw new Error('Custo estimado inválido.');
    }
    return this.repository.authorize({ ...input, nowMs: this.now() });
  }

  recordOutcome(input: {
    scope: OperationalScope;
    policy: OperationalGuardPolicy;
    success: boolean;
    reservedCostMicros: number;
    actualCostMicros: number;
  }): Promise<CircuitState> {
    if (
      !Number.isSafeInteger(input.actualCostMicros) ||
      input.actualCostMicros < 0 ||
      !Number.isSafeInteger(input.reservedCostMicros) ||
      input.reservedCostMicros < 0
    ) {
      throw new Error('Custo real inválido.');
    }
    return this.repository.recordOutcome({ ...input, nowMs: this.now() });
  }
}

export function calculateBoundedBackoff(input: {
  attempt: number;
  baseMs: number;
  maximumMs: number;
  jitterFraction?: number;
  random?: () => number;
}): number {
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error('Tentativa de retry inválida.');
  }
  const jitterFraction = input.jitterFraction ?? 0.2;
  if (jitterFraction < 0 || jitterFraction > 1) {
    throw new Error('Fração de jitter inválida.');
  }
  const exponential = Math.min(
    input.maximumMs,
    input.baseMs * 2 ** (input.attempt - 1)
  );
  const random = input.random || Math.random;
  const jitter = exponential * jitterFraction * (random() * 2 - 1);
  return Math.max(0, Math.min(input.maximumMs, Math.round(exponential + jitter)));
}

interface ScopedCacheEntry<T> {
  value: T;
  contentHash: string;
  expiresAtMs: number;
}

export class SafeScopedCache<T> {
  private readonly entries = new Map<string, ScopedCacheEntry<T>>();

  constructor(private readonly now: () => number = Date.now) {}

  private key(scope: OperationalScope, cacheKey: string): string {
    return crypto
      .createHash('sha256')
      .update(`${scope.tenantId}:${scope.userId}:${scope.resource}:${cacheKey}`)
      .digest('hex');
  }

  set(input: {
    scope: OperationalScope;
    cacheKey: string;
    value: T;
    ttlMs: number;
    containsSensitiveData?: boolean;
  }): string {
    if (input.containsSensitiveData) {
      throw new Error('Dados sensíveis não podem entrar no cache operacional.');
    }
    if (input.ttlMs < 1 || input.ttlMs > 3_600_000) {
      throw new Error('TTL do cache precisa estar entre 1 ms e 1 hora.');
    }
    const serialized = JSON.stringify(input.value);
    const contentHash = crypto.createHash('sha256').update(serialized).digest('hex');
    this.entries.set(this.key(input.scope, input.cacheKey), {
      value: structuredClone(input.value),
      contentHash,
      expiresAtMs: this.now() + input.ttlMs,
    });
    return contentHash;
  }

  get(input: {
    scope: OperationalScope;
    cacheKey: string;
    expectedContentHash?: string;
  }): T | null {
    const key = this.key(input.scope, input.cacheKey);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    if (
      input.expectedContentHash &&
      input.expectedContentHash !== entry.contentHash
    ) {
      return null;
    }
    return structuredClone(entry.value);
  }
}
