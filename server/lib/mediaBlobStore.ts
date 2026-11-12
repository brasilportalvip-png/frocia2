/**
 * Guarda arquivos de mídia (imagens e vídeos gerados).
 *
 * Primeiro tenta o bucket do Firebase Storage. Se o Storage recusar
 * (por exemplo, projeto sem faturamento: "The billing account for the owning
 * project is disabled"), guarda o arquivo no Firestore em pedaços, para a mídia
 * nunca se perder depois de já ter sido gerada e paga.
 */
import { adminDb } from './firebaseAdmin.js';

export const BLOB_CHUNK_BYTES = 900_000;
export const BLOB_MAX_BYTES = 60 * 1024 * 1024;
const COLLECTION = 'media_blobs';

export type BlobStorage = 'private_bucket' | 'firestore_chunks';

export function blobDocId(path: string): string {
  return String(path).replace(/[^A-Za-z0-9_.-]/g, '__');
}

export function splitIntoChunks(bytes: Buffer, size = BLOB_CHUNK_BYTES): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, Math.min(bytes.length, offset + size)));
  }
  return chunks.length ? chunks : [Buffer.alloc(0)];
}

async function saveToFirestore(path: string, bytes: Buffer, contentType: string): Promise<void> {
  if (bytes.length > BLOB_MAX_BYTES) {
    throw new Error('Arquivo de mídia grande demais para guardar.');
  }
  const ref = adminDb.collection(COLLECTION).doc(blobDocId(path));
  const chunks = splitIntoChunks(bytes);
  for (let index = 0; index < chunks.length; index += 1) {
    await ref.collection('chunks').doc(String(index).padStart(4, '0')).set({ index, data: chunks[index] });
  }
  await ref.set({
    path,
    contentType,
    size: bytes.length,
    chunks: chunks.length,
    createdAt: new Date().toISOString(),
  });
}

async function readFromFirestore(path: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const ref = adminDb.collection(COLLECTION).doc(blobDocId(path));
  const meta = await ref.get();
  if (!meta.exists) return null;
  const info = meta.data() as { chunks: number; size: number; contentType: string };
  const snapshot = await ref.collection('chunks').orderBy('index').get();
  const parts = snapshot.docs.map((doc: any) => {
    const data = doc.data().data as any;
    return Buffer.isBuffer(data) ? data : Buffer.from(data?.toUint8Array ? data.toUint8Array() : data);
  });
  if (parts.length !== info.chunks) return null;
  const bytes = Buffer.concat(parts);
  if (bytes.length !== info.size) return null;
  return { bytes, contentType: info.contentType };
}

/** Salva e devolve onde ficou guardado. */
export async function saveMediaBlob(path: string, bytes: Buffer, contentType: string): Promise<BlobStorage> {
  if (process.env.FIREBASE_STORAGE_BUCKET?.trim()) {
    try {
      const { getMediaStorageBucket } = await import('./firebaseAdmin.js');
      const bucket = await getMediaStorageBucket();
      await bucket.file(path).save(bytes, {
        resumable: false,
        contentType,
        metadata: { cacheControl: 'private, no-store' },
      });
      return 'private_bucket';
    } catch (error) {
      console.warn('Storage recusou a mídia; guardando no Firestore:', (error as any)?.message || error);
    }
  }
  await saveToFirestore(path, bytes, contentType);
  return 'firestore_chunks';
}

/** Lê do lugar onde foi guardado (com o outro lugar como reserva). */
export async function readMediaBlob(
  path: string,
  storage?: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (storage !== 'firestore_chunks' && process.env.FIREBASE_STORAGE_BUCKET?.trim()) {
    try {
      const { getMediaStorageBucket } = await import('./firebaseAdmin.js');
      const bucket = await getMediaStorageBucket();
      const file = bucket.file(path);
      const [bytes] = await file.download();
      const [meta] = await file.getMetadata().catch(() => [{} as any]);
      return { bytes, contentType: String(meta?.contentType || '') };
    } catch (error) {
      if (storage === 'private_bucket') console.warn('Falha ao ler mídia do Storage:', (error as any)?.message || error);
    }
  }
  return readFromFirestore(path);
}
