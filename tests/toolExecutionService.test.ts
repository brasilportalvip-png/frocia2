import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  RetryableToolError,
  ToolExecutionError,
  ToolExecutionHandler,
  ToolExecutionRequest,
  ToolExecutionService,
} from '../server/ai/toolExecutionService.js';
import {
  InMemoryToolExecutionStateStore,
  ToolExecutionStateStore,
} from '../server/ai/toolExecutionStore.js';
import { ToolRegistry } from '../server/ai/toolRegistry.js';
import { ToolDeclaration } from '../server/ai/types/ai.js';

const baseContract = ToolRegistry.getTool(
  'execute_calculator'
) as ToolDeclaration;

function contract(
  overrides: Partial<ToolDeclaration> = {}
): ToolDeclaration {
  return {
    ...baseContract,
    ...overrides,
    rateLimit: {
      ...baseContract.rateLimit,
      ...overrides.rateLimit,
    },
  };
}

function request(
  overrides: Partial<ToolExecutionRequest> = {}
): ToolExecutionRequest {
  return {
    toolName: 'execute_calculator',
    args: { expression: '2 + 2' },
    actor: {
      userId: 'user-1',
      grantedScopes: ['user'],
    },
    estimatedCostCredits: 1,
    ...overrides,
  };
}

function service(input: {
  declaration?: ToolDeclaration;
  handler?: ToolExecutionHandler;
  store?: ToolExecutionStateStore;
  loggerEvents?: Array<Record<string, unknown>>;
}) {
  const declaration =
    input.declaration || contract();
  const handler =
    input.handler ||
    (async () => ({
      output: { value: 4 },
      costCredits: 1,
      deterministicVerified: true,
    }));

  return new ToolExecutionService({
    store:
      input.store ||
      new InMemoryToolExecutionStateStore(),
    handlers: {
      execute_calculator: handler,
    },
    catalog: {
      getTool(name) {
        return name === declaration.name
          ? declaration
          : undefined;
      },
    },
    logger: {
      info(event) {
        input.loggerEvents?.push(event);
      },
      error(event) {
        input.loggerEvents?.push(event);
      },
    },
    sleep: async () => undefined,
    createExecutionId: () => 'exec-test-1',
  });
}

