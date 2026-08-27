import {
  createToolExecutionStateStore,
  ToolExecutionStateStore,
} from './toolExecutionStore.js';

export class SocialSearchRateLimitError extends Error {
  constructor(readonly resetAt: string) {
    super('Limite de pesquisas sociais atingido.');
    this.name = 'SocialSearchRateLimitError';
  }
}

let defaultStore: ToolExecutionStateStore | null = null;

function getDefaultStore(): ToolExecutionStateStore {
  if (!defaultStore) {
    defaultStore = createToolExecutionStateStore();
  }
  return defaultStore;
}

export class SocialSearchPolicyService {
  static async assertAllowed(
    input: {
      userId: string;
      tenantId: string;
      nowMs?: number;
    },
    store: ToolExecutionStateStore = getDefaultStore()
  ): Promise<void> {
    const result = await store.consumeRateLimit({
      scopeKey: [
        'social_search',
        input.tenantId,
        input.userId,
      ].join(':'),
      windowMs: 60_000,
      maxRequests: 10,
      nowMs: input.nowMs ?? Date.now(),
    });

    if (!result.allowed) {
      throw new SocialSearchRateLimitError(
        result.resetAt
      );
    }
  }
}
