import type { Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Persistência de imagens e vídeos gerados: as mensagens ficam gravadas na conversa
 * (para reaparecerem ao atualizar a página) e o MP4 é copiado para o bucket privado
 * (o link do provedor expira).
 */

const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_VIDEO_BYTES = 80_000_000;

export function parseConversationId(value: unknown): string | null {
  return typeof value === 'string' && CONVERSATION_ID.test(value.trim()) ? value.trim() : null;
}

export interface PersistedMedia {
  id: string;
  type: 'image' | 'video';
  prompt: string;
  status: 'completed';
  aspectRatio?: string;
  creditsSpent?: number;
  /** false quando o arquivo não pôde ser guardado (ex.: bucket não configurado). */
  persisted: boolean;
}

interface PersistInput {
  db: FirebaseFirestore.Firestore | null | undefined;
  userId: string;
  tenantId?: string | null;
  conversationId: string | null;
  prompt: string;
  media: PersistedMedia;
  createdAt?: string;
}

/** Grava o pedido do usuário e a resposta com a mídia na conversa. Idempotente por id da mídia. */
export async function persistMediaConversation(input: PersistInput): Promise<boolean> {
  if (!input.db || !input.conversationId) return false;
  try {
    const conversationRef = input.db.collection('conversations').doc(input.conversationId);
    const conversation = await conversationRef.get();
    if (!conversation.exists || conversation.data()?.userId !== input.userId) return false;

    const base = input.createdAt ? new Date(input.createdAt) : new Date();
    const userAt = Number.isNaN(base.getTime()) ? new Date() : base;
    const aiAt = new Date(userAt.getTime() + 1);
    const common = {
      conversationId: input.conversationId,
      userId: input.userId,
      tenantId: input.tenantId || null,
      attachments: [],
      citations: [],
      executionId: null,
      model: null,
    };
    const batch = input.db.batch();
    batch.set(input.db.collection('messages').doc(`media-user-${input.media.id}`), {
      ...common,
      role: 'user',
      content: input.prompt,
      createdAt: userAt,
    });
    batch.set(input.db.collection('messages').doc(`media-ai-${input.media.id}`), {
      ...common,
      role: 'assistant',
      content: input.media.type === 'image' ? 'Imagem criada com sucesso.' : 'Vídeo criado com sucesso.',
      media: input.media,
      createdAt: aiAt,
    });
    batch.update(conversationRef, { updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    return true;
  } catch (error) {
    console.warn('Não foi possível gravar a mídia na conversa:', error instanceof Error ? error.message : error);
    return false;
  }
}

interface SaveVideoInput {
  db: FirebaseFirestore.Firestore | null | undefined;
  userId: string;
  jobId: string;
  providerUrl: string;
  apiKey: string;
}

/** Copia o MP4 do provedor para o bucket privado. Devolve true se ficou guardado. */
export async function saveVideoToPrivateBucket(input: SaveVideoInput): Promise<boolean> {
  if (!process.env.FIREBASE_STORAGE_BUCKET?.trim() || !input.db) return false;
  try {
    const url = new URL(input.providerUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'generativelanguage.googleapis.com' || !url.pathname.startsWith('/v1beta/files/')) {
      return false;
    }
    const response = await fetch(url, { headers: { 'x-goog-api-key': input.apiKey } });
    if (!response.ok) return false;
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_VIDEO_BYTES) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_VIDEO_BYTES) return false;

    const { getMediaStorageBucket } = await import('../lib/firebaseAdmin.js');
    const bucket = await getMediaStorageBucket();
    const storagePath = `media/${input.userId}/videos/${input.jobId}.mp4`;
    await bucket.file(storagePath).save(bytes, {
      resumable: false,
      contentType: 'video/mp4',
      metadata: { cacheControl: 'private, no-store' },
    });
    const patch = { storageStatus: 'private_bucket', storagePath, updatedAt: new Date().toISOString() };
    await input.db.collection('media_jobs').doc(input.jobId).update(patch);
    await input.db.collection('media_generations').doc(input.jobId).set(patch, { merge: true });
    return true;
  } catch (error) {
    console.warn('Não foi possível guardar o vídeo no bucket privado:', error instanceof Error ? error.message : error);
    return false;
  }
}

/** Entrega o MP4 guardado no bucket. Devolve false se não conseguir (aí vale o caminho do provedor). */
export async function streamStoredVideo(res: Response, storagePath: string, jobId: string): Promise<boolean> {
  try {
    const { getMediaStorageBucket } = await import('../lib/firebaseAdmin.js');
    const bucket = await getMediaStorageBucket();
    const [bytes] = await bucket.file(storagePath).download();
    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="frocia-video-${jobId}.mp4"`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
    return true;
  } catch (error) {
    console.warn('Vídeo guardado indisponível; usando o provedor:', error instanceof Error ? error.message : error);
    return false;
  }
}
