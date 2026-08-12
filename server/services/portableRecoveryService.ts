import { createHash } from 'node:crypto';
import {
  FieldPath,
  FieldValue,
  GeoPoint,
  Timestamp
} from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';

const BACKUP_VERSION = 'froc-portable-backup-v1';
const PAGE_SIZE = 400;
const WRITE_BATCH_SIZE = 350;
const MAX_DOCUMENTS = 15_000;
const MAX_SERIALIZED_BYTES = 12_000_000;
const AUDIT_COLLECTION = 'disaster_recovery_audit';

export const PORTABLE_BACKUP_COLLECTIONS = [
  'users',
  'projects',
  'payments',
  'payment_events',
  'credit_transactions',
  'credit_reservations',
  'financial_reconciliation_cases',
  'conversations',
  'messages',
  'user_memories',
  'knowledge_bases',
  'knowledge_documents',
  'knowledge_chunks',
  'ai_executions',
  'ai_evaluations',
  'ai_evaluation_runs',
  'prompt_definitions',
  'prompt_versions',
  'system_config',
  'feature_flag_audit',
  AUDIT_COLLECTION
] as const;

export type PortableBackupCollection =
  (typeof PORTABLE_BACKUP_COLLECTIONS)[number];

interface EncodedSpecialValue {
  __frocType: 'timestamp' | 'geopoint' | 'bytes' | 'date';
  value: unknown;
}

export interface PortableBackupDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface PortableBackupManifest {
  format: typeof BACKUP_VERSION;
  backupId: string;
  projectId: string;
  databaseId: '(default)';
  createdAt: string;
  createdBy: string;
  collectionCount: number;
  documentCount: number;
  collections: Record<string, number>;
  limitations: string[];
  checksumAlgorithm: 'sha256';
  checksum: string;
}

export interface PortableBackupEnvelope {
  manifest: PortableBackupManifest;
  data: Record<string, PortableBackupDocument[]>;
}

export interface PortableBackupValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest: PortableBackupManifest | null;
}

export interface PortableRestoreResult {
  dryRun: boolean;
  backupId: string;
  collectionsProcessed: number;
  documentsProcessed: number;
  startedAt: string;
  completedAt: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

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

function encodeValue(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return {
      __frocType: 'timestamp',
      value: value.toDate().toISOString()
    } satisfies EncodedSpecialValue;
  }

  if (value instanceof Date) {
    return {
      __frocType: 'date',
      value: value.toISOString()
    } satisfies EncodedSpecialValue;
  }

  if (value instanceof GeoPoint) {
    return {
      __frocType: 'geopoint',
      value: {
        latitude: value.latitude,
        longitude: value.longitude
      }
    } satisfies EncodedSpecialValue;
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      __frocType: 'bytes',
      value: Buffer.from(value).toString('base64')
    } satisfies EncodedSpecialValue;
  }

  if (Array.isArray(value)) {
    return value.map(encodeValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([key, nested]) => [key, encodeValue(nested)]
      )
    );
  }

  return value;
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const objectValue = value as Record<string, unknown>;
  const specialType = objectValue.__frocType;

  if (specialType === 'timestamp' || specialType === 'date') {
    if (typeof objectValue.value !== 'string') {
      throw new Error('invalid_encoded_date');
    }

    const parsed = new Date(objectValue.value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('invalid_encoded_date');
    }

    return specialType === 'timestamp'
      ? Timestamp.fromDate(parsed)
      : parsed;
  }

  if (specialType === 'bytes') {
    if (typeof objectValue.value !== 'string') {
      throw new Error('invalid_encoded_bytes');
    }
    return Buffer.from(objectValue.value, 'base64');
  }

  if (specialType === 'geopoint') {
    const coordinates = objectValue.value;
    if (!coordinates || typeof coordinates !== 'object') {
      throw new Error('invalid_encoded_geopoint');
    }

    const latitude = Number(
      (coordinates as Record<string, unknown>).latitude
    );
    const longitude = Number(
      (coordinates as Record<string, unknown>).longitude
    );

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('invalid_encoded_geopoint');
    }

    return new GeoPoint(latitude, longitude);
  }

  return Object.fromEntries(
    Object.entries(objectValue).map(([key, nested]) => [
      key,
      decodeValue(nested)
    ])
  );
}

function safeDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 1_500 &&
    !value.includes('/')
  );
}

function isAllowedCollection(
  value: string
): value is PortableBackupCollection {
  return (PORTABLE_BACKUP_COLLECTIONS as readonly string[]).includes(
    value
  );
}

