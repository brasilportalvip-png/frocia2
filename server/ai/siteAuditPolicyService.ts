import { createToolExecutionStateStore, ToolExecutionStateStore } from './toolExecutionStore.js';

export class SiteAuditRateLimitError extends Error {
  constructor(readonly resetAt: string) {
    super('Limite de auditorias de site atingido. Tente novamente após o horário informado.');
    this.name = 'SiteAuditRateLimitError';
  }
}

let defaultStore: ToolExecutionStateStore | null = null;

function getDefaultStore(): ToolExecutionStateStore {
  if (!defaultStore) defaultStore = createToolExecutionStateStore();
  return defaultStore;
}

export class SiteAuditPolicyService {
  static async assertAllowed(
    input: { userId: string; tenantId: string; nowMs?: number },
    store: ToolExecutionStateStore = getDefaultStore()
  ): Promise<void> {
    const result = await store.consumeRateLimit({
      scopeKey: ['site_audit', input.tenantId, input.userId].join(':'),
      windowMs: 5 * 60_000,
      maxRequests: 3,
      nowMs: input.nowMs ?? Date.now()
    });
    if (!result.allowed) throw new SiteAuditRateLimitError(result.resetAt);
  }
}
