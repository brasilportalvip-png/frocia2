import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PORTABLE_BACKUP_COLLECTIONS,
  PortableRecoveryService
} from '../server/services/portableRecoveryService.js';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`
    )
    .join(',')}}`;
}

function checksum(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value), 'utf8')
    .digest('hex');
}

function createValidBackup() {
  const data = {
    users: [
      {
        id: 'user-test-123',
        data: {
          displayName: 'Usuário de homologação',
          role: 'user',
          creditsRemaining: 250,
          createdAt: {
            __frocType: 'timestamp',
            value: '2026-08-08T00:00:00.000Z'
          }
        }
      }
    ]
  };

  const manifest = {
    format: 'froc-portable-backup-v1',
    backupId: 'froc-backup-test-001',
    projectId: 'frocia-e07a5',
    databaseId: '(default)',
    createdAt: '2026-08-08T00:00:00.000Z',
    createdBy: 'admin-test-123',
    collectionCount: 1,
    documentCount: 1,
    collections: { users: 1 },
    limitations: [],
    checksumAlgorithm: 'sha256' as const,
    checksum: ''
  };

  const payload = { manifest, data };
  manifest.checksum = checksum({
    manifest: Object.fromEntries(
      Object.entries(manifest).filter(([key]) => key !== 'checksum')
    ),
    data
  });

  return payload;
}

describe('Backup portátil e recuperação de desastre', () => {
  it('aceita um backup íntegro do projeto correto', () => {
    const backup = createValidBackup();

    const result = PortableRecoveryService.validateBackup(
      backup,
      'frocia-e07a5'
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.manifest?.backupId).toBe(
      'froc-backup-test-001'
    );
  });

  it('detecta qualquer alteração feita após a geração do checksum', () => {
    const backup = createValidBackup();
    backup.data.users[0].data.creditsRemaining = 999_999;

    const result = PortableRecoveryService.validateBackup(
      backup,
      'frocia-e07a5'
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'O conteúdo do backup foi alterado ou está corrompido.'
    );
  });

  it('bloqueia backup pertencente a outro projeto Firebase', () => {
    const backup = createValidBackup();

    const result = PortableRecoveryService.validateBackup(
      backup,
      'outro-projeto-firebase'
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'O backup pertence a outro projeto Firebase.'
    );
  });

  it('rejeita coleção que não pertence à allowlist da Froc.IA', () => {
    const backup = createValidBackup() as ReturnType<
      typeof createValidBackup
    > & {
      data: Record<
        string,
        Array<{ id: string; data: Record<string, unknown> }>
      >;
    };

    backup.data.secrets = [
      {
        id: 'secret-1',
        data: { value: 'não permitido' }
      }
    ];
    backup.manifest.documentCount = 2;
    (
      backup.manifest.collections as Record<string, number>
    ).secrets = 1;
    const { checksum: _checksum, ...manifestWithoutChecksum } =
      backup.manifest;
    backup.manifest.checksum = checksum({
      manifest: manifestWithoutChecksum,
      data: backup.data
    });

    const result = PortableRecoveryService.validateBackup(
      backup,
      'frocia-e07a5'
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'A coleção “secrets” não é permitida para restauração.'
    );
  });


  it('inclui projetos na lista segura do backup portátil', () => {
    expect(PORTABLE_BACKUP_COLLECTIONS).toContain('projects');
  });
});