describe('ToolExecutionService policy enforcement', () => {
  it('fails closed for unknown tools and invalid arguments', async () => {
    const runtime = service({});

    await expect(
      runtime.execute(
        request({ toolName: 'unknown_tool' })
      )
    ).rejects.toMatchObject({ code: 'unknown_tool' });

    await expect(
      runtime.execute(
        request({ args: { expression: 123 } })
      )
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
    });
  });

  it('enforces declared scopes and project context', async () => {
    const runtime = service({
      declaration: contract({
        authScopes: ['user', 'project'],
      }),
    });

    await expect(
      runtime.execute(request())
    ).rejects.toMatchObject({ code: 'missing_scope' });

    await expect(
      runtime.execute(
        request({
          actor: {
            userId: 'user-1',
            projectId: 'project-1',
            grantedScopes: ['user', 'project'],
          },
        })
      )
    ).resolves.toMatchObject({ verified: true });
  });

  it('requires confirmation and idempotency for mutable actions', async () => {
    const runtime = service({
      declaration: contract({
        mutatesState: true,
        requiresConfirmation: true,
        idempotencyRequired: true,
      }),
    });

    await expect(
      runtime.execute(request())
    ).rejects.toMatchObject({
      code: 'confirmation_required',
    });

    await expect(
      runtime.execute(request({ confirmed: true }))
    ).rejects.toMatchObject({
      code: 'idempotency_required',
    });
  });

  it('replays an idempotent mutable result without running the handler twice', async () => {
    const handler = vi.fn(async () => ({
      output: { publicationId: 'pub-1' },
      costCredits: 1,
      deterministicVerified: true,
    }));
    const runtime = service({
      declaration: contract({
        mutatesState: true,
        requiresConfirmation: true,
        idempotencyRequired: true,
      }),
      handler,
    });
    const execution = request({
      confirmed: true,
      idempotencyKey: 'publish-123',
    });

    const first = await runtime.execute(execution);
    const replay = await runtime.execute(execution);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.output).toEqual(first.output);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not create a mutation ledger for a read-only request key', async () => {
    const runtime = service({});

    await expect(
      runtime.execute(
        request({ idempotencyKey: 'read-only-key' })
      )
    ).resolves.toMatchObject({
      status: 'completed',
      replayed: false,
    });
  });

  it('rejects reuse of an idempotency key with different payload', async () => {
    const runtime = service({
      declaration: contract({
        mutatesState: true,
        requiresConfirmation: true,
        idempotencyRequired: true,
      }),
    });

    await runtime.execute(
      request({
        confirmed: true,
        idempotencyKey: 'same-key',
      })
    );

    await expect(
      runtime.execute(
        request({
          args: { expression: '3 + 3' },
          confirmed: true,
          idempotencyKey: 'same-key',
        })
      )
    ).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
  });

  it('retries only explicitly retryable failures', async () => {
    let attempt = 0;
    const retryableHandler = vi.fn(async () => {
      attempt += 1;

      if (attempt === 1) {
        throw new RetryableToolError(
          'temporary provider failure'
        );
      }

      return {
        output: { value: 4 },
        costCredits: 1,
        deterministicVerified: true,
      };
    });
    const runtime = service({
      declaration: contract({ maxRetries: 2 }),
      handler: retryableHandler,
    });

    const receipt = await runtime.execute(request());

    expect(receipt.attempts).toBe(2);
    expect(retryableHandler).toHaveBeenCalledTimes(2);

    const unsafeHandler = vi.fn(async () => {
      throw new Error('permanent failure');
    });
    const unsafeRuntime = service({
      declaration: contract({ maxRetries: 2 }),
      handler: unsafeHandler,
    });

    await expect(
      unsafeRuntime.execute(request())
    ).rejects.toMatchObject({
      code: 'handler_failed',
    });
    expect(unsafeHandler).toHaveBeenCalledTimes(1);
  });

  it('aborts timed-out attempts and stops after the configured retries', async () => {
    const handler = vi.fn(
      ({ signal }) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new RetryableToolError('aborted')),
            { once: true }
          );
        })
    );
    const runtime = service({
      declaration: contract({
        timeoutMs: 5,
        maxRetries: 1,
        retryBackoffMs: 0,
      }),
      handler,
    });

    await expect(
      runtime.execute(request())
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('enforces estimated and actual cost ceilings', async () => {
    const handler = vi.fn(async () => ({
      output: { value: 4 },
      costCredits: 2,
      deterministicVerified: true,
    }));
    const runtime = service({
      declaration: contract({ costLimitCredits: 2 }),
      handler,
    });

    await expect(
      runtime.execute(
        request({ estimatedCostCredits: 3 })
      )
    ).rejects.toMatchObject({
      code: 'cost_limit_exceeded',
    });
    expect(handler).not.toHaveBeenCalled();

    await expect(
      runtime.execute(
        request({ estimatedCostCredits: 1 })
      )
    ).rejects.toMatchObject({
      code: 'cost_limit_exceeded',
    });
  });

  it('applies the per-user and per-project rate limit', async () => {
    const runtime = service({
      declaration: contract({
        rateLimit: {
          windowMs: 60_000,
          maxRequests: 1,
        },
      }),
    });

    await runtime.execute(request());

    await expect(
      runtime.execute(request())
    ).rejects.toMatchObject({
      code: 'rate_limit_exceeded',
    });
  });

  it('requires the verification strategy before returning success', async () => {
    const missingReceipt = service({
      declaration: contract({
        verificationStrategy: 'provider_receipt',
      }),
    });

    await expect(
      missingReceipt.execute(request())
    ).rejects.toMatchObject({
      code: 'verification_failed',
    });

    const verified = service({
      declaration: contract({
        verificationStrategy: 'provider_receipt',
      }),
      handler: async () => ({
        output: { value: 4 },
        costCredits: 1,
        providerReceipt: { receiptId: 'provider-1' },
      }),
    });

    await expect(
      verified.execute(request())
    ).resolves.toMatchObject({
      verified: true,
      verificationStrategy: 'provider_receipt',
    });
  });

  it('rejects output that violates the declared schema', async () => {
    const runtime = service({
      handler: async () => ({
        output: 'not-an-object',
        costCredits: 1,
        deterministicVerified: true,
      }),
    });

    await expect(
      runtime.execute(request())
    ).rejects.toMatchObject({
      code: 'verification_failed',
    });
  });

  it('redacts secrets from receipts and structured logs', async () => {
    const events: Array<Record<string, unknown>> = [];
    const runtime = service({
      declaration: contract({
        redactFields: ['privateContent'],
      }),
      handler: async () => ({
        output: {
          token: 'do-not-log-me',
          privateContent: 'confidential',
          nested: {
            message: 'Bearer token1234567890',
          },
        },
        costCredits: 1,
        deterministicVerified: true,
      }),
      loggerEvents: events,
    });

    const receipt = await runtime.execute(request());
    const serialized = JSON.stringify({ receipt, events });

    expect(serialized).not.toContain('do-not-log-me');
    expect(serialized).not.toContain('confidential');
    expect(serialized).not.toContain('token1234567890');
    expect(serialized).toContain('[REDACTED_SECRET]');
  });

  it('rejects completion when the idempotency lease owner changed', async () => {
    const backing =
      new InMemoryToolExecutionStateStore();
    const store: ToolExecutionStateStore = {
      consumeRateLimit:
        backing.consumeRateLimit.bind(backing),
      reserveIdempotency:
        backing.reserveIdempotency.bind(backing),
      completeIdempotency: async () => false,
      failIdempotency:
        backing.failIdempotency.bind(backing),
      markIdempotencyUncertain:
        backing.markIdempotencyUncertain.bind(backing),
    };
    const runtime = service({
      declaration: contract({
        mutatesState: true,
        requiresConfirmation: true,
        idempotencyRequired: true,
      }),
      store,
    });

    await expect(
      runtime.execute(
        request({
          confirmed: true,
          idempotencyKey: 'stale-worker',
        })
      )
    ).rejects.toMatchObject({
      code: 'stale_execution',
    });
  });

  it('blocks automatic replay when a mutable outcome is uncertain', async () => {
    const handler = vi.fn(async () => {
      throw new Error(
        'provider disconnected after request'
      );
    });
    const runtime = service({
      declaration: contract({
        mutatesState: true,
        requiresConfirmation: true,
        idempotencyRequired: true,
        maxRetries: 0,
      }),
      handler,
    });
    const execution = request({
      confirmed: true,
      idempotencyKey: 'uncertain-action',
    });

    await expect(
      runtime.execute(execution)
    ).rejects.toMatchObject({ code: 'handler_failed' });

    await expect(
      runtime.execute(execution)
    ).rejects.toMatchObject({
      code: 'external_blocker',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the distributed policy store is unavailable', async () => {
    const brokenStore: ToolExecutionStateStore = {
      consumeRateLimit: async () => {
        throw new Error('store down');
      },
      reserveIdempotency: async () => ({
        outcome: 'acquired',
      }),
      completeIdempotency: async () => true,
      failIdempotency: async () => undefined,
      markIdempotencyUncertain: async () => undefined,
    };
    const runtime = service({ store: brokenStore });

    await expect(
      runtime.execute(request())
    ).rejects.toBeInstanceOf(ToolExecutionError);
    await expect(
      runtime.execute(request())
    ).rejects.toMatchObject({
      code: 'state_store_unavailable',
    });
  });
});
