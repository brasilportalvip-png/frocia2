import { describe, expect, it } from 'vitest';
import {
  decryptAutomaticBackup,
  encryptAutomaticBackup,
  selectExpiredBackupNames,
} from '../server/services/automaticBackupService.js';
import {
  MIGRATION_CATALOG,
  MigrationDefinition,
  validateMigrationCatalog,
} from '../server/migrations/migrationCatalog.js';
import { PortableBackupEnvelope } from '../server/services/portableRecoveryService.js';
import { EnvSchema } from '../server/config/env.js';

const productionEnvFixture = {
  NODE_ENV: 'production',
  FIREBASE_PROJECT_ID: 'froc-ia-test',
  FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----',
  GEMINI_API_KEY: 'gemini-test-key',
  MERCADO_PAGO_ACCESS_TOKEN: 'mercado-pago-test-token',
  MERCADO_PAGO_WEBHOOK_SECRET: 'mercado-pago-test-webhook-secret',
  INTERNAL_CRON_SECRET: 'segredo-interno-nao-previsivel-2026',
};

function backupFixture(): PortableBackupEnvelope {
  return {
    manifest: {
      format: 'froc-portable-backup-v1',
      backupId: 'froc-backup-e2e',
      projectId: 'frocia-e07a5',
      databaseId: '(default)',
      createdAt: '2026-08-29T00:00:00.000Z',
      createdBy: 'test',
      collectionCount: 1,
      documentCount: 1,
      collections: { users: 1 },
      limitations: [],
      checksumAlgorithm: 'sha256',
      checksum: 'a'.repeat(64),
    },
    data: {
      users: [{ id: 'user-1', data: { email: 'encrypted@example.com' } }],
    },
  };
}

describe('Backup automático e migrations versionadas', () => {
  it('não derruba a aplicação quando existe bucket sem chave de backup', () => {
    const result = EnvSchema.safeParse({
      ...productionEnvFixture,
      FIREBASE_STORAGE_BUCKET: 'froc-ia-test.appspot.com',
    });
    expect(result.success).toBe(true);
  });

  it('recusa ativação de backup com chave sem bucket ou curta', () => {
    const missingBucket = EnvSchema.safeParse({
      ...productionEnvFixture,
      BACKUP_ENCRYPTION_KEY: 'segredo-de-backup-com-mais-de-32-caracteres',
    });
    expect(missingBucket.success).toBe(false);

    const shortKey = EnvSchema.safeParse({
      ...productionEnvFixture,
      FIREBASE_STORAGE_BUCKET: 'froc-ia-test.appspot.com',
      BACKUP_ENCRYPTION_KEY: 'curta',
    });
    expect(shortKey.success).toBe(false);
  });

  it('criptografa, autentica e recupera o backup sem perder dados', async () => {
    const original = backupFixture();
    const encrypted = await encryptAutomaticBackup(
      original,
      'segredo-de-backup-com-mais-de-32-caracteres-2026'
    );
    expect(encrypted.payload.includes(Buffer.from('encrypted@example.com'))).toBe(false);

    const restored = await decryptAutomaticBackup(
      encrypted.payload,
      'segredo-de-backup-com-mais-de-32-caracteres-2026'
    );
    expect(restored).toEqual(original);
  });

  it('recusa backup alterado ou chave de criptografia incorreta', async () => {
    const encrypted = await encryptAutomaticBackup(
      backupFixture(),
      'segredo-de-backup-com-mais-de-32-caracteres-2026'
    );
    const tampered = Buffer.from(encrypted.payload);
    tampered[tampered.length - 1] ^= 1;

    await expect(
      decryptAutomaticBackup(
        tampered,
        'segredo-de-backup-com-mais-de-32-caracteres-2026'
      )
    ).rejects.toThrow('automatic_backup_authentication_failed');
  });

  it('retém pelo menos três cópias e remove somente objetos antigos do prefixo oficial', () => {
    const names = selectExpiredBackupNames(
      [
        { name: 'frocia-automatic-backups/2026/08/29/a.enc', createdAt: '2026-08-29T00:00:00Z' },
        { name: 'frocia-automatic-backups/2026/08/28/b.enc', createdAt: '2026-08-28T00:00:00Z' },
        { name: 'frocia-automatic-backups/2026/08/27/c.enc', createdAt: '2026-08-27T00:00:00Z' },
        { name: 'frocia-automatic-backups/2026/07/01/d.enc', createdAt: '2026-07-01T00:00:00Z' },
        { name: 'outro-prefixo/e.enc', createdAt: '2026-01-01T00:00:00Z' },
      ],
      new Date('2026-08-29T12:00:00Z'),
      30
    );
    expect(names).toEqual([
      'frocia-automatic-backups/2026/07/01/d.enc',
    ]);
  });

  it('mantém catálogo ordenado, único e com checksum íntegro', () => {
    expect(validateMigrationCatalog()).toEqual({ valid: true, errors: [] });
    expect(MIGRATION_CATALOG.length).toBeGreaterThan(0);
  });

  it('bloqueia alteração silenciosa ou versão duplicada no catálogo', () => {
    const original = MIGRATION_CATALOG[0];
    const invalid: MigrationDefinition[] = [
      original,
      {
        ...original,
        id: '20260829_002_duplicada',
        description: 'alterada sem checksum correspondente',
      },
    ];
    const validation = validateMigrationCatalog(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain('Versão de migration duplicada');
    expect(validation.errors.join(' ')).toContain('Checksum divergente');
  });
});
