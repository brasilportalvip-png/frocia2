import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';
import {
  decryptPersonalMemory,
  encryptPersonalMemory,
  protectedMemoryLookupTerms,
} from './memoryCryptoService.js';
import { RedactionService } from '../selfEvolution/redactionService.js';
import { env } from '../config/env.js';
import { EmbeddingService } from './embeddingService.js';
import { orderConversationMessages } from '../utils/conversationMessageOrdering.js';

const SEGMENT_MESSAGE_LIMIT = 12;
const SEGMENT_CHARACTER_LIMIT = 14_000;
const RETRIEVAL_CANDIDATE_LIMIT = 1_000;
const RETRIEVAL_RESULT_LIMIT = 12;
const STATS_DOCUMENT_LIMIT = 20_000;

export interface LongTermSourceMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string | null;
  archivedSegmentId?: string | null;
  archivedVersion?: number;
}

export interface LongTermConversationSegment {
  id: string;
  userId: string;
  tenantId: string;
  conversationId: string;
  conversationTitle: string;
  projectId: string | null;
  content: string;
  sourceMessageIds: string[];
  messageCount: number;
  characterCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingVersion?: 'semantic-v1';
  relevanceScore?: number;
  retrievalReason?: string;
}

export interface LongTermMemoryStats {
  segmentCount: number;
  conversationCount: number;
  preservedMessageCount: number;
  preservedCharacterCount: number;
  resultCapped: boolean;
  encrypted: true;
}

interface SegmentDraft {
  id: string;
  content: string;
  sourceMessageIds: string[];
  messageCount: number;
  characterCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  sourceMessageParts: Array<{ messageId: string; part: number; parts: number }>;
  completedMessageIds: string[];
}

function normalizeText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return RedactionService.redactSensitiveData(value)
    .normalize('NFKC')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function normalizeTerms(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3)
  );
}

