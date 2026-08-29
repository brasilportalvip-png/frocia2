import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { getStorage } from 'firebase-admin/storage';
import { adminApp, adminDb } from '../lib/firebaseAdmin.js';
import { env } from '../config/env.js';
import {
  PortableBackupEnvelope,
  PortableRecoveryService,
} from './portableRecoveryService.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const BACKUP_PREFIX = 'frocia-automatic-backups/';
const FILE_FORMAT = 'froc-encrypted-backup-v1';
const MAGIC = Buffer.from('FROCBK01', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface AutomaticBackupResult {
  backupId: string;
  objectName: string;
  bucket: string;
  documentCount: number;
  collectionCount: number;
  plaintextSha256: string;
  encryptedSha256: string;
  encryptedBytes: number;
  verified: boolean;
  expiredObjectsRemoved: number;
  createdAt: string;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function encryptionKey(secret: string): Buffer {
  if (secret.trim().length < 32) {
    throw new Error('automatic_backup_encryption_key_invalid');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

export async function encryptAutomaticBackup(
  backup: PortableBackupEnvelope,
  secret: string
): Promise<{ payload: Buffer; plaintextSha256: string }> {
  const plaintext = Buffer.from(JSON.stringify(backup), 'utf8');
  const compressed = await gzipAsync(plaintext, { level: 9 });
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([
    cipher.update(compressed),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    payload: Buffer.concat([MAGIC, iv, tag, encrypted]),
    plaintextSha256: sha256(plaintext),
  };
}

export async function decryptAutomaticBackup(
  payload: Buffer,
  secret: string
): Promise<PortableBackupEnvelope> {
  const minimumLength = MAGIC.length + IV_BYTES + TAG_BYTES + 1;
  if (
    payload.length < minimumLength ||
    !payload.subarray(0, MAGIC.length).equals(MAGIC)
  ) {
    throw new Error('automatic_backup_format_invalid');
  }

  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const dataStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    payload.subarray(ivStart, tagStart)
  );
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(payload.subarray(tagStart, dataStart));

  let compressed: Buffer;
  try {
    compressed = Buffer.concat([
      decipher.update(payload.subarray(dataStart)),
      decipher.final(),
    ]);
  } catch {
    throw new Error('automatic_backup_authentication_failed');
  }

  const plaintext = await gunzipAsync(compressed);
  try {
    return JSON.parse(plaintext.toString('utf8')) as PortableBackupEnvelope;
  } catch {
    throw new Error('automatic_backup_json_invalid');
  }
}

export function selectExpiredBackupNames(
  objects: Array<{ name: string; createdAt: string }>,
  now: Date,
  retentionDays: number,
  minimumCopies = 3
): string[] {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const ordered = objects
    .filter(
      (item) =>
        item.name.startsWith(BACKUP_PREFIX) &&
        Number.isFinite(Date.parse(item.createdAt))
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return ordered
    .slice(Math.max(0, minimumCopies))
    .filter((item) => Date.parse(item.createdAt) < cutoff)
    .map((item) => item.name);
}

export class AutomaticBackupService {
  static isConfigured(): boolean {
    return Boolean(
      env.FIREBASE_STORAGE_BUCKET?.trim() &&
      (env.BACKUP_ENCRYPTION_KEY?.trim().length || 0) >= 32
    );
  }

  static configuration() {
    return {
      configured: this.isConfigured(),
      bucket: env.FIREBASE_STORAGE_BUCKET || null,
      prefix: BACKUP_PREFIX,
      retentionDays: env.BACKUP_RETENTION_DAYS,
      encrypted: true,
      algorithm: 'AES-256-GCM',
    };
  }

  private static bucket() {
    if (!this.isConfigured()) {
      throw new Error('automatic_backup_not_configured');
    }
    return getStorage(adminApp).bucket(env.FIREBASE_STORAGE_BUCKET!);
  }

  private static async verifyUploadedObject(
    objectName: string,
    expectedProjectId: string,
    expectedPlaintextSha256: string
  ): Promise<boolean> {
    const file = this.bucket().file(objectName);
    const [downloaded] = await file.download();
    const decoded = await decryptAutomaticBackup(
      downloaded,
      env.BACKUP_ENCRYPTION_KEY!
    );
    const validation = PortableRecoveryService.validateBackup(
      decoded,
      expectedProjectId
    );
    const decodedHash = sha256(
      Buffer.from(JSON.stringify(decoded), 'utf8')
    );
    return validation.valid && decodedHash === expectedPlaintextSha256;
  }

  private static async pruneExpired(now: Date): Promise<number> {
    const bucket = this.bucket();
    const [files] = await bucket.getFiles({ prefix: BACKUP_PREFIX });
    const candidates: Array<{ name: string; createdAt: string }> = [];

    for (const file of files) {
      const [metadata] = await file.getMetadata();
      if (metadata.metadata?.frocBackupFormat !== FILE_FORMAT) continue;
      candidates.push({
        name: file.name,
        createdAt: String(metadata.metadata?.createdAt || metadata.timeCreated || ''),
      });
    }

    const expiredNames = selectExpiredBackupNames(
      candidates,
      now,
      env.BACKUP_RETENTION_DAYS
    );
    for (const name of expiredNames) {
      await bucket.file(name).delete({ ignoreNotFound: true });
    }
    return expiredNames.length;
  }

  static async run(actorUid = 'vercel-cron'): Promise<AutomaticBackupResult> {
    const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
    if (!projectId) throw new Error('automatic_backup_project_id_missing');
    if (!this.isConfigured()) throw new Error('automatic_backup_not_configured');

    const createdAt = new Date();
    const backup = await PortableRecoveryService.createBackup({
      actorUid,
      projectId,
    });
    const encrypted = await encryptAutomaticBackup(
      backup,
      env.BACKUP_ENCRYPTION_KEY!
    );
    const datePath = createdAt.toISOString().slice(0, 10).replaceAll('-', '/');
    const objectName = `${BACKUP_PREFIX}${datePath}/${backup.manifest.backupId}.froc.enc`;
    const encryptedSha256 = sha256(encrypted.payload);
    const file = this.bucket().file(objectName);

    await file.save(encrypted.payload, {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: 'application/octet-stream',
        cacheControl: 'private, no-store, max-age=0',
        metadata: {
          frocBackupFormat: FILE_FORMAT,
          backupId: backup.manifest.backupId,
          projectId,
          createdAt: createdAt.toISOString(),
          plaintextSha256: encrypted.plaintextSha256,
          encryptedSha256,
        },
      },
    });

    const verified = await this.verifyUploadedObject(
      objectName,
      projectId,
      encrypted.plaintextSha256
    );
    if (!verified) throw new Error('automatic_backup_verification_failed');
    const expiredObjectsRemoved = await this.pruneExpired(createdAt);

    const result: AutomaticBackupResult = {
      backupId: backup.manifest.backupId,
      objectName,
      bucket: env.FIREBASE_STORAGE_BUCKET!,
      documentCount: backup.manifest.documentCount,
      collectionCount: backup.manifest.collectionCount,
      plaintextSha256: encrypted.plaintextSha256,
      encryptedSha256,
      encryptedBytes: encrypted.payload.length,
      verified,
      expiredObjectsRemoved,
      createdAt: createdAt.toISOString(),
    };

    await adminDb.collection('automatic_backup_runs').add({
      ...result,
      actorUid,
      status: 'verified',
    });
    return result;
  }
}
