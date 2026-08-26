import crypto from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';

export type DurableExecutionState =
  | 'created'
  | 'validated'
  | 'authorized'
  | 'resources_reserved'
  | 'running'
  | 'result_received'
  | 'result_persisted'
  | 'resources_committed'
  | 'verified'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'compensation_pending'
  | 'external_blocker';

const TERMINAL_STATES = new Set<DurableExecutionState>([
  'completed',
  'failed',
  'cancelled',
  'external_blocker',
]);

const ALLOWED_TRANSITIONS: Record<DurableExecutionState, DurableExecutionState[]> = {
  created: ['validated', 'failed', 'cancelled'],
  validated: ['authorized', 'failed', 'cancelled'],
  authorized: ['resources_reserved', 'failed', 'cancelled'],
  resources_reserved: ['running', 'compensation_pending', 'failed', 'cancelled'],
  running: ['result_received', 'failed', 'cancelled', 'external_blocker', 'compensation_pending'],
  result_received: ['result_persisted', 'external_blocker', 'compensation_pending'],
  result_persisted: ['resources_committed', 'external_blocker', 'compensation_pending'],
  resources_committed: ['verified', 'external_blocker', 'compensation_pending'],
  verified: ['completed', 'external_blocker'],
  completed: [],
  failed: [],
  cancelled: [],
  compensation_pending: ['failed', 'cancelled', 'external_blocker'],
  external_blocker: [],
};

