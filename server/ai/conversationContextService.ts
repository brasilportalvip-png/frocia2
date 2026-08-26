import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';

const RECENT_MESSAGE_LIMIT = 8;
const QUERY_LIMIT = 80;
const SUMMARY_CHARACTER_LIMIT = 4000;

export interface ConversationContextMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationContextSnapshot {
  summary: string;
  summarySourceMessageIds: string[];
  recentMessages: ConversationContextMessage[];
  omittedMessageCount: number;
  historyWindowLimited: boolean;
}

function normalizeMessageContent(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 600);
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
  }): Promise<ConversationContextSnapshot> {
    if (!adminDb || !input.conversationId) {
      return {
        summary: '',
        summarySourceMessageIds: [],
        recentMessages: [],
        omittedMessageCount: 0,
        historyWindowLimited: false,
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
    const messages = messageSnap.docs
      .slice()
      .reverse()
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          role: data.role === 'assistant' ? 'assistant' : 'user',
          content: normalizeMessageContent(data.content),
        } as ConversationContextMessage;
      })
      .filter((message) => message.content.length > 0);

    const recentMessages = messages.slice(-RECENT_MESSAGE_LIMIT);
    const olderMessages = messages.slice(0, -RECENT_MESSAGE_LIMIT);
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

    return {
      summary: summaryResult.summary,
      summarySourceMessageIds,
      recentMessages,
      omittedMessageCount: olderMessages.length,
      historyWindowLimited: messageSnap.size >= QUERY_LIMIT,
    };
  }
}
