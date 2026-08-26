import crypto from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';

export interface ToolRateLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  resetAt: string;
}

export interface ToolExecutionReceipt {
  executionId: string;
  toolName: string;
  status: 'completed';
  verified: true;
  verificationStrategy:
    | 'deterministic'
    | 'provider_receipt'
    | 'human_review';
  attempts: number;
  durationMs: number;
  costCredits: number;
  output: unknown;
  providerReceipt?: unknown;
  completedAt: string;
  replayed: boolean;
}

export interface ToolIdempotencyReservation {
  outcome:
    | 'acquired'
    | 'replay'
    | 'conflict'
    | 'in_progress'
    | 'external_blocker';
  receipt?: ToolExecutionReceipt;
}

export interface ToolExecutionStateStore {
  consumeRateLimit(input: {
    scopeKey: string;
    windowMs: number;
    maxRequests: number;
    nowMs: number;
  }): Promise<ToolRateLimitResult>;

  reserveIdempotency(input: {
    scopeKey: string;
    payloadHash: string;
    ownerToken: string;
    leaseMs: number;
    nowMs: number;
  }): Promise<ToolIdempotencyReservation>;

  completeIdempotency(input: {
    scopeKey: string;
    payloadHash: string;
    ownerToken: string;
    receipt: ToolExecutionReceipt;
  }): Promise<boolean>;

  failIdempotency(input: {
    scopeKey: string;
    ownerToken: string;
    failedAt: string;
  }): Promise<void>;

  markIdempotencyUncertain(input: {
    scopeKey: string;
    ownerToken: string;
    blockedAt: string;
  }): Promise<void>;
}

interface LocalRateLimitRecord {
  count: number;
  resetAtMs: number;
}

interface LocalIdempotencyRecord {
  payloadHash: string;
  ownerToken: string;
  leaseUntilMs: number;
  status:
    | 'running'
    | 'completed'
    | 'failed'
    | 'uncertain';
  receipt?: ToolExecutionReceipt;
}