export interface DurableExecutionRecord {
  executionId: string;
  tenantId: string;
  userId: string;
  operation: string;
  idempotencyKey: string;
  payloadHash: string;
  mutatesState: boolean;
  state: DurableExecutionState;
  ownerToken: string | null;
  fencingToken: number;
  leaseUntilMs: number | null;
  reservationId: string | null;
  resultHash: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DurableTransitionEvent {
  eventId: string;
  executionId: string;
  from: DurableExecutionState | null;
  to: DurableExecutionState;
  reason: string;
  ownerToken: string | null;
  fencingToken: number;
  occurredAt: string;
}

export interface DurableOutboxEvent {
  outboxId: string;
  executionId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered';
  attempts: number;
  createdAt: string;
  deliveredAt: string | null;
}

export interface DurableExecutionStore {
  create(record: DurableExecutionRecord): Promise<void>;
  get(executionId: string): Promise<DurableExecutionRecord | null>;
  acquireLease(input: {
    executionId: string;
    ownerToken: string;
    leaseMs: number;
    nowMs: number;
  }): Promise<{ acquired: boolean; fencingToken: number }>;
  transition(input: {
    executionId: string;
    expectedState: DurableExecutionState;
    nextState: DurableExecutionState;
    ownerToken: string;
    fencingToken: number;
    reason: string;
    patch?: Partial<DurableExecutionRecord>;
    nowMs: number;
  }): Promise<boolean>;
  enqueueOutbox(event: DurableOutboxEvent): Promise<void>;
  listPendingOutbox(limit: number): Promise<DurableOutboxEvent[]>;
  markOutboxDelivered(outboxId: string, deliveredAt: string): Promise<boolean>;
  listStuck(beforeMs: number, limit: number): Promise<DurableExecutionRecord[]>;
  listEvents(executionId: string): Promise<DurableTransitionEvent[]>;
}

export function assertDurableTransition(
  from: DurableExecutionState,
  to: DurableExecutionState
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Transição durável inválida: ${from} -> ${to}.`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

function stableHash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export class InMemoryDurableExecutionStore implements DurableExecutionStore {
  readonly records = new Map<string, DurableExecutionRecord>();
  readonly events: DurableTransitionEvent[] = [];
  readonly outbox = new Map<string, DurableOutboxEvent>();

  async create(record: DurableExecutionRecord): Promise<void> {
    if (this.records.has(record.executionId)) throw new Error('Execução já existe.');
    this.records.set(record.executionId, { ...record });
    this.events.push({
      eventId: crypto.randomUUID(),
      executionId: record.executionId,
      from: null,
      to: 'created',
      reason: 'Execução criada.',
      ownerToken: null,
      fencingToken: 0,
      occurredAt: record.createdAt,
    });
  }

  async get(executionId: string): Promise<DurableExecutionRecord | null> {
    const record = this.records.get(executionId);
    return record ? { ...record } : null;
  }

  async acquireLease(input: {
    executionId: string;
    ownerToken: string;
    leaseMs: number;
    nowMs: number;
  }): Promise<{ acquired: boolean; fencingToken: number }> {
    const record = this.records.get(input.executionId);
    if (!record || TERMINAL_STATES.has(record.state)) {
      return { acquired: false, fencingToken: record?.fencingToken || 0 };
    }
    if (
      record.ownerToken &&
      record.ownerToken !== input.ownerToken &&
      Number(record.leaseUntilMs || 0) > input.nowMs
    ) {
      return { acquired: false, fencingToken: record.fencingToken };
    }

    record.ownerToken = input.ownerToken;
    record.fencingToken += 1;
    record.leaseUntilMs = input.nowMs + input.leaseMs;
    record.updatedAt = new Date(input.nowMs).toISOString();
    return { acquired: true, fencingToken: record.fencingToken };
  }

  async transition(input: {
    executionId: string;
    expectedState: DurableExecutionState;
    nextState: DurableExecutionState;
    ownerToken: string;
    fencingToken: number;
    reason: string;
    patch?: Partial<DurableExecutionRecord>;
    nowMs: number;
  }): Promise<boolean> {
    const record = this.records.get(input.executionId);
    if (
      !record ||
      record.state !== input.expectedState ||
      record.ownerToken !== input.ownerToken ||
      record.fencingToken !== input.fencingToken ||
      Number(record.leaseUntilMs || 0) <= input.nowMs
    ) {
      return false;
    }
    assertDurableTransition(record.state, input.nextState);
    const from = record.state;
    Object.assign(record, input.patch || {}, {
      state: input.nextState,
      updatedAt: new Date(input.nowMs).toISOString(),
    });
    this.events.push({
      eventId: crypto.randomUUID(),
      executionId: input.executionId,
      from,
      to: input.nextState,
      reason: input.reason,
      ownerToken: input.ownerToken,
      fencingToken: input.fencingToken,
      occurredAt: new Date(input.nowMs).toISOString(),
    });
    return true;
  }

  async enqueueOutbox(event: DurableOutboxEvent): Promise<void> {
    if (!this.outbox.has(event.outboxId)) this.outbox.set(event.outboxId, { ...event });
  }

  async listPendingOutbox(limit: number): Promise<DurableOutboxEvent[]> {
    return [...this.outbox.values()]
      .filter((event) => event.status === 'pending')
      .slice(0, limit)
      .map((event) => ({ ...event }));
  }

  async markOutboxDelivered(outboxId: string, deliveredAt: string): Promise<boolean> {
    const event = this.outbox.get(outboxId);
    if (!event || event.status !== 'pending') return false;
    event.status = 'delivered';
    event.deliveredAt = deliveredAt;
    event.attempts += 1;
    return true;
  }

  async listStuck(beforeMs: number, limit: number): Promise<DurableExecutionRecord[]> {
    return [...this.records.values()]
      .filter(
        (record) =>
          !TERMINAL_STATES.has(record.state) &&
          new Date(record.updatedAt).getTime() <= beforeMs
      )
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async listEvents(executionId: string): Promise<DurableTransitionEvent[]> {
    return this.events.filter((event) => event.executionId === executionId).map((event) => ({ ...event }));
  }
}

export class FirestoreDurableExecutionStore implements DurableExecutionStore {
  async create(record: DurableExecutionRecord): Promise<void> {
    const ref = adminDb!.collection('durable_executions').doc(record.executionId);
    const eventRef = adminDb!.collection('durable_execution_events').doc();
    const batch = adminDb!.batch();
    batch.create(ref, record);
    batch.create(eventRef, {
      eventId: eventRef.id,
      executionId: record.executionId,
      from: null,
      to: 'created',
      reason: 'Execução criada.',
      ownerToken: null,
      fencingToken: 0,
      occurredAt: new Date(record.createdAt),
    });
    await batch.commit();
  }

  async get(executionId: string): Promise<DurableExecutionRecord | null> {
    const snap = await adminDb!.collection('durable_executions').doc(executionId).get();
    if (!snap.exists) return null;
    return snap.data() as DurableExecutionRecord;
  }

  async acquireLease(input: {
    executionId: string;
    ownerToken: string;
    leaseMs: number;
    nowMs: number;
  }): Promise<{ acquired: boolean; fencingToken: number }> {
    const ref = adminDb!.collection('durable_executions').doc(input.executionId);
    return adminDb!.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const record = snap.data() as DurableExecutionRecord | undefined;
      if (!snap.exists || !record || TERMINAL_STATES.has(record.state)) {
        return { acquired: false, fencingToken: record?.fencingToken || 0 };
      }
      if (
        record.ownerToken &&
        record.ownerToken !== input.ownerToken &&
        Number(record.leaseUntilMs || 0) > input.nowMs
      ) {
        return { acquired: false, fencingToken: record.fencingToken };
      }
      const fencingToken = Number(record.fencingToken || 0) + 1;
      transaction.update(ref, {
        ownerToken: input.ownerToken,
        fencingToken,
        leaseUntilMs: input.nowMs + input.leaseMs,
        updatedAt: new Date(input.nowMs).toISOString(),
      });
      return { acquired: true, fencingToken };
    });
  }

  async transition(input: {
    executionId: string;
    expectedState: DurableExecutionState;
    nextState: DurableExecutionState;
    ownerToken: string;
    fencingToken: number;
    reason: string;
    patch?: Partial<DurableExecutionRecord>;
    nowMs: number;
  }): Promise<boolean> {
    const ref = adminDb!.collection('durable_executions').doc(input.executionId);
    const eventRef = adminDb!.collection('durable_execution_events').doc();
    return adminDb!.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const record = snap.data() as DurableExecutionRecord | undefined;
      if (
        !snap.exists ||
        !record ||
        record.state !== input.expectedState ||
        record.ownerToken !== input.ownerToken ||
        Number(record.fencingToken) !== input.fencingToken ||
        Number(record.leaseUntilMs || 0) <= input.nowMs
      ) {
        return false;
      }
      assertDurableTransition(record.state, input.nextState);
      transaction.update(ref, {
        ...(input.patch || {}),
        state: input.nextState,
        updatedAt: new Date(input.nowMs).toISOString(),
      });
      transaction.create(eventRef, {
        eventId: eventRef.id,
        executionId: input.executionId,
        from: record.state,
        to: input.nextState,
        reason: input.reason,
        ownerToken: input.ownerToken,
        fencingToken: input.fencingToken,
        occurredAt: new Date(input.nowMs),
      });
      return true;
    });
  }

  async enqueueOutbox(event: DurableOutboxEvent): Promise<void> {
    const ref = adminDb!.collection('durable_execution_outbox').doc(event.outboxId);
    try {
      await ref.create(event);
    } catch (error: any) {
      if (error?.code !== 6 && error?.code !== 'already-exists') throw error;
    }
  }

  async listPendingOutbox(limit: number): Promise<DurableOutboxEvent[]> {
    const snap = await adminDb!
      .collection('durable_execution_outbox')
      .where('status', '==', 'pending')
      .limit(limit)
      .get();
    return snap.docs.map((doc) => doc.data() as DurableOutboxEvent);
  }

  async markOutboxDelivered(outboxId: string, deliveredAt: string): Promise<boolean> {
    const ref = adminDb!.collection('durable_execution_outbox').doc(outboxId);
    return adminDb!.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const data = snap.data() as DurableOutboxEvent | undefined;
      if (!snap.exists || !data || data.status !== 'pending') return false;
      transaction.update(ref, {
        status: 'delivered',
        deliveredAt,
        attempts: Number(data.attempts || 0) + 1,
      });
      return true;
    });
  }

  async listStuck(beforeMs: number, limit: number): Promise<DurableExecutionRecord[]> {
    const snap = await adminDb!
      .collection('durable_executions')
      .where('leaseUntilMs', '<=', beforeMs)
      .limit(limit)
      .get();
    return snap.docs
      .map((doc) => doc.data() as DurableExecutionRecord)
      .filter((record) => !TERMINAL_STATES.has(record.state));
  }

  async listEvents(executionId: string): Promise<DurableTransitionEvent[]> {
    const snap = await adminDb!
      .collection('durable_execution_events')
      .where('executionId', '==', executionId)
      .get();
    return snap.docs
      .map((doc) => doc.data() as DurableTransitionEvent)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}

export interface DurableResourceReservation {
  reservationId: string;
}

export interface DurableExecutionRunInput {
  executionId?: string;
  tenantId: string;
  userId: string;
  operation: string;
  idempotencyKey: string;
  payload: unknown;
  mutatesState: boolean;
  leaseMs?: number;
  signal?: AbortSignal;
  reserveResources(): Promise<DurableResourceReservation>;
  executeEffect(signal?: AbortSignal): Promise<unknown>;
  persistResult(result: unknown): Promise<void>;
  commitResources(reservationId: string, result: unknown): Promise<void>;
  compensateResources(reservationId: string): Promise<void>;
  verifyResult(result: unknown): Promise<boolean>;
  outbox?: Array<{ eventType: string; payload: Record<string, unknown> }>;
}

export class DurableExecutionService {
  constructor(
    readonly store: DurableExecutionStore = createDurableExecutionStore(),
    private readonly now: () => number = Date.now
  ) {}

  async run(input: DurableExecutionRunInput): Promise<{
    executionId: string;
    state: 'completed';
    result: unknown;
  }> {
    const executionId = input.executionId ||
      `dur-${stableHash({
        tenantId: input.tenantId,
        userId: input.userId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
      })}`;
    const ownerToken = crypto.randomUUID();
    const createdAt = new Date(this.now()).toISOString();
    let state: DurableExecutionState = 'created';
    let fencingToken = 0;
    let reservationId: string | null = null;
    let actionStarted = false;

    await this.store.create({
      executionId,
      tenantId: input.tenantId,
      userId: input.userId,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      payloadHash: stableHash(input.payload),
      mutatesState: input.mutatesState,
      state,
      ownerToken: null,
      fencingToken: 0,
      leaseUntilMs: null,
      reservationId: null,
      resultHash: null,
      errorCode: null,
      createdAt,
      updatedAt: createdAt,
    });

    const lease = await this.store.acquireLease({
      executionId,
      ownerToken,
      leaseMs: input.leaseMs || 60_000,
      nowMs: this.now(),
    });
    if (!lease.acquired) throw new Error('Não foi possível adquirir o lease da execução.');
    fencingToken = lease.fencingToken;

    const move = async (
      nextState: DurableExecutionState,
      reason: string,
      patch?: Partial<DurableExecutionRecord>
    ) => {
      const moved = await this.store.transition({
        executionId,
        expectedState: state,
        nextState,
        ownerToken,
        fencingToken,
        reason,
        patch,
        nowMs: this.now(),
      });
      if (!moved) throw new Error('Worker perdeu o lease ou o fencing token da execução.');
      state = nextState;
    };

    try {
      if (input.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      await move('validated', 'Entrada validada.');
      await move('authorized', 'Usuário, empresa e operação autorizados.');
      const reservation = await input.reserveResources();
      reservationId = reservation.reservationId;
      await move('resources_reserved', 'Recursos reservados antes do efeito externo.', {
        reservationId,
      });
      await move('running', 'Execução externa iniciada.');
      actionStarted = true;
      const result = await input.executeEffect(input.signal);
      await move('result_received', 'Resultado recebido do executor.', {
        resultHash: stableHash(result),
      });
      await input.persistResult(result);
      await move('result_persisted', 'Resultado persistido.');
      await input.commitResources(reservationId, result);
      await move('resources_committed', 'Recursos confirmados após persistência do resultado.');
      if (!(await input.verifyResult(result))) {
        throw new Error('verification_failed');
      }
      await move('verified', 'Resultado verificado por critério declarado.');

      for (const event of input.outbox || []) {
        await this.store.enqueueOutbox({
          outboxId: stableHash(`${executionId}:${event.eventType}`),
          executionId,
          eventType: event.eventType,
          payload: event.payload,
          status: 'pending',
          attempts: 0,
          createdAt: new Date(this.now()).toISOString(),
          deliveredAt: null,
        });
      }
      await move('completed', 'Execução concluída com evidência e outbox persistidos.');
      return { executionId, state: 'completed', result };
    } catch (error) {
      const cancelled = input.signal?.aborted ||
        (error instanceof DOMException && error.name === 'AbortError');
      const errorCode = error instanceof Error ? error.message.slice(0, 120) : 'unknown_error';

      if (actionStarted && input.mutatesState) {
        if (ALLOWED_TRANSITIONS[state].includes('external_blocker')) {
          await move('external_blocker', 'Efeito mutável com resultado incerto exige reconciliação.', {
            errorCode,
          });
        }
      } else if (reservationId) {
        try {
          await input.compensateResources(reservationId);
          const target = cancelled ? 'cancelled' : 'failed';
          if (ALLOWED_TRANSITIONS[state].includes(target)) {
            await move(target, 'Reserva compensada após falha antes do efeito.', { errorCode });
          }
        } catch {
          if (ALLOWED_TRANSITIONS[state].includes('compensation_pending')) {
            await move('compensation_pending', 'Compensação falhou e ficou pendente.', { errorCode });
          }
        }
      } else {
        const target = cancelled ? 'cancelled' : 'failed';
        if (ALLOWED_TRANSITIONS[state].includes(target)) {
          await move(target, 'Execução encerrada antes de reservar recursos.', { errorCode });
        }
      }
      throw error;
    }
  }

  async dispatchOutbox(
    handler: (event: DurableOutboxEvent) => Promise<void>,
    limit = 50
  ): Promise<{ delivered: number; failed: number }> {
    const pending = await this.store.listPendingOutbox(limit);
    let delivered = 0;
    let failed = 0;
    for (const event of pending) {
      try {
        await handler(event);
        if (await this.store.markOutboxDelivered(event.outboxId, new Date(this.now()).toISOString())) {
          delivered += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { delivered, failed };
  }

  async reconcileStuck(
    staleAfterMs = 5 * 60_000,
    limit = 50
  ): Promise<{ externalBlockers: number; compensationPending: number }> {
    const records = await this.store.listStuck(this.now() - staleAfterMs, limit);
    let externalBlockers = 0;
    let compensationPending = 0;

    for (const record of records) {
      const ownerToken = crypto.randomUUID();
      const lease = await this.store.acquireLease({
        executionId: record.executionId,
        ownerToken,
        leaseMs: 30_000,
        nowMs: this.now(),
      });
      if (!lease.acquired) continue;
      const external = ['running', 'result_received', 'result_persisted', 'resources_committed', 'verified']
        .includes(record.state);
      const nextState: DurableExecutionState = external
        ? 'external_blocker'
        : 'compensation_pending';
      if (!ALLOWED_TRANSITIONS[record.state].includes(nextState)) continue;
      const moved = await this.store.transition({
        executionId: record.executionId,
        expectedState: record.state,
        nextState,
        ownerToken,
        fencingToken: lease.fencingToken,
        reason: external
          ? 'Lease expirado após possível efeito externo; revisão obrigatória.'
          : 'Lease expirado com reserva pendente de compensação.',
        patch: { errorCode: 'stuck_execution_reconciled' },
        nowMs: this.now(),
      });
      if (moved) {
        if (external) externalBlockers += 1;
        else compensationPending += 1;
      }
    }
    return { externalBlockers, compensationPending };
  }
}

export function createDurableExecutionStore(): DurableExecutionStore {
  if (process.env.NODE_ENV === 'production') {
    if (!isFirebaseAdminConfigured()) {
      throw new Error('Firestore Admin é obrigatório para execuções duráveis em produção.');
    }
    return new FirestoreDurableExecutionStore();
  }
  return new InMemoryDurableExecutionStore();
}
