import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';
import {
  LongTermConversationMemoryService,
  LongTermConversationSegment,
} from './longTermConversationMemoryService.js';
import { orderConversationMessages } from '../utils/conversationMessageOrdering.js';
import { buildConversationContinuity, type ConversationContinuity } from './conversationContinuity.js';
import { decryptPersonalMemory, encryptPersonalMemory } from './memoryCryptoService.js';

const RECENT_MESSAGE_LIMIT = 32;
const QUERY_LIMIT = 400;
const SUMMARY_CHARACTER_LIMIT = 24_000;

export interface ConversationContextMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string | null;
  archivedSegmentId?: string | null;
  archivedVersion?: number;
}

export interface ConversationContextSnapshot {
  continuity?: ConversationContinuity;
  summary: string;
  summarySourceMessageIds: string[];
  recentMessages: ConversationContextMessage[];
  omittedMessageCount: number;
  historyWindowLimited: boolean;
  longTermSegments: LongTermConversationSegment[];
  longTermMessagesPreserved: number;
}

function normalizeMessageContent(value: unknown): string {
  if (typeof value !== 'string') return '';

  return value
    .replace(/\r\n/g, '\n')
    .trim();
}

function importanceScore(message: ConversationContextMessage): number {
  const content = message.content;
  let score = message.role === 'user' ? 1 : 0;
  if (/\b(decid|confirm|aprov|aceit|defin|escolh|feito)\w*/i.test(content)) score += 6;
  if (/\b(objetiv|prefer|requisit|regra|restri|n[aã]o pode)\w*/i.test(content)) score += 5;
  if (/\b(pendent|bloque|erro|pr[oó]xim|falta)\w*/i.test(content)) score += 4;
  if (/\b(commit|branch|deploy|vers[aã]o|arquivo|url)\w*/i.test(content)) score += 3;
  return score;
}

export function buildExtractiveConversationSummary(
  messages: ConversationContextMessage[],
  existingSummary = ''
): { summary: string; sourceMessageIds: string[] } {
  const candidates = messages
    .map((message, index) => ({ message, index, score: importanceScore(message) }))
    .filter(({ message }) => message.content.length > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 18)
    .sort((a, b) => a.index - b.index);

  const lines = candidates.map(({ message }) =>
    `[msg:${message.id}] ${message.role === 'user' ? 'Usuário' : 'Assistente'}: ${message.content}`
  );
  const prior = existingSummary.trim();
  const summary = [prior, ...lines]
    .filter(Boolean)
    .join('\n')
    .slice(-SUMMARY_CHARACTER_LIMIT);

  return {
    summary,
    sourceMessageIds: candidates.map(({ message }) => message.id),
  };
}