function hashDocumentId(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function asReplayed(
  receipt: ToolExecutionReceipt
): ToolExecutionReceipt {
  return {
    ...receipt,
    replayed: true,
  };
}

export class InMemoryToolExecutionStateStore
  implements ToolExecutionStateStore
{
  private readonly rateLimits = new Map<
    string,
    LocalRateLimitRecord
  >();

  private readonly idempotency = new Map<
    string,
    LocalIdempotencyRecord
  >();

  async consumeRateLimit(input: {
    scopeKey: string;
    windowMs: number;
    maxRequests: number;
    nowMs: number;
  }): Promise<ToolRateLimitResult> {
    const current = this.rateLimits.get(
      input.scopeKey
    );
    const active =
      current && current.resetAtMs > input.nowMs;
    const count = active ? current.count + 1 : 1;
    const resetAtMs = active
      ? current.resetAtMs
      : input.nowMs + input.windowMs;

    this.rateLimits.set(input.scopeKey, {
      count,
      resetAtMs,
    });

    return {
      allowed: count <= input.maxRequests,
      count,
      remaining: Math.max(
        0,
        input.maxRequests - count
      ),
      resetAt: new Date(resetAtMs).toISOString(),
    };
  }

  async reserveIdempotency(input: {
    scopeKey: string;
    payloadHash: string;
    ownerToken: string;
    leaseMs: number;
    nowMs: number;
  }): Promise<ToolIdempotencyReservation> {
    const current = this.idempotency.get(
      input.scopeKey
    );

    if (
      current &&
      current.payloadHash !== input.payloadHash
    ) {
      return { outcome: 'conflict' };
    }

    if (
      current?.status === 'completed' &&
      current.receipt
    ) {
      return {
        outcome: 'replay',
        receipt: asReplayed(current.receipt),
      };
    }

    if (
      current?.status === 'running' &&
      current.leaseUntilMs > input.nowMs &&
      current.ownerToken !== input.ownerToken
    ) {
      return { outcome: 'in_progress' };
    }

    if (current?.status === 'uncertain') {
      return { outcome: 'external_blocker' };
    }

    this.idempotency.set(input.scopeKey, {
      payloadHash: input.payloadHash,
      ownerToken: input.ownerToken,
      leaseUntilMs: input.nowMs + input.leaseMs,
      status: 'running',
    });

    return { outcome: 'acquired' };
  }

  async completeIdempotency(input: {
    scopeKey: string;
    payloadHash: string;
    ownerToken: string;
    receipt: ToolExecutionReceipt;
  }): Promise<boolean> {
    const current = this.idempotency.get(
      input.scopeKey
    );

    if (
      !current ||
      current.payloadHash !== input.payloadHash ||
      current.ownerToken !== input.ownerToken ||
      current.status !== 'running'
    ) {
      return false;
    }

    this.idempotency.set(input.scopeKey, {
      ...current,
      status: 'completed',
      receipt: input.receipt,
    });

    return true;
  }

  async failIdempotency(input: {
    scopeKey: string;
    ownerToken: string;
    failedAt: string;
  }): Promise<void> {
    const current = this.idempotency.get(
      input.scopeKey
    );

    if (current?.ownerToken === input.ownerToken) {
      this.idempotency.set(input.scopeKey, {
        ...current,
        status: 'failed',
        leaseUntilMs: new Date(
          input.failedAt
        ).getTime(),
      });
    }
  }

  async markIdempotencyUncertain(input: {
    scopeKey: string;
    ownerToken: string;
    blockedAt: string;
  }): Promise<void> {
    const current = this.idempotency.get(
      input.scopeKey
    );

    if (current?.ownerToken === input.ownerToken) {
      this.idempotency.set(input.scopeKey, {
        ...current,
        status: 'uncertain',
        leaseUntilMs: Number.POSITIVE_INFINITY,
      });
    }
  }
}

export class FirestoreToolExecutionStateStore
  implements ToolExecutionStateStore
{
  async consumeRateLimit(input: {
    scopeKey: string;
    windowMs: number;
    maxRequests: number;
    nowMs: number;
  }): Promise<ToolRateLimitResult> {
    const ref = adminDb
      .collection('tool_runtime_rate_limits')
      .doc(hashDocumentId(input.scopeKey));

    return adminDb.runTransaction(
      async (transaction) => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.exists
          ? snapshot.data()
          : undefined;
        const previousResetAtMs = Number(
          data?.resetAtMs || 0
        );
        const active =
          previousResetAtMs > input.nowMs;
        const count = active
          ? Number(data?.count || 0) + 1
          : 1;
        const resetAtMs = active
          ? previousResetAtMs
          : input.nowMs + input.windowMs;

        transaction.set(ref, {
          count,
          resetAtMs,
          updatedAt: new Date(input.nowMs),
        });

        return {
          allowed: count <= input.maxRequests,
          count,
          remaining: Math.max(
            0,
            input.maxRequests - count
          ),
          resetAt: new Date(
            resetAtMs
          ).toISOString(),
        };
      }
    );
  }

  async reserveIdempotency(input: {
    scopeKey: string;
    payloadHash: string;
    ownerToken: string;
    leaseMs: number;
    nowMs: number;
  }): Promise<ToolIdempotencyReservation> {
    const ref = adminDb
      .collection('tool_runtime_idempotency')
      .doc(hashDocumentId(input.scopeKey));

    return adminDb.runTransaction(
      async (transaction) => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.exists
          ? snapshot.data()
          : undefined;

        if (
          data?.payloadHash &&
          data.payloadHash !== input.payloadHash
        ) {
          return { outcome: 'conflict' };
        }

        if (
          data?.status === 'completed' &&
          data.receipt
        ) {
          return {
            outcome: 'replay',
            receipt: asReplayed(
              data.receipt as ToolExecutionReceipt
            ),
          };
        }

        if (
          data?.status === 'running' &&
          Number(data.leaseUntilMs || 0) >
            input.nowMs &&
          data.ownerToken !== input.ownerToken
        ) {
          return { outcome: 'in_progress' };
        }

        if (data?.status === 'uncertain') {
          return { outcome: 'external_blocker' };
        }

        transaction.set(ref, {
          payloadHash: input.payloadHash,
          ownerToken: input.ownerToken,
          leaseUntilMs:
            input.nowMs + input.leaseMs,
          status: 'running',
          updatedAt: new Date(input.nowMs),
        });

        return { outcome: 'acquired' };
      }
    );
  }

  async completeIdempotency(input: {
    scopeKey: string;
    payloadHash: string;
    ownerToken: string;
    receipt: ToolExecutionReceipt;
  }): Promise<boolean> {
    const ref = adminDb
      .collection('tool_runtime_idempotency')
      .doc(hashDocumentId(input.scopeKey));

    return adminDb.runTransaction(
      async (transaction) => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.exists
          ? snapshot.data()
          : undefined;

        if (
          data?.payloadHash !== input.payloadHash ||
          data?.ownerToken !== input.ownerToken ||
          data?.status !== 'running'
        ) {
          return false;
        }

        transaction.set(
          ref,
          {
            status: 'completed',
            receipt: input.receipt,
            completedAt: new Date(),
          },
          { merge: true }
        );

        return true;
      }
    );
  }

  async failIdempotency(input: {
    scopeKey: string;
    ownerToken: string;
    failedAt: string;
  }): Promise<void> {
    const ref = adminDb
      .collection('tool_runtime_idempotency')
      .doc(hashDocumentId(input.scopeKey));

    await adminDb.runTransaction(
      async (transaction) => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.exists
          ? snapshot.data()
          : undefined;

        if (data?.ownerToken === input.ownerToken) {
          transaction.set(
            ref,
            {
              status: 'failed',
              leaseUntilMs: new Date(
                input.failedAt
              ).getTime(),
              failedAt: new Date(input.failedAt),
            },
            { merge: true }
          );
        }
      }
    );
  }

  async markIdempotencyUncertain(input: {
    scopeKey: string;
    ownerToken: string;
    blockedAt: string;
  }): Promise<void> {
    const ref = adminDb
      .collection('tool_runtime_idempotency')
      .doc(hashDocumentId(input.scopeKey));

    await adminDb.runTransaction(
      async (transaction) => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.exists
          ? snapshot.data()
          : undefined;

        if (data?.ownerToken === input.ownerToken) {
          transaction.set(
            ref,
            {
              status: 'uncertain',
              blockedAt: new Date(input.blockedAt),
              leaseUntilMs: null,
            },
            { merge: true }
          );
        }
      }
    );
  }
}

export function createToolExecutionStateStore(): ToolExecutionStateStore {
  if (process.env.NODE_ENV === 'production') {
    if (!isFirebaseAdminConfigured()) {
      throw new Error(
        'Firestore Admin é obrigatório em produção para o runtime de ferramentas.'
      );
    }

    return new FirestoreToolExecutionStateStore();
  }

  return new InMemoryToolExecutionStateStore();
}
