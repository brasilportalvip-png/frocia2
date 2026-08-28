import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';
import {
  decryptPersonalMemory,
  encryptPersonalMemory,
} from './memoryCryptoService.js';
import { RedactionService } from '../selfEvolution/redactionService.js';
import { env } from '../config/env.js';
import { EmbeddingService } from './embeddingService.js';

const SEGMENT_MESSAGE_LIMIT = 12;
const MESSAGE_CHARACTER_LIMIT = 1_200;
const SEGMENT_CHARACTER_LIMIT = 14_000;
const RETRIEVAL_CANDIDATE_LIMIT = 250;
const RETRIEVAL_RESULT_LIMIT = 6;
const STATS_DOCUMENT_LIMIT = 5_000;

export interface LongTermSourceMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string | null;
  archivedSegmentId?: string | null;
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
  const eligible = input.messages.filter(
    (message) =>
      !message.archivedSegmentId &&
      Boolean(normalizeText(message.content, MESSAGE_CHARACTER_LIMIT))
  );
  const segments: SegmentDraft[] = [];

  for (let offset = 0; offset < eligible.length; offset += SEGMENT_MESSAGE_LIMIT) {
    const group = eligible.slice(offset, offset + SEGMENT_MESSAGE_LIMIT);
    const sourceMessageIds = group.map((message) => message.id);
    const content = group
      .map((message) => {
        const role = message.role === 'assistant' ? 'Assistente' : 'Usuário';
        return `[msg:${message.id}] ${role}: ${normalizeText(
          message.content,
          MESSAGE_CHARACTER_LIMIT
        )}`;
      })
      .join('\n')
      .slice(0, SEGMENT_CHARACTER_LIMIT);

    if (!content) continue;
    segments.push({
      id: deterministicSegmentId(
        input.tenantId,
        input.conversationId,
        sourceMessageIds
      ),
      content,
      sourceMessageIds,
      messageCount: group.length,
      characterCount: content.length,
      firstMessageAt: group[0]?.createdAt || null,
      lastMessageAt: group[group.length - 1]?.createdAt || null,
    });
  }

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
    const messageSnapshot = await adminDb
      .collection('messages')
      .where('conversationId', '==', input.conversationId)
      .where('userId', '==', input.userId)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    const messages = messageSnapshot.docs
      .slice()
      .reverse()
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          role: data.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: typeof data.content === 'string' ? data.content : '',
          createdAt: toIsoString(data.createdAt),
          archivedSegmentId:
            typeof data.longTermMemorySegmentId === 'string'
              ? data.longTermMemorySegmentId
              : null,
        };
      });
    return this.archive({
      ...input,
      conversationTitle:
        typeof conversation.title === 'string' ? conversation.title : 'Conversa',
      projectId:
        typeof conversation.projectId === 'string' ? conversation.projectId : null,
      messages,
    });
  }

  static async archive(input: {
    userId: string;
    tenantId: string;
    conversationId: string;
    conversationTitle: string;
    projectId?: string | null;
    messages: LongTermSourceMessage[];
  }): Promise<{ segmentCount: number; archivedMessageCount: number }> {
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
    for (const segment of segments) {
      let embedding: number[] | null = null;
      try {
        embedding = await EmbeddingService.generateEmbedding(segment.content);
      } catch (error) {
        console.warn(
          `Segmento ${segment.id} arquivado sem vetor semântico.`,
          error
        );
      }
      const protectedContent = encryptPersonalMemory(
        segment.content,
        input.tenantId,
        input.userId
      );
      const batch = adminDb.batch();
      const segmentRef = adminDb
        .collection('conversation_memory_segments')
        .doc(segment.id);
      batch.set(
        segmentRef,
        {
          userId: input.userId,
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          conversationTitle: normalizeText(input.conversationTitle, 120) || 'Conversa',
          projectId: input.projectId || null,
          ...protectedContent,
          sourceMessageIds: segment.sourceMessageIds,
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
      for (const messageId of segment.sourceMessageIds) {
        batch.set(
          adminDb.collection('messages').doc(messageId),
          {
            longTermMemorySegmentId: segment.id,
            longTermMemoryArchivedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        archivedMessageCount += 1;
      }
      await batch.commit();
    }

    await adminDb.collection('conversations').doc(input.conversationId).set(
      {
        longTermMemoryEnabled: true,
        longTermMemoryUpdatedAt: FieldValue.serverTimestamp(),
        longTermMemorySegmentCount: FieldValue.increment(segments.length),
        longTermMemoryMessageCount: FieldValue.increment(archivedMessageCount),
      },
      { merge: true }
    );

    return { segmentCount: segments.length, archivedMessageCount };
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
      const snapshot = await adminDb
        .collection('conversation_memory_segments')
        .where('userId', '==', input.userId)
        .where('tenantId', '==', input.tenantId)
        .orderBy('createdAt', 'desc')
        .limit(RETRIEVAL_CANDIDATE_LIMIT)
        .get();
      const segments = snapshot.docs.flatMap((doc) => {
        try {
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
    return deleted;
  }
}