export class ConversationContextService {
  static async load(input: {
    userId: string;
    tenantId: string;
    conversationId?: string | null;
    projectId?: string | null;
    prompt?: string;
    operationalOnly?: boolean;
  }): Promise<ConversationContextSnapshot> {
    if (!adminDb) {
      return {
        summary: '',
        summarySourceMessageIds: [],
        recentMessages: [],
        omittedMessageCount: 0,
        historyWindowLimited: false,
        longTermSegments: [],
        longTermMessagesPreserved: 0,
      };
    }

    if (!input.conversationId) {
      const longTermSegments = input.operationalOnly ? [] : await LongTermConversationMemoryService.retrieve({
        userId: input.userId,
        tenantId: input.tenantId,
        prompt: input.prompt || '',
        projectId: input.projectId,
      });
      return {
        summary: '',
        summarySourceMessageIds: [],
        recentMessages: [],
        omittedMessageCount: 0,
        historyWindowLimited: false,
        longTermSegments,
        longTermMessagesPreserved: longTermSegments.reduce(
          (total, segment) => total + segment.messageCount,
          0
        ),
      };
    }

    const conversationRef = adminDb
      .collection('conversations')
      .doc(input.conversationId);
    const conversationSnap = await conversationRef.get();
    const conversation = conversationSnap.data();
    const conversationTenant =
      conversation?.tenantId || `user:${conversation?.userId}`;

    if (
      !conversationSnap.exists ||
      !conversation ||
      conversation.userId !== input.userId ||
      conversationTenant !== input.tenantId
    ) {
      throw new Error('Conversa não encontrada ou não pertence ao contexto autenticado.');
    }

    const messageSnap = await adminDb
      .collection('messages')
      .where('conversationId', '==', input.conversationId)
      .where('userId', '==', input.userId)
      .orderBy('createdAt', 'desc')
      .limit(QUERY_LIMIT)
      .get();
    const orderedDocuments = orderConversationMessages(
      messageSnap.docs.map((doc) => ({ id: doc.id, ...doc.data(), document: doc }))
    );
    const messages = orderedDocuments
      .map((doc) => {
        const data = doc.document.data();
        return {
          id: doc.document.id,
          role: data.role === 'assistant' ? 'assistant' : 'user',
          content: normalizeMessageContent(data.content),
          createdAt: data.createdAt
            ? typeof data.createdAt.toDate === 'function'
              ? data.createdAt.toDate().toISOString()
              : new Date(data.createdAt).toISOString()
            : null,
          archivedSegmentId:
            typeof data.longTermMemorySegmentId === 'string'
              ? data.longTermMemorySegmentId
              : null,
          archivedVersion: data.longTermMemoryVersion,
        } as ConversationContextMessage;
      })
      .filter((message) => message.content.length > 0);

    const recentMessages = messages.slice(-RECENT_MESSAGE_LIMIT);
    const olderMessages = messages.slice(0, -RECENT_MESSAGE_LIMIT);
    let continuity = buildConversationContinuity(messages);
    try {
      continuity = await adminDb.runTransaction(async transaction => {
        const latest = await transaction.get(conversationRef);
        const data = latest.data();
        if (!latest.exists || data?.userId !== input.userId || (data.tenantId || `user:${data.userId}`) !== input.tenantId) {
          throw new Error('conversation_continuity_access_denied');
        }
        let previous: ConversationContinuity | null = null;
        if (data.continuityMemory) previous = JSON.parse(decryptPersonalMemory(data.continuityMemory, input.tenantId, input.userId));
        const state = buildConversationContinuity(messages, previous?.version === 1 ? previous : null);
        transaction.set(conversationRef, { continuityMemory: encryptPersonalMemory(JSON.stringify(state), input.tenantId, input.userId),
          continuityUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return state;
      });
    } catch (error) {
      console.warn('Continuidade persistente indisponivel; usando as mensagens verificadas desta consulta.', error);
    }
    const previousIds = Array.isArray(conversation.summarySourceMessageIds)
      ? conversation.summarySourceMessageIds.filter(
          (id: unknown): id is string => typeof id === 'string'
        )
      : [];
    const newOlderMessages = olderMessages.filter(
      (message) => !previousIds.includes(message.id)
    );
    const summaryResult = buildExtractiveConversationSummary(
      newOlderMessages,
      typeof conversation.summary === 'string' ? conversation.summary : ''
    );
    const summarySourceMessageIds = [
      ...new Set([...previousIds, ...summaryResult.sourceMessageIds]),
    ].slice(-100);

    if (olderMessages.length > 0 && summaryResult.summary !== conversation.summary) {
      await conversationRef.update({
        summary: summaryResult.summary,
        summarySourceMessageIds,
        summaryUpdatedAt: FieldValue.serverTimestamp(),
        summarizedMessageCount: FieldValue.increment(newOlderMessages.length),
      });
    }

    try {
      if (!input.operationalOnly) {
        await LongTermConversationMemoryService.archive({
          maximumNewSegments: 8,
          userId: input.userId,
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          conversationTitle:
            typeof conversation.title === 'string' ? conversation.title : 'Conversa',
          projectId:
            typeof conversation.projectId === 'string'
              ? conversation.projectId
              : input.projectId,
          messages: olderMessages,
        });
        // Migra o historico anterior a janela recente em paginas com cursor.
        // Nao existe um teto total de 200/400 mensagens preservaveis.
        if (messageSnap.size >= QUERY_LIMIT || conversation.longTermMemoryBackfillPending) {
          await LongTermConversationMemoryService.archiveOwnedConversation({
            userId: input.userId, tenantId: input.tenantId, conversationId: input.conversationId,
          });
        }
      }
    } catch (error) {
      // A conversa recente continua disponível mesmo se a criptografia ou o
      // armazenamento de memória extensa estiver temporariamente indisponível.
      console.warn('Memória extensa não pôde arquivar este lote.', error);
    }

    const longTermSegments = input.operationalOnly ? [] : await LongTermConversationMemoryService.retrieve({
      userId: input.userId,
      tenantId: input.tenantId,
      prompt: input.prompt || '',
      conversationId: input.conversationId,
      projectId:
        typeof conversation.projectId === 'string'
          ? conversation.projectId
          : input.projectId,
    });

    return {
      continuity,
      summary: summaryResult.summary,
      summarySourceMessageIds,
      recentMessages,
      omittedMessageCount: olderMessages.length,
      historyWindowLimited: messageSnap.size >= QUERY_LIMIT,
      longTermSegments,
      longTermMessagesPreserved: longTermSegments.reduce(
        (total, segment) => total + segment.messageCount,
        0
      ),
    };
  }
}
