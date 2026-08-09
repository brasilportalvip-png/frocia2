import { LeaseLock } from './selfEvolutionTypes.js';

export class LockService {
  private static locks: Map<string, LeaseLock> = new Map();

  static acquireLock(resourceId: string, owner: string, ttlMs: number = 60000): LeaseLock | null {
    const existing = this.locks.get(resourceId);
    const now = new Date();

    if (existing) {
      if (new Date(existing.lockExpiresAt) > now) {
        return null; // Lock is currently held
      }
    }

    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const lock: LeaseLock = {
      id: `lock-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      resourceId,
      lockOwner: owner,
      lockedAt: now.toISOString(),
      lockExpiresAt: expiresAt,
      heartbeatAt: now.toISOString(),
      attempt: (existing?.attempt || 0) + 1,
      maxAttempts: 5,
    };

    this.locks.set(resourceId, lock);
    return lock;
  }

  static releaseLock(resourceId: string, owner: string): boolean {
    const existing = this.locks.get(resourceId);
    if (!existing) return true;
    if (existing.lockOwner !== owner) return false;

    this.locks.delete(resourceId);
    return true;
  }

  static isLocked(resourceId: string): boolean {
    const existing = this.locks.get(resourceId);
    if (!existing) return false;
    return new Date(existing.lockExpiresAt) > new Date();
  }
}