function payloadForChecksum(
  envelope: Pick<PortableBackupEnvelope, 'manifest' | 'data'>
): unknown {
  const { checksum: _checksum, ...manifestWithoutChecksum } =
    envelope.manifest;

  return {
    manifest: manifestWithoutChecksum,
    data: envelope.data
  };
}

async function audit(input: {
  action: 'backup_created' | 'backup_validated' | 'restore_completed';
  actorUid: string;
  backupId?: string;
  documentCount?: number;
  collectionCount?: number;
  dryRun?: boolean;
  success: boolean;
  details?: string;
}): Promise<void> {
  await adminDb.collection(AUDIT_COLLECTION).add({
    ...input,
    createdAt: FieldValue.serverTimestamp()
  });
}

async function exportCollection(
  collectionName: PortableBackupCollection,
  remainingDocuments: number
): Promise<PortableBackupDocument[]> {
  const result: PortableBackupDocument[] = [];
  let lastDocumentId: string | null = null;

  while (result.length < remainingDocuments) {
    const pageLimit = Math.min(
      PAGE_SIZE,
      remainingDocuments - result.length
    );
    let query = adminDb
      .collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(pageLimit);

    if (lastDocumentId) {
      query = query.startAfter(lastDocumentId);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const document of snapshot.docs) {
      result.push({
        id: document.id,
        data: encodeValue(document.data()) as Record<string, unknown>
      });
    }

    lastDocumentId = snapshot.docs.at(-1)?.id ?? null;
    if (snapshot.size < pageLimit || !lastDocumentId) break;
  }

  return result;
}

export class PortableRecoveryService {
  static async createBackup(input: {
    actorUid: string;
    projectId: string;
  }): Promise<PortableBackupEnvelope> {
    const actorUid = input.actorUid.trim();
    const projectId = input.projectId.trim();

    if (!actorUid || !projectId) {
      throw new Error('backup_identity_required');
    }

    const createdAt = new Date().toISOString();
    const backupId = `froc-backup-${createdAt.replace(/[:.]/g, '-')}`;
    const data: Record<string, PortableBackupDocument[]> = {};
    const collectionCounts: Record<string, number> = {};
    let documentCount = 0;

    for (const collectionName of PORTABLE_BACKUP_COLLECTIONS) {
      const remaining = MAX_DOCUMENTS - documentCount;
      if (remaining <= 0) {
        throw new Error('portable_backup_document_limit_exceeded');
      }

      const documents = await exportCollection(collectionName, remaining);
      data[collectionName] = documents;
      collectionCounts[collectionName] = documents.length;
      documentCount += documents.length;
    }

    const manifest: PortableBackupManifest = {
      format: BACKUP_VERSION,
      backupId,
      projectId,
      databaseId: '(default)',
      createdAt,
      createdBy: actorUid,
      collectionCount: PORTABLE_BACKUP_COLLECTIONS.length,
      documentCount,
      collections: collectionCounts,
      limitations: [
        'Não inclui senhas nem contas do Firebase Authentication.',
        'Não inclui arquivos binários do Firebase Storage.',
        'É um backup manual; a disponibilidade depende do arquivo salvo pelo administrador.',
        'A restauração sobrescreve documentos com o mesmo ID e não exclui documentos ausentes do backup.'
      ],
      checksumAlgorithm: 'sha256',
      checksum: ''
    };

    const envelope: PortableBackupEnvelope = { manifest, data };
    envelope.manifest.checksum = sha256(
      stableStringify(payloadForChecksum(envelope))
    );

    const serializedBytes = Buffer.byteLength(
      JSON.stringify(envelope),
      'utf8'
    );

    if (serializedBytes > MAX_SERIALIZED_BYTES) {
      throw new Error('portable_backup_size_limit_exceeded');
    }

    await audit({
      action: 'backup_created',
      actorUid,
      backupId,
      documentCount,
      collectionCount: PORTABLE_BACKUP_COLLECTIONS.length,
      success: true
    });

    return envelope;
  }

