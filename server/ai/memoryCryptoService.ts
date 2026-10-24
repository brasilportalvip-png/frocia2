import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { env } from '../config/env.js';

export class MemoryEncryptionUnavailableError extends Error {
  constructor() {
    super(
      'A criptografia de memórias pessoais não está configurada. Esta informação não foi salva.'
    );
    this.name = 'MemoryEncryptionUnavailableError';
  }
}

export interface EncryptedMemoryContent {
  contentCiphertext: string;
  contentIv: string;
  contentAuthTag: string;
  encryptionVersion: 'aes-256-gcm-v1';
}

function encryptionKey(): Buffer | null {
  const configured = env.MEMORY_ENCRYPTION_KEY?.trim();
  if (!configured) return null;

  // A 32-byte base64/hex key is preferred. Hashing also permits rotation from
  // a high-entropy secret without ever persisting that secret in Firestore.
  return createHash('sha256').update(configured).digest();
}

/** Indice lexical privado: o mesmo termo produz chaves diferentes por conta. */
export function protectedMemoryLookupTerms(terms: Iterable<string>, tenantId: string, userId: string): string[] {
  const key = encryptionKey();
  if (!key) throw new MemoryEncryptionUnavailableError();
  return [...new Set(terms)].map(term => createHmac('sha256', key)
    .update(`conversation-lookup-v1\0${tenantId}\0${userId}\0${term}`)
    .digest().subarray(0, 16).toString('base64url'));
}

export function encryptPersonalMemory(
  content: string,
  tenantId: string,
  userId: string
): EncryptedMemoryContent {
  const key = encryptionKey();
  if (!key) throw new MemoryEncryptionUnavailableError();

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${tenantId}:${userId}`, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(content, 'utf8'),
    cipher.final(),
  ]);

  return {
    contentCiphertext: encrypted.toString('base64'),
    contentIv: iv.toString('base64'),
    contentAuthTag: cipher.getAuthTag().toString('base64'),
    encryptionVersion: 'aes-256-gcm-v1',
  };
}

export function decryptPersonalMemory(
  data: Record<string, unknown>,
  tenantId: string,
  userId: string
): string {
  if (data.encryptionVersion !== 'aes-256-gcm-v1') {
    throw new MemoryEncryptionUnavailableError();
  }

  const key = encryptionKey();
  if (!key) throw new MemoryEncryptionUnavailableError();

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(String(data.contentIv), 'base64')
  );
  decipher.setAAD(Buffer.from(`${tenantId}:${userId}`, 'utf8'));
  decipher.setAuthTag(
    Buffer.from(String(data.contentAuthTag), 'base64')
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(String(data.contentCiphertext), 'base64')
    ),
    decipher.final(),
  ]).toString('utf8');
}
