import { adminDb } from '../lib/firebaseAdmin.js';
import { LeaseLock } from './selfEvolutionTypes.js';

export class LockService {
  private static locks: Map<string, LeaseLock> = new Map();

  static async acquireLock(resourceId: string, owner: string, ttlMs: number = 60000): Promise<LeaseLock | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

    if (adminDb) {
      try {
        const lockRef = adminDb.collection('self_evolution_locks').doc(resourceId);

        return await adminDb.runTransaction(async (transaction) => {
          const doc = await transaction.get(lockRef);
          if (doc.exists) {
            const data = doc.data();
            const currentExpiresAt = data?.lockExpiresAt ? new Date(data.lockExpiresAt) : new Date(0);
            if (currentExpiresAt > now && data?.lockOwner !== owner) {
              return null; // Lock held by another owner
            }
          }

          const existingAttempt = doc.exists ? (doc.data()?.attempt || 0) : 0;
          const lock: LeaseLock = {
            id: `lock-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            resourceId,
            lockOwner: owner,
            lockedAt: now.toISOString(),
            lockExpiresAt: expiresAt,
            heartbeatAt: now.toISOString(),
            attempt: existingAttempt + 1,
            maxAttempts: 5,
          };

          transaction.set(lockRef, lock);
          return lock;
        });
      } catch (err) {
        console.error('Erro de transação Firestore em LockService.acquireLock:', err);
      }
    }

    // Fallback if adminDb is offline
    const existing = this.locks.get(resourceId);
    if (existing && new Date(existing.lockExpiresAt) > now && existing.lockOwner !== owner) {
      return null;
    }

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

  static async releaseLock(resourceId: string, owner: string): Promise<boolean> {
    if (adminDb) {
      try {
        const lockRef = adminDb.collection('self_evolution_locks').doc(resourceId);
        return await adminDb.runTransaction(async (transaction) => {
          const doc = await transaction.get(lockRef);
          if (!doc.exists) return true;
          if (doc.data()?.lockOwner !== owner) return false;

          transaction.delete(lockRef);
          return true;
        });
      } catch {
        return false;
      }
    }

    const existing = this.locks.get(resourceId);
    if (!existing) return true;
    if (existing.lockOwner !== owner) return false;

    this.locks.delete(resourceId);
    return true;
  }

  static async isLocked(resourceId: string): Promise<boolean> {
    if (adminDb) {
      try {
        const doc = await adminDb.collection('self_evolution_locks').doc(resourceId).get();
        if (!doc.exists) return false;
        const data = doc.data();
        return new Date(data?.lockExpiresAt) > new Date();
      } catch {
        // fallback
      }
    }

    const existing = this.locks.get(resourceId);
    if (!existing) return false;
    return new Date(existing.lockExpiresAt) > new Date();
  }
}