  static validateBackup(
    input: unknown,
    expectedProjectId?: string
  ): PortableBackupValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input || typeof input !== 'object') {
      return {
        valid: false,
        errors: ['O arquivo não contém um backup válido.'],
        warnings,
        manifest: null
      };
    }

    const envelope = input as Partial<PortableBackupEnvelope>;
    const manifest = envelope.manifest as
      | PortableBackupManifest
      | undefined;

    if (!manifest || typeof manifest !== 'object') {
      errors.push('O manifesto do backup está ausente.');
    } else {
      if (manifest.format !== BACKUP_VERSION) {
        errors.push('A versão do backup não é compatível.');
      }
      if (!manifest.backupId || !manifest.createdAt) {
        errors.push('A identificação ou a data do backup está ausente.');
      }
      if (
        expectedProjectId &&
        manifest.projectId !== expectedProjectId
      ) {
        errors.push('O backup pertence a outro projeto Firebase.');
      }
      if (!/^[a-f0-9]{64}$/.test(manifest.checksum || '')) {
        errors.push('O checksum do backup é inválido.');
      }
    }

    if (!envelope.data || typeof envelope.data !== 'object') {
      errors.push('Os dados do backup estão ausentes.');
    } else {
      let countedDocuments = 0;

      for (const [collectionName, documents] of Object.entries(
        envelope.data
      )) {
        if (!isAllowedCollection(collectionName)) {
          errors.push(
            `A coleção “${collectionName}” não é permitida para restauração.`
          );
          continue;
        }

        if (!Array.isArray(documents)) {
          errors.push(`A coleção “${collectionName}” está corrompida.`);
          continue;
        }

        countedDocuments += documents.length;
        for (const document of documents) {
          if (
            !document ||
            typeof document !== 'object' ||
            !safeDocumentId((document as PortableBackupDocument).id) ||
            !(document as PortableBackupDocument).data ||
            typeof (document as PortableBackupDocument).data !== 'object'
          ) {
            errors.push(
              `A coleção “${collectionName}” contém documento inválido.`
            );
            break;
          }
        }
      }

      if (countedDocuments > MAX_DOCUMENTS) {
        errors.push('O backup excede o limite seguro de documentos.');
      }

      if (
        manifest &&
        Number(manifest.documentCount) !== countedDocuments
      ) {
        errors.push('A contagem de documentos não corresponde ao manifesto.');
      }
    }

    if (manifest && envelope.data && errors.length === 0) {
      const expectedChecksum = sha256(
        stableStringify(
          payloadForChecksum({
            manifest,
            data: envelope.data
          } as PortableBackupEnvelope)
        )
      );

      if (expectedChecksum !== manifest.checksum) {
        errors.push(
          'O conteúdo do backup foi alterado ou está corrompido.'
        );
      }
    }

    if (manifest?.limitations?.length) {
      warnings.push(...manifest.limitations);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      manifest: manifest ?? null
    };
  }

  static async restoreBackup(input: {
    backup: unknown;
    actorUid: string;
    projectId: string;
    dryRun: boolean;
  }): Promise<PortableRestoreResult> {
    const startedAt = new Date().toISOString();
    const validation = this.validateBackup(
      input.backup,
      input.projectId
    );

    if (!validation.valid || !validation.manifest) {
      throw new Error(
        `portable_backup_invalid:${validation.errors.join(' | ')}`
      );
    }

    const envelope = input.backup as PortableBackupEnvelope;
    const actorUid = input.actorUid.trim();
    if (!actorUid) throw new Error('restore_actor_required');

    let documentsProcessed = 0;
    let collectionsProcessed = 0;

    if (!input.dryRun) {
      for (const collectionName of PORTABLE_BACKUP_COLLECTIONS) {
        const documents = envelope.data[collectionName] ?? [];
        if (documents.length > 0) collectionsProcessed += 1;

        for (
          let offset = 0;
          offset < documents.length;
          offset += WRITE_BATCH_SIZE
        ) {
          const batch = adminDb.batch();
          const page = documents.slice(
            offset,
            offset + WRITE_BATCH_SIZE
          );

          for (const document of page) {
            const reference = adminDb
              .collection(collectionName)
              .doc(document.id);
            batch.set(
              reference,
              decodeValue(document.data) as Record<string, unknown>
            );
          }

          await batch.commit();
          documentsProcessed += page.length;
        }
      }
    } else {
      collectionsProcessed = Object.values(envelope.data).filter(
        (documents) => documents.length > 0
      ).length;
      documentsProcessed = Object.values(envelope.data).reduce(
        (total, documents) => total + documents.length,
        0
      );
    }

    const completedAt = new Date().toISOString();

    await audit({
      action: input.dryRun
        ? 'backup_validated'
        : 'restore_completed',
      actorUid,
      backupId: validation.manifest.backupId,
      documentCount: documentsProcessed,
      collectionCount: collectionsProcessed,
      dryRun: input.dryRun,
      success: true
    });

    return {
      dryRun: input.dryRun,
      backupId: validation.manifest.backupId,
      collectionsProcessed,
      documentsProcessed,
      startedAt,
      completedAt
    };
  }
}