function toIsoString(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function deterministicSegmentId(
  tenantId: string,
  conversationId: string,
  sourceMessageIds: string[]
): string {
  return createHash('sha256')
    .update(`${tenantId}:${conversationId}:${sourceMessageIds.join(':')}`)
    .digest('hex');
}

export function buildLongTermConversationSegments(input: {
  tenantId: string;
  conversationId: string;
  messages: LongTermSourceMessage[];
}): SegmentDraft[] {
  const segments: SegmentDraft[] = [];
  let group: Array<{ message: LongTermSourceMessage; text: string; part: number; parts: number }> = [];
  const flush = () => {
    if (!group.length) return;
    const sourceMessageIds = [...new Set(group.map(entry => entry.message.id))];
    const sourceMessageParts = group.map(entry => ({ messageId: entry.message.id, part: entry.part, parts: entry.parts }));
    const completedMessageIds = group.filter(entry => entry.part === entry.parts).map(entry => entry.message.id);
    const content = group.map(entry => entry.text).join('\n');
    segments.push({
      id: deterministicSegmentId(
        input.tenantId,
        input.conversationId,
        ['full-history-v2', ...sourceMessageParts.map(part => JSON.stringify(part))]
      ),
      content,
      sourceMessageIds,
      sourceMessageParts,
      completedMessageIds,
      messageCount: completedMessageIds.length,
      characterCount: content.length,
      firstMessageAt: group[0].message.createdAt || null,
      lastMessageAt: group[group.length - 1].message.createdAt || null,
    });
    group = [];
  };
  for (const message of input.messages) {
    if (message.archivedSegmentId && message.archivedVersion === 2) continue;
    const content = RedactionService.redactSensitiveData(message.content)
      .replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    if (!content) continue;
    const chunks: string[] = [];
    for (let start = 0; start < content.length;) {
      let end = Math.min(start + 12_000, content.length);
      // Nao dividir pares UTF-16 nem perder o final de mensagens extensas.
      if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
      chunks.push(content.slice(start, end));
      start = end;
    }
    // Mensagens multipartes possuem fronteiras estaveis mesmo se o processo
    // cair depois de concluir mensagens anteriores do mesmo lote.
    if (chunks.length > 1) flush();
    chunks.forEach((chunk, index) => {
      const role = message.role === 'assistant' ? 'Assistente' : 'Usuário';
      const text = `[msg:${message.id}] ${role}${chunks.length > 1 ? ` (parte ${index + 1}/${chunks.length})` : ''}: ${chunk}`;
      if (group.length >= SEGMENT_MESSAGE_LIMIT || group.reduce((sum, entry) => sum + entry.text.length + 1, text.length) > SEGMENT_CHARACTER_LIMIT) flush();
      group.push({ message, text, part: index + 1, parts: chunks.length });
      if (chunks.length > 1) flush();
    });
  }
  flush();
  return segments;
}

export function rankLongTermConversationSegments(input: {
  segments: LongTermConversationSegment[];
  prompt: string;
  conversationId?: string | null;
  projectId?: string | null;
  limit?: number;
  queryEmbedding?: number[];
}): LongTermConversationSegment[] {
  const promptTerms = normalizeTerms(input.prompt);
  const continuationIntent =
    /\b(continuar|continue|lembra|lembrar|retomar|paramos|hist[oó]rico|antes|conversa)\b/i.test(
      input.prompt
    );

  return input.segments
    .map((segment, index) => {
      const segmentTerms = normalizeTerms(
        `${segment.conversationTitle} ${segment.content}`
      );
      let overlap = 0;
      promptTerms.forEach((term) => {
        if (segmentTerms.has(term)) overlap += 1;
      });
      const sameConversation =
        Boolean(input.conversationId) &&
        segment.conversationId === input.conversationId;
      const sameProject =
        Boolean(input.projectId) && segment.projectId === input.projectId;
      const semanticSimilarity =
        input.queryEmbedding && segment.embedding
          ? Math.max(
              0,
              EmbeddingService.cosineSimilarity(
                input.queryEmbedding,
                segment.embedding
              )
            )
          : 0;
      const score =
        overlap * 3 +
        semanticSimilarity * 12 +
        (sameConversation ? 8 : 0) +
        (sameProject ? 4 : 0) +
        (continuationIntent && sameConversation ? 3 : 0) +
        Math.max(0, 1 - index / Math.max(1, input.segments.length));

      return {
        ...segment,
        relevanceScore: score,
        retrievalReason: sameConversation
          ? `Trecho histórico da conversa atual; relevância ${score.toFixed(2)}.`
          : sameProject
            ? `Trecho histórico do projeto atual; relevância ${score.toFixed(2)}.`
            : `Conversa anterior relacionada à solicitação; relevância ${score.toFixed(2)}.`,
        eligible:
          sameConversation ||
          sameProject ||
          overlap > 0 ||
          semanticSimilarity >= 0.55,
      };
    })
    .filter((segment) => segment.eligible)
    .sort((a, b) =>
      (b.relevanceScore || 0) - (a.relevanceScore || 0) ||
      b.createdAt.localeCompare(a.createdAt)
    )
    .slice(0, Math.max(1, Math.min(RETRIEVAL_RESULT_LIMIT, input.limit || RETRIEVAL_RESULT_LIMIT)))
    .map(({ eligible: _eligible, ...segment }) => segment);
}

function mapStoredSegment(doc: any): LongTermConversationSegment {
  const data = doc.data();
  const tenantId = String(data.tenantId || `user:${data.userId}`);
  const userId = String(data.userId || '');
  return {
    id: doc.id,
    userId,
    tenantId,
    conversationId: String(data.conversationId || ''),
    conversationTitle: normalizeText(data.conversationTitle, 120) || 'Conversa',
    projectId: typeof data.projectId === 'string' ? data.projectId : null,
    content: decryptPersonalMemory(data, tenantId, userId),
    sourceMessageIds: Array.isArray(data.sourceMessageIds)
      ? data.sourceMessageIds.filter((id: unknown): id is string => typeof id === 'string')
      : [],
    messageCount: Number(data.messageCount || 0),
    characterCount: Number(data.characterCount || 0),
    firstMessageAt: toIsoString(data.firstMessageAt),
    lastMessageAt: toIsoString(data.lastMessageAt),
    createdAt: toIsoString(data.createdAt) || new Date(0).toISOString(),
    embedding: Array.isArray(data.embedding)
      ? data.embedding.filter(
          (value: unknown): value is number =>
            typeof value === 'number' && Number.isFinite(value)
        )
      : undefined,
    embeddingModel:
      typeof data.embeddingModel === 'string'
        ? data.embeddingModel
        : undefined,
    embeddingVersion:
      data.embeddingVersion === 'semantic-v1'
        ? 'semantic-v1'
        : undefined,
  };
}

export class LongTermConversationMemoryService {
  static async archiveOwnedConversation(input: {
    userId: string;
    tenantId: string;
    conversationId: string;
  }): Promise<{ segmentCount: number; archivedMessageCount: number }> {
    if (!adminDb) return { segmentCount: 0, archivedMessageCount: 0 };
    const conversationSnap = await adminDb
      .collection('conversations')
      .doc(input.conversationId)
      .get();
    const conversation = conversationSnap.data();
    if (
      !conversationSnap.exists ||
      !conversation ||
      conversation.userId !== input.userId ||
      (conversation.tenantId || `user:${conversation.userId}`) !== input.tenantId
    ) {
      return { segmentCount: 0, archivedMessageCount: 0 };
    }
    let query = adminDb
      .collection('messages')
      .where('conversationId', '==', input.conversationId)
      .where('userId', '==', input.userId)
      .orderBy('createdAt', 'asc')
      .limit(200);
    if (typeof conversation.longTermMemoryArchiveCursor === 'string') {
      const cursor = await adminDb.collection('messages').doc(conversation.longTermMemoryArchiveCursor).get();
      const data = cursor.data();
      if (cursor.exists && data?.conversationId === input.conversationId && data?.userId === input.userId) query = query.startAfter(cursor);
    }
    const messageSnapshot = await query.get();
    const messages = orderConversationMessages(messageSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), document: doc })))
      .map((doc) => {
        const data = doc.document.data();
        return {
          id: doc.id,
          role: data.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: typeof data.content === 'string' ? data.content : '',
          createdAt: toIsoString(data.createdAt),
          archivedSegmentId:
            typeof data.longTermMemorySegmentId === 'string'
              ? data.longTermMemorySegmentId
              : null,
          archivedVersion: data.longTermMemoryVersion,
        };
      });
    const result = await this.archive({
      ...input,
      maximumNewSegments: 8,
      conversationTitle:
        typeof conversation.title === 'string' ? conversation.title : 'Conversa',
      projectId:
        typeof conversation.projectId === 'string' ? conversation.projectId : null,
      messages,
    });
    const conversationRef = adminDb.collection('conversations').doc(input.conversationId);
    await adminDb.runTransaction(async transaction => {
      const latest = (await transaction.get(conversationRef)).data();
      if (latest?.userId !== input.userId || (latest.tenantId || `user:${latest.userId}`) !== input.tenantId) return;
      // Outra consulta pode ter avancado enquanto o lote era arquivado.
      if ((latest.longTermMemoryArchiveCursor || null) !== (conversation.longTermMemoryArchiveCursor || null)) return;
      transaction.set(conversationRef, {
        longTermMemoryArchiveCursor: result.requiresResume ? conversation.longTermMemoryArchiveCursor || null :
          messageSnapshot.docs.at(-1)?.id || conversation.longTermMemoryArchiveCursor || null,
        longTermMemoryBackfillPending: result.requiresResume || messageSnapshot.size === 200,
        longTermMemoryArchiveCheckedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return result;
  }

  static async archive(input: {
    userId: string;
    tenantId: string;
    conversationId: string;
    conversationTitle: string;
    projectId?: string | null;
    maximumNewSegments?: number;
    messages: LongTermSourceMessage[];
  }): Promise<{ segmentCount: number; archivedMessageCount: number; requiresResume?: boolean }> {
    if (!adminDb) return { segmentCount: 0, archivedMessageCount: 0 };
    const segments = buildLongTermConversationSegments({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      messages: input.messages,
    });
    if (segments.length === 0) {
      return { segmentCount: 0, archivedMessageCount: 0 };
    }

    let archivedMessageCount = 0;
    let segmentCount = 0;
    for (const segment of segments) {
      const segmentRef = adminDb.collection('conversation_memory_segments').doc(segment.id);
      const prior = await segmentRef.get();
      if (prior.data()?.formatVersion === 2) continue;
      if (segmentCount >= (input.maximumNewSegments ?? Number.POSITIVE_INFINITY)) {
        return { segmentCount, archivedMessageCount, requiresResume: true };
      }
      // Falhar antes de chamar embeddings se a chave privada nao estiver pronta.
      const protectedContent = encryptPersonalMemory(segment.content, input.tenantId, input.userId);
      const lookupTokens = protectedMemoryLookupTerms(normalizeTerms(segment.content), input.tenantId, input.userId);
      let embedding: number[] | null = null;
      try {
        embedding = await EmbeddingService.generateEmbedding(segment.content);
      } catch (error) {
        console.warn(
          `Segmento ${segment.id} arquivado sem vetor semântico.`,
          error
        );
      }
      const created = await adminDb.runTransaction(async transaction => {
        const existing = await transaction.get(segmentRef);
        if (existing.data()?.formatVersion === 2) return false;
        transaction.set(
          segmentRef,
          {
            userId: input.userId,
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            conversationTitle: normalizeText(input.conversationTitle, 120) || 'Conversa',
            projectId: input.projectId || null,
            ...protectedContent,
            sourceMessageIds: segment.sourceMessageIds,
            sourceMessageParts: segment.sourceMessageParts,
            completedMessageIds: segment.completedMessageIds,
            formatVersion: 2,
            lookupTokens,
            messageCount: segment.messageCount,
            characterCount: segment.characterCount,
            embedding,
            embeddingModel: embedding
              ? env.GEMINI_EMBEDDING_MODEL
              : null,
            embeddingVersion: embedding
              ? 'semantic-v1'
              : null,
            firstMessageAt: segment.firstMessageAt,
            lastMessageAt: segment.lastMessageAt,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        // A origem so e marcada depois da ultima parte. Uma queda no meio
        // permite retomar as partes restantes sem considerar o texto completo.
        for (const messageId of segment.completedMessageIds) {
          transaction.set(
            adminDb.collection('messages').doc(messageId),
            {
              longTermMemorySegmentId: segment.id,
              longTermMemoryVersion: 2,
              longTermMemoryArchivedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        transaction.set(adminDb.collection('conversations').doc(input.conversationId), {
          longTermMemoryEnabled: true, longTermMemoryFormatVersion: 2,
          longTermMemoryUpdatedAt: FieldValue.serverTimestamp(),
          longTermMemorySegmentCount: FieldValue.increment(1),
          longTermMemoryMessageCount: FieldValue.increment(segment.messageCount),
        }, { merge: true });
        return true;
      });
      if (created) { segmentCount++; archivedMessageCount += segment.messageCount; }
    }
    return { segmentCount, archivedMessageCount };
  }

  static async retrieve(input: {
    userId: string;
    tenantId: string;
    prompt: string;
    conversationId?: string | null;
    projectId?: string | null;
    limit?: number;
  }): Promise<LongTermConversationSegment[]> {
    if (!adminDb) return [];
    try {
      const collection = adminDb.collection('conversation_memory_segments');
      const lookupTokens = protectedMemoryLookupTerms([...normalizeTerms(input.prompt)]
        .sort((a, b) => b.length - a.length).slice(0, 30), input.tenantId, input.userId);
      // A busca indexada cobre o acervo inteiro, inclusive fatos mais antigos
      // que os mil segmentos recentes. A chave HMAC ja vincula a conta/tenant;
      // a identidade de cada documento ainda e conferida antes de descriptografar.
      const indexed = lookupTokens.length ? collection.where('lookupTokens', 'array-contains-any', lookupTokens).limit(250).get() : Promise.resolve(null);
      const recent = adminDb
        .collection('conversation_memory_segments')
        .where('userId', '==', input.userId)
        .where('tenantId', '==', input.tenantId)
        .orderBy('createdAt', 'desc')
        .limit(RETRIEVAL_CANDIDATE_LIMIT)
        .get();
      const results = await Promise.allSettled([recent, indexed]);
      const documents = [...new Map(results.flatMap(result => {
        if (result.status === 'fulfilled') return result.value?.docs || [];
        console.warn('Uma das buscas de memoria esta indisponivel; usando as demais.', result.reason);
        return [];
      }).map(doc => [doc.id, doc])).values()];
      const segments = documents.flatMap((doc) => {
        try {
          const data = doc.data();
          if (data.userId !== input.userId || (data.tenantId || `user:${data.userId}`) !== input.tenantId) return [];
          return [mapStoredSegment(doc)];
        } catch (error) {
          console.warn(`Segmento de memória ${doc.id} ignorado.`, error);
          return [];
        }
      });
      let queryEmbedding: number[] | undefined;
      try {
        queryEmbedding = await EmbeddingService.generateEmbedding(input.prompt);
      } catch (error) {
        console.warn(
          'Busca semântica indisponível; usando relevância lexical segura.',
          error
        );
      }
      return rankLongTermConversationSegments({
        ...input,
        segments,
        queryEmbedding,
      });
    } catch (error) {
      console.warn('Falha ao recuperar memória extensa de conversas.', error);
      return [];
    }
  }

  static async stats(
    userId: string,
    tenantId: string
  ): Promise<LongTermMemoryStats> {
    if (!adminDb) {
      return {
        segmentCount: 0,
        conversationCount: 0,
        preservedMessageCount: 0,
        preservedCharacterCount: 0,
        resultCapped: false,
        encrypted: true,
      };
    }
    const snapshot = await adminDb
      .collection('conversation_memory_segments')
      .where('userId', '==', userId)
      .where('tenantId', '==', tenantId)
      .limit(STATS_DOCUMENT_LIMIT)
      .get();
    const conversationIds = new Set<string>();
    let preservedMessageCount = 0;
    let preservedCharacterCount = 0;
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (typeof data.conversationId === 'string') {
        conversationIds.add(data.conversationId);
      }
      preservedMessageCount += Number(data.messageCount || 0);
      preservedCharacterCount += Number(data.characterCount || 0);
    });
    return {
      segmentCount: snapshot.size,
      conversationCount: conversationIds.size,
      preservedMessageCount,
      preservedCharacterCount,
      resultCapped: snapshot.size >= STATS_DOCUMENT_LIMIT,
      encrypted: true,
    };
  }

  static async deleteConversation(
    userId: string,
    tenantId: string,
    conversationId: string
  ): Promise<number> {
    if (!adminDb) return 0;
    let deleted = 0;
    while (true) {
      const snapshot = await adminDb
        .collection('conversation_memory_segments')
        .where('conversationId', '==', conversationId)
        .where('userId', '==', userId)
        .limit(400)
        .get();
      const owned = snapshot.docs.filter(
        (doc) => (doc.data().tenantId || `user:${doc.data().userId}`) === tenantId
      );
      if (owned.length === 0) break;
      const batch = adminDb.batch();
      owned.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += owned.length;
      if (snapshot.size < 400) break;
    }
    const conversationRef = adminDb.collection('conversations').doc(conversationId);
    const conversation = (await conversationRef.get()).data();
    if (conversation?.userId === userId && (conversation.tenantId || `user:${userId}`) === tenantId) {
      await conversationRef.update({ continuityMemory: FieldValue.delete(), continuityUpdatedAt: FieldValue.delete(),
        longTermMemoryArchiveCursor: FieldValue.delete(), longTermMemoryBackfillPending: false,
        longTermMemorySegmentCount: 0, longTermMemoryMessageCount: 0 });
    }
    return deleted;
  }

  static async deleteAll(
    userId: string,
    tenantId: string
  ): Promise<number> {
    if (!adminDb) return 0;
    let deleted = 0;
    while (true) {
      const snapshot = await adminDb
        .collection('conversation_memory_segments')
        .where('userId', '==', userId)
        .where('tenantId', '==', tenantId)
        .limit(400)
        .get();
      if (snapshot.empty) break;
      const batch = adminDb.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += snapshot.size;
      if (snapshot.size < 400) break;
    }
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    while (true) {
      let query = adminDb.collection('conversations').where('userId', '==', userId).limit(400);
      if (cursor) query = query.startAfter(cursor);
      const conversations = await query.get();
      const batch = adminDb.batch();
      for (const doc of conversations.docs) {
        if ((doc.data().tenantId || `user:${userId}`) !== tenantId) continue;
        batch.update(doc.ref, { continuityMemory: FieldValue.delete(), continuityUpdatedAt: FieldValue.delete(),
          longTermMemoryArchiveCursor: FieldValue.delete(), longTermMemoryBackfillPending: false,
          longTermMemorySegmentCount: 0, longTermMemoryMessageCount: 0 });
      }
      if (!conversations.empty) await batch.commit();
      if (conversations.size < 400) break;
      cursor = conversations.docs.at(-1);
    }
    return deleted;
  }
}
