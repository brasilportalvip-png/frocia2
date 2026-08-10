import { SelfEvolutionBudget, LeaseLock } from './selfEvolutionTypes.js';
import { adminDb } from '../lib/firebaseAdmin.js';

export interface IBudgetRepository {
  getBudget(): Promise<SelfEvolutionBudget>;
  saveBudget(budget: SelfEvolutionBudget): Promise<void>;
  consumeBudget(credits: number, today: string, defaultBudget: SelfEvolutionBudget): Promise<boolean>;
}

export interface ILockRepository {
  acquireLock(resourceId: string, owner: string, ttlMs: number): Promise<LeaseLock | null>;
  releaseLock(resourceId: string, owner: string): Promise<boolean>;
  isLocked(resourceId: string): Promise<boolean>;
}

export class FirestoreBudgetRepository implements IBudgetRepository {
  private defaultBudget: SelfEvolutionBudget;

  constructor(defaultBudget: SelfEvolutionBudget) {
    this.defaultBudget = defaultBudget;
  }

  async getBudget(): Promise<SelfEvolutionBudget> {
    const today = new Date().toISOString().split('T')[0];
    if (!adminDb) {
      throw new Error('Firestore adminDb indisponível.');
    }

    const docRef = adminDb.collection('self_evolution_budgets').doc('global');
    const doc = await docRef.get();

    if (doc.exists) {
      const data = doc.data() as SelfEvolutionBudget;
      if (data.lastResetDate !== today) {
        data.dailyCreditsUsed = 0;
        data.dailyAgentRunsCount = 0;
        data.lastResetDate = today;
        await docRef.set(data, { merge: true });
      }
      return data;
    } else {
      await docRef.set(this.defaultBudget);
      return { ...this.defaultBudget };
    }
  }

  async saveBudget(budget: SelfEvolutionBudget): Promise<void> {
    if (!adminDb) {
      throw new Error('Firestore adminDb indisponível.');
    }
    await adminDb.collection('self_evolution_budgets').doc('global').set(budget, { merge: true });
  }

  async consumeBudget(credits: number, today: string, fallbackBudget: SelfEvolutionBudget): Promise<boolean> {
    if (!adminDb) {
      throw new Error('Firestore adminDb indisponível.');
    }

    const docRef = adminDb.collection('self_evolution_budgets').doc('global');
    return await adminDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      let current: SelfEvolutionBudget = doc.exists ? (doc.data() as SelfEvolutionBudget) : { ...fallbackBudget };

      if (current.lastResetDate !== today) {
        current.dailyCreditsUsed = 0;
        current.dailyAgentRunsCount = 0;
        current.lastResetDate = today;
      }

      if (current.dailyAgentRunsCount >= current.dailyMaxAgentRuns) return false;
      if (current.dailyCreditsUsed + credits > current.dailyCreditLimit) return false;
      if (current.monthlyCreditsUsed + credits > current.monthlyCreditLimit) return false;

      current.dailyCreditsUsed += credits;
      current.monthlyCreditsUsed += credits;
      current.dailyAgentRunsCount += 1;

      transaction.set(docRef, current);
      return true;
    });
  }
}

export class InMemoryBudgetRepository implements IBudgetRepository {
  private budget: SelfEvolutionBudget;

  constructor(defaultBudget: SelfEvolutionBudget) {
    this.budget = { ...defaultBudget };
  }

  async getBudget(): Promise<SelfEvolutionBudget> {
    const today = new Date().toISOString().split('T')[0];
    if (this.budget.lastResetDate !== today) {
      this.budget.dailyCreditsUsed = 0;
      this.budget.dailyAgentRunsCount = 0;
      this.budget.lastResetDate = today;
    }
    return { ...this.budget };
  }

  async saveBudget(budget: SelfEvolutionBudget): Promise<void> {
    this.budget = { ...budget };
  }

  async consumeBudget(credits: number, today: string): Promise<boolean> {
    if (this.budget.lastResetDate !== today) {
      this.budget.dailyCreditsUsed = 0;
      this.budget.dailyAgentRunsCount = 0;
      this.budget.lastResetDate = today;
    }

    if (this.budget.dailyAgentRunsCount >= this.budget.dailyMaxAgentRuns) return false;
    if (this.budget.dailyCreditsUsed + credits > this.budget.dailyCreditLimit) return false;
    if (this.budget.monthlyCreditsUsed + credits > this.budget.monthlyCreditLimit) return false;

    this.budget.dailyCreditsUsed += credits;
    this.budget.monthlyCreditsUsed += credits;
    this.budget.dailyAgentRunsCount += 1;
    return true;
  }
}

export class FirestoreLockRepository implements ILockRepository {
  async acquireLock(resourceId: string, owner: string, ttlMs: number): Promise<LeaseLock | null> {
    if (!adminDb) {
      throw new Error('Firestore adminDb indisponível.');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const lockRef = adminDb.collection('self_evolution_locks').doc(resourceId);

    return await adminDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(lockRef);
      if (doc.exists) {
        const data = doc.data();
        const currentExpiresAt = data?.lockExpiresAt ? new Date(data.lockExpiresAt) : new Date(0);
        if (currentExpiresAt > now && data?.lockOwner !== owner) {
          return null; // Lock retido por outro proprietário
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
  }

  async releaseLock(resourceId: string, owner: string): Promise<boolean> {
    if (!adminDb) {
      throw new Error('Firestore adminDb indisponível.');
    }

    const lockRef = adminDb.collection('self_evolution_locks').doc(resourceId);
    return await adminDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(lockRef);
      if (!doc.exists) return true;
      if (doc.data()?.lockOwner !== owner) return false;

      transaction.delete(lockRef);
      return true;
    });
  }

  async isLocked(resourceId: string): Promise<boolean> {
    if (!adminDb) return false;
    const doc = await adminDb.collection('self_evolution_locks').doc(resourceId).get();
    if (!doc.exists) return false;
    const data = doc.data();
    return new Date(data?.lockExpiresAt) > new Date();
  }
}

export class InMemoryLockRepository implements ILockRepository {
  private locks: Map<string, LeaseLock> = new Map();

  async acquireLock(resourceId: string, owner: string, ttlMs: number): Promise<LeaseLock | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

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

  async releaseLock(resourceId: string, owner: string): Promise<boolean> {
    const existing = this.locks.get(resourceId);
    if (!existing) return true;
    if (existing.lockOwner !== owner) return false;

    this.locks.delete(resourceId);
    return true;
  }

  async isLocked(resourceId: string): Promise<boolean> {
    const existing = this.locks.get(resourceId);
    if (!existing) return false;
    return new Date(existing.lockExpiresAt) > new Date();
  }
}
