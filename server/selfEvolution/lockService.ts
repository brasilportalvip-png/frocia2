import { isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { LeaseLock } from './selfEvolutionTypes.js';
import { ILockRepository, FirestoreLockRepository, InMemoryLockRepository } from './repositories.js';

export class LockService {
  private static repository: ILockRepository | null = null;

  private static getRepo(): ILockRepository {
    if (!this.repository) {
      if (isFirebaseAdminConfigured() || Boolean(process.env.FIRESTORE_EMULATOR_HOST)) {
        this.repository = new FirestoreLockRepository();
      } else {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('Firestore adminDb não configurado em ambiente de produção para LockService.');
        }
        this.repository = new InMemoryLockRepository();
      }
    }
    return this.repository;
  }

  static setRepository(repo: ILockRepository): void {
    this.repository = repo;
  }

  static async acquireLock(resourceId: string, owner: string, ttlMs: number = 60000): Promise<LeaseLock | null> {
    return await this.getRepo().acquireLock(resourceId, owner, ttlMs);
  }

  static async releaseLock(resourceId: string, owner: string): Promise<boolean> {
    return await this.getRepo().releaseLock(resourceId, owner);
  }

  static async isLocked(resourceId: string): Promise<boolean> {
    return await this.getRepo().isLocked(resourceId);
  }
}
