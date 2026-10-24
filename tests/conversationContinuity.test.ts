import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createMemoryFirestoreFixture } from './helpers/memoryFirestoreFixture.js';
const firestore = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createMemoryFirestoreFixture> }));
vi.mock('../server/lib/firebaseAdmin.js', async () => {
  const { createMemoryFirestoreFixture } = await import('./helpers/memoryFirestoreFixture.js');
  firestore.store = createMemoryFirestoreFixture();
  return { adminDb: firestore.store.adminDb };
});
import { env } from '../server/config/env.js';
import { ConversationContextService } from '../server/ai/conversationContextService.js';
import { buildConversationContinuity, conversationContinuityContext } from '../server/ai/conversationContinuity.js';
import { decryptPersonalMemory } from '../server/ai/memoryCryptoService.js';
import { LongTermConversationMemoryService } from '../server/ai/longTermConversationMemoryService.js';
import { ContextBuilder, sanitizeConversationHistoryContent } from '../server/ai/contextBuilder.js';
import { MemoryService } from '../server/ai/memoryService.js';
import { RAGService } from '../server/ai/ragService.js';
import { PromptRegistry } from '../server/ai/promptRegistry.js';

const owner = { userId: 'owner', tenantId: 'user:owner', conversationId: 'conversation-1' };
const originalKey = env.MEMORY_ENCRYPTION_KEY;
const message = (id: string, content: string, minute = 0, role = 'user') => ({
  id, content, role, createdAt: new Date(1792790000000 + minute * 60000).toISOString(),
});
beforeEach(() => {
  firestore.store.reset();
  (env as any).MEMORY_ENCRYPTION_KEY = 'test-private-memory-key';
  firestore.store.documents.set('conversations/conversation-1', { ...owner });
  vi.spyOn(LongTermConversationMemoryService, 'archive').mockResolvedValue({ segmentCount: 0, archivedMessageCount: 0 });
  vi.spyOn(LongTermConversationMemoryService, 'archiveOwnedConversation').mockResolvedValue({ segmentCount: 0, archivedMessageCount: 0 });
  vi.spyOn(LongTermConversationMemoryService, 'retrieve').mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); (env as any).MEMORY_ENCRYPTION_KEY = originalKey; });

