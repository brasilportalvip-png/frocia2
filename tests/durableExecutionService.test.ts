import { describe, expect, it, vi } from 'vitest';
import {
  DurableExecutionService,
  InMemoryDurableExecutionStore,
} from '../server/ai/durableExecutionService.js';

function runInput(
  overrides: Partial<Parameters<DurableExecutionService['run']>[0]> = {}
) {
  return {
    executionId: 'exec-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    operation: 'publish-site',
    idempotencyKey: 'idem-12345678',
    payload: { projectId: 'project-1' },
    mutatesState: true,
    reserveResources: vi.fn(async () => ({ reservationId: 'reservation-1' })),
    executeEffect: vi.fn(async () => ({ deploymentId: 'dep-1' })),
    persistResult: vi.fn(async () => undefined),
    commitResources: vi.fn(async () => undefined),
    compensateResources: vi.fn(async () => undefined),
    verifyResult: vi.fn(async () => true),
    outbox: [{ eventType: 'deployment.completed', payload: { deploymentId: 'dep-1' } }],
    ...overrides,
  };
}

describe('DurableExecutionService', () => {
  it('persists the complete successful state machine in order', async () => {
    let clock = 1_000;
    const store = new InMemoryDurableExecutionStore();
    const service = new DurableExecutionService(store, () => ++clock);
    const order: string[] = [];
    const input = runInput({
      reserveResources: vi.fn(async () => {
        order.push('reserve');
        return { reservationId: 'reservation-1' };
      }),
      executeEffect: vi.fn(async () => {
        order.push('effect');
        return { deploymentId: 'dep-1' };
      }),
      persistResult: vi.fn(async () => {
        order.push('persist');
      }),
      commitResources: vi.fn(async () => {
        order.push('commit');
      }),
      verifyResult: vi.fn(async () => {
        order.push('verify');
        return true;
      }),
    });

    await expect(service.run(input)).resolves.toMatchObject({
      executionId: 'exec-1',
      state: 'completed',
    });

    const states = (await store.listEvents('exec-1')).map((event) => event.to);
    expect(states).toEqual([
      'created',
      'validated',
      'authorized',
      'resources_reserved',
      'running',
      'result_received',
      'result_persisted',
      'resources_committed',
      'verified',
      'completed',
    ]);
    expect(order).toEqual(['reserve', 'effect', 'persist', 'commit', 'verify']);
  });

  it('never executes an onerous effect when resource reservation fails', async () => {
    const store = new InMemoryDurableExecutionStore();
    const service = new DurableExecutionService(store);
    const input = runInput({
      reserveResources: vi.fn(async () => {
        throw new Error('insufficient_credits');
      }),
    });

    await expect(service.run(input)).rejects.toThrow('insufficient_credits');
    expect(input.executeEffect).not.toHaveBeenCalled();
    expect((await store.get('exec-1'))?.state).toBe('failed');
  });

  it('marks an uncertain mutable effect as external_blocker without retrying', async () => {
    const store = new InMemoryDurableExecutionStore();
    const service = new DurableExecutionService(store);
    const effect = vi.fn(async () => {
      throw new Error('provider_disconnected_after_request');
    });

    await expect(service.run(runInput({ executeEffect: effect }))).rejects.toThrow();
    expect(effect).toHaveBeenCalledTimes(1);
    expect((await store.get('exec-1'))?.state).toBe('external_blocker');
  });

  it('compensates a non-mutating failure and records failed', async () => {
    const store = new InMemoryDurableExecutionStore();
    const service = new DurableExecutionService(store);
    const compensate = vi.fn(async () => undefined);

    await expect(
      service.run(
        runInput({
          mutatesState: false,
          executeEffect: vi.fn(async () => {
            throw new Error('read_failed');
          }),
          compensateResources: compensate,
        })
      )
    ).rejects.toThrow('read_failed');
    expect(compensate).toHaveBeenCalledWith('reservation-1');
    expect((await store.get('exec-1'))?.state).toBe('failed');
  });

  it('records compensation_pending when compensation itself fails', async () => {
    const store = new InMemoryDurableExecutionStore();
    const service = new DurableExecutionService(store);

    await expect(
      service.run(
        runInput({
          mutatesState: false,
          executeEffect: vi.fn(async () => {
            throw new Error('read_failed');
          }),
          compensateResources: vi.fn(async () => {
            throw new Error('wallet_unavailable');
          }),
        })
      )
    ).rejects.toThrow('read_failed');
    expect((await store.get('exec-1'))?.state).toBe('compensation_pending');
  });

  it('rejects a stale worker after a newer fencing token takes the lease', async () => {
    const store = new InMemoryDurableExecutionStore();
    const createdAt = new Date(1_000).toISOString();
    await store.create({
      executionId: 'fenced',
      tenantId: 'tenant-1',
      userId: 'user-1',
      operation: 'test',
      idempotencyKey: 'key',
      payloadHash: 'hash',
      mutatesState: false,
      state: 'created',
      ownerToken: null,
      fencingToken: 0,
      leaseUntilMs: null,
      reservationId: null,
      resultHash: null,
      errorCode: null,
      createdAt,
      updatedAt: createdAt,
    });
    const first = await store.acquireLease({
      executionId: 'fenced',
      ownerToken: 'worker-old',
      leaseMs: 10,
      nowMs: 1_000,
    });
    const second = await store.acquireLease({
      executionId: 'fenced',
      ownerToken: 'worker-new',
      leaseMs: 100,
      nowMs: 1_011,
    });

    await expect(
      store.transition({
        executionId: 'fenced',
        expectedState: 'created',
        nextState: 'validated',
        ownerToken: 'worker-old',
        fencingToken: first.fencingToken,
        reason: 'stale',
        nowMs: 1_012,
      })
    ).resolves.toBe(false);
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken);
  });

  it('uses an idempotent outbox and marks delivery only after the handler succeeds', async () => {
    const store = new InMemoryDurableExecutionStore();
    const service = new DurableExecutionService(store);
    await service.run(runInput());
    const handler = vi.fn(async () => undefined);

    await expect(service.dispatchOutbox(handler)).resolves.toEqual({
      delivered: 1,
      failed: 0,
    });
    await expect(service.dispatchOutbox(handler)).resolves.toEqual({
      delivered: 0,
      failed: 0,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('derives the job identity from tenant, user, operation and idempotency key', async () => {
    const store = new InMemoryDurableExecutionStore();
    const service = new DurableExecutionService(store);
    const firstInput = runInput({ executionId: undefined });
    const first = await service.run(firstInput);

    await expect(
      service.run(runInput({ executionId: undefined }))
    ).rejects.toThrow('Execução já existe');
    expect(first.executionId).toMatch(/^dur-[a-f0-9]{64}$/);
  });

  it('reconciles a stuck running mutation as an external blocker', async () => {
    let clock = 1_000;
    const store = new InMemoryDurableExecutionStore();
    const createdAt = new Date(clock).toISOString();
    await store.create({
      executionId: 'stuck',
      tenantId: 'tenant-1',
      userId: 'user-1',
      operation: 'publish',
      idempotencyKey: 'key',
      payloadHash: 'hash',
      mutatesState: true,
      state: 'running',
      ownerToken: 'dead-worker',
      fencingToken: 1,
      leaseUntilMs: 1_100,
      reservationId: 'reservation-1',
      resultHash: null,
      errorCode: null,
      createdAt,
      updatedAt: createdAt,
    });
    clock = 20_000;
    const service = new DurableExecutionService(store, () => clock);

    await expect(service.reconcileStuck(5_000)).resolves.toEqual({
      externalBlockers: 1,
      compensationPending: 0,
    });
    expect((await store.get('stuck'))?.state).toBe('external_blocker');
  });
});
