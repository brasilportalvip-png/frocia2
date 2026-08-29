import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';

export interface MigrationDefinition {
  id: string;
  version: number;
  description: string;
  checksum: string;
  apply: () => Promise<void>;
}

export interface MigrationCatalogValidation {
  valid: boolean;
  errors: string[];
}

function migrationChecksum(
  input: Pick<MigrationDefinition, 'id' | 'version' | 'description'>
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: input.id,
        version: input.version,
        description: input.description,
      }),
      'utf8'
    )
    .digest('hex');
}

function defineMigration(input: {
  id: string;
  version: number;
  description: string;
  apply: () => Promise<void>;
}): MigrationDefinition {
  return {
    ...input,
    checksum: migrationChecksum(input),
  };
}

export const MIGRATION_CATALOG: readonly MigrationDefinition[] = [
  defineMigration({
    id: '20260829_001_database_schema_baseline',
    version: 1,
    description:
      'Registra a versão inicial do esquema Firestore governado pela Froc.IA.',
    async apply() {
      await adminDb.collection('system_config').doc('database_schema').set(
        {
          schemaVersion: 1,
          migrationId: '20260829_001_database_schema_baseline',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    },
  }),
] as const;

export function validateMigrationCatalog(
  catalog: readonly MigrationDefinition[] = MIGRATION_CATALOG
): MigrationCatalogValidation {
  const errors: string[] = [];
  if (catalog.length === 0) errors.push('O catálogo de migrations está vazio.');

  const ids = new Set<string>();
  const versions = new Set<number>();
  let previousVersion = 0;

  for (const migration of catalog) {
    if (!/^\d{8}_\d{3}_[a-z0-9_]+$/.test(migration.id)) {
      errors.push(`ID de migration inválido: ${migration.id}`);
    }
    if (ids.has(migration.id)) errors.push(`Migration duplicada: ${migration.id}`);
    if (versions.has(migration.version)) {
      errors.push(`Versão de migration duplicada: ${migration.version}`);
    }
    if (migration.version <= previousVersion) {
      errors.push('As migrations não estão ordenadas por versão crescente.');
    }
    if (migration.checksum !== migrationChecksum(migration)) {
      errors.push(`Checksum divergente na migration ${migration.id}.`);
    }
    ids.add(migration.id);
    versions.add(migration.version);
    previousVersion = migration.version;
  }

  return { valid: errors.length === 0, errors };
}