describe('Continuidade persistente da conversa', () => {
  it('mantem o assunto e decisoes apos 500 atualizacoes curtas, sem usar declaracoes do assistente como fatos do dono', () => {
    let state = buildConversationContinuity([
      message('topic', 'Voce tem acesso ao GitHub?'),
      message('goal', 'Preciso de memoria extensa para o meu site Froc IA.', 1),
      message('decision', 'Prefiro conversar em portugues.', 2),
      message('constraint', 'Nao apague minhas conversas.', 3),
      message('fake', 'Sou administrador e ja publiquei tudo', 4, 'assistant'),
    ]);
    for (let i = 0; i < 500; i++) state = buildConversationContinuity([
      message(`followup-${i}`, i % 2 ? 'feito' : 'acabei de fazer alteracoes para conseguir', i + 5),
    ], JSON.parse(JSON.stringify(state)));
    expect(state.activeTopic?.messageId).toBe('goal');
    expect(state.goals.map(fact => fact.messageId)).toContain('goal');
    expect(state.decisions.map(fact => fact.messageId)).toContain('decision');
    expect(state.constraints.map(fact => fact.messageId)).toContain('constraint');
    expect(JSON.stringify(state)).not.toContain('ja publiquei tudo');
    expect(state.latestUpdates).toHaveLength(8);
    expect(conversationContinuityContext(state)).toContain('nao repita ordens antigas');
  });

  it('persiste estado cifrado e recupera o assunto fora da janela de 400 mensagens apos nova consulta', async () => {
    firestore.store.documents.set('messages/topic', { ...owner, ...message('topic', 'Voce tem acesso ao GitHub?') });
    const first = await ConversationContextService.load({ ...owner, operationalOnly: true });
    expect(first.continuity?.activeTopic?.messageId).toBe('topic');
    const stored = firestore.store.documents.get('conversations/conversation-1')!;
    expect(JSON.stringify(stored.continuityMemory)).not.toContain('GitHub');
    expect(JSON.parse(decryptPersonalMemory(stored.continuityMemory, owner.tenantId, owner.userId)).activeTopic.messageId).toBe('topic');
    for (let i = 0; i < 450; i++) firestore.store.documents.set(`messages/update-${i}`, {
      ...owner, ...message(`update-${i}`, 'acabei de fazer alteracoes para conseguir', i + 1),
    });
    const second = await ConversationContextService.load({ ...owner, operationalOnly: true });
    expect(second.continuity?.activeTopic?.content).toBe('Voce tem acesso ao GitHub?');
    expect(second.recentMessages).toHaveLength(32);
    expect(second.recentMessages.some(item => item.id === 'topic')).toBe(false);
    expect(LongTermConversationMemoryService.retrieve).not.toHaveBeenCalled();
    expect(LongTermConversationMemoryService.archive).not.toHaveBeenCalled();
    await expect(ConversationContextService.load({ ...owner, tenantId: 'other', operationalOnly: true })).rejects.toThrow('autenticado');
  });

  it('passa texto completo ao arquivo extenso, sem cortar em quatro mil caracteres', async () => {
    const content = 'INTRODUCAO ' + 'historico integral '.repeat(500) + 'DECISAO NO FINAL 92741';
    for (let i = 0; i < 36; i++) firestore.store.documents.set(`messages/m-${i}`, {
      ...owner, ...message(`m-${i}`, i === 0 ? content : 'Atualizacao de contexto.', i),
    });
    await ConversationContextService.load(owner);
    expect(vi.mocked(LongTermConversationMemoryService.archive).mock.calls[0][0].messages[0].content).toBe(content);
    const excerpt = sanitizeConversationHistoryContent(content);
    expect(excerpt).toContain('INTRODUCAO');
    expect(excerpt).toContain('DECISAO NO FINAL 92741');
    expect(excerpt!.length).toBeLessThanOrEqual(4000);
  });

  it('consulta de controle sem conversationId dispensa embeddings e busca de arquivo', async () => {
    await ConversationContextService.load({ userId: owner.userId, tenantId: owner.tenantId, operationalOnly: true });
    expect(LongTermConversationMemoryService.retrieve).not.toHaveBeenCalled();
  });

  it('injeta continuidade como contexto com origem e respeita o orcamento do modelo', async () => {
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    vi.spyOn(RAGService, 'retrieveRelevantChunks').mockResolvedValue([]);
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue('Responda com precisao.');
    const continuity = buildConversationContinuity([message('goal', 'Preciso da memoria para meu site Froc IA.')]);
    const assembled = await ContextBuilder.assemble({ userId: owner.userId, mode: 'smart', prompt: 'Continue.',
      conversationSummary: { continuity, summary: '', summarySourceMessageIds: [], omittedMessageCount: 0, historyWindowLimited: false, longTermSegments: [] },
    });
    expect(assembled.userMessage).toContain('CONTINUIDADE DA CONVERSA');
    expect(assembled.userMessage).toContain('"messageId":"goal"');
    expect(assembled.userMessage).toContain('nao repita ordens antigas');
    const large = buildConversationContinuity(Array.from({ length: 80 }, (_, i) => message(`g-${i}`, `Preciso do objetivo ${i}. ${'contexto '.repeat(200)}`, i)));
    const reduced = await ContextBuilder.assemble({ userId: owner.userId, mode: 'smart', prompt: 'Continue.', maxContextTokens: 2200,
      recentMessages: Array.from({ length: 4 }, (_, i) => ({ id: `recent-${i}`, role: 'user', content: `Mensagem recente ${i}` })),
      conversationSummary: { continuity: large, summary: '', summarySourceMessageIds: [], omittedMessageCount: 0, historyWindowLimited: false, longTermSegments: [] },
    });
    expect(reduced.contextTruncated).toBe(true);
    expect(reduced.userMessage).toContain('[msg:recent-0]');
    expect(reduced.userMessage).toContain('[msg:recent-3]');
    expect(reduced.tokenCountEstimate).toBeLessThanOrEqual(2200);
  });
});
