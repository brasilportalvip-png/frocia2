import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';
import {
  MIGRATION_CATALOG,
  validateMigrationCatalog,
} from './migrationCatalog.js';

const LEDGER_COLLECTION = 'schema_migrations';
const RUNNING_TTL_MS = 15 * 60_000;

interface MigrationLedger {
  id: string;
  version: number;
  checksum: string;
  status: 'running' | 'completed' | 'failed';
  actorUid: string;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  errorCode?: string;
}

function timestampMs(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export class MigrationService {
  static async status() {
    const validation = validateMigrationCatalog();
    if (!validation.valid) {
      throw new Error(`migration_catalog_invalid:${validation.errors.join('|')}`);
    }

    const references = MIGRATION_CATALOG.map((migration) =>
      adminDb.collection(LEDGER_COLLECTION).doc(migration.id)
    );
    const snapshots = await adminDb.getAll(...references);
    const entries = MIGRATION_CATALOG.map((migration, index) => {
      const ledger = snapshots[index]?.exists
        ? (snapshots[index].data() as MigrationLedger)
        : null;
      const checksumMatches = !ledger || ledger.checksum === migration.checksum;
      return {
        id: migration.id,
        version: migration.version,
        description: migration.description,
        status: ledger?.status || 'pending',
        checksumMatches,
      };
    });

    return {
      catalogValid: true,
      currentVersion: Math.max(
        0,
        ...entries
          .filter((entry) => entry.status === 'completed' && entry.checksumMatches)
          .map((entry) => entry.version)
      ),
      targetVersion: MIGRATION_CATALOG.at(-1)?.version || 0,
      pending: entries.filter((entry) => entry.status !== 'completed'),
      checksumMismatches: entries.filter((entry) => !entry.checksumMatches),
      entries,
    };
  }

  static async applyPending(actorUid: string) {
    const actor = actorUid.trim();
    if (!actor) throw new Error('migration_actor_required');
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of MIGRATION_CATALOG) {
      const reference = adminDb.collection(LEDGER_COLLECTION).doc(migration.id);
      const claimed = await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (snapshot.exists) {
          const ledger = snapshot.data() as MigrationLedger;
          if (ledger.checksum !== migration.checksum) {
            throw new Error(`migration_checksum_mismatch:${migration.id}`);
          }
          if (ledger.status === 'completed') return false;
          if (
            ledger.status === 'running' &&
            Date.now() - timestampMs(ledger.startedAt) < RUNNING_TTL_MS
          ) {
            throw new Error(`migration_already_running:${migration.id}`);
          }
        }
        transaction.set(reference, {
          id: migration.id,
          version: migration.version,
          checksum: migration.checksum,
          status: 'running',
          actorUid: actor,
          startedAt: FieldValue.serverTimestamp(),
          completedAt: null,
          errorCode: null,
        });
        return true;
      });

      if (!claimed) {
        skipped.push(migration.id);
        continue;
      }

      try {
        await migration.apply();
        await reference.set(
          {
            status: 'completed',
            completedAt: FieldValue.serverTimestamp(),
            errorCode: null,
          },
          { merge: true }
        );
        applied.push(migration.id);
      } catch (error) {
        const errorCode =
          error instanceof Error ? error.message.slice(0, 240) : 'migration_failed';
        await reference.set(
          {
            status: 'failed',
            completedAt: FieldValue.serverTimestamp(),
            errorCode,
          },
          { merge: true }
        );
        throw error;
      }
    }

    return { applied, skipped, status: await this.status() };
  }
}
