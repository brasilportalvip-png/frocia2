import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildLongTermConversationSegments,
  rankLongTermConversationSegments,
} from '../server/ai/longTermConversationMemoryService.js';
import { ContextBuilder } from '../server/ai/contextBuilder.js';
import { MemoryService } from '../server/ai/memoryService.js';
import { PromptRegistry } from '../server/ai/promptRegistry.js';
import { RAGService } from '../server/ai/ragService.js';

describe('Memória extensa e hierárquica de conversas', () => {
  it('segmenta históricos grandes sem perder a referência das mensagens originais', () => {
    const messages = Array.from({ length: 25 }, (_, index) => ({
      id: `msg-${index + 1}`,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `Decisão e contexto persistente número ${index + 1}.`,
      createdAt: new Date(2026, 7, 28, 10, index).toISOString(),
    }));
    const first = buildLongTermConversationSegments({
      tenantId: 'tenant-a',
      conversationId: 'conversation-a',
      messages,
    });
    const second = buildLongTermConversationSegments({
      tenantId: 'tenant-a',
      conversationId: 'conversation-a',
      messages,
    });

    expect(first).toHaveLength(3);
    expect(first.map((segment) => segment.messageCount)).toEqual([12, 12, 1]);
    expect(first[0].sourceMessageIds).toEqual(
      Array.from({ length: 12 }, (_, index) => `msg-${index + 1}`)
    );
    expect(first[0].content).toContain('[msg:msg-1]');
    expect(first.map((segment) => segment.id)).toEqual(
      second.map((segment) => segment.id)
    );
  });

  it('não arquiva novamente mensagens que já pertencem a um segmento', () => {
    const segments = buildLongTermConversationSegments({
      tenantId: 'tenant-a',
      conversationId: 'conversation-a',
      messages: [
        {
          id: 'archived',
          role: 'user',
          content: 'Já foi preservada.',
          archivedSegmentId: 'segment-old',
        },
        {
          id: 'new',
          role: 'assistant',
          content: 'Nova informação preservável.',
        },
      ],
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].sourceMessageIds).toEqual(['new']);
  });

  it('remove credenciais antes de criar o segmento criptografado', () => {
    const [segment] = buildLongTermConversationSegments({
      tenantId: 'tenant-a',
      conversationId: 'conversation-a',
      messages: [
        {
          id: 'secret-message',
          role: 'user',
          content: 'Minha senha: segredo123 e token=ghp_abcdefghijklmnopqrstuvwxyz123456',
        },
      ],
    });
    expect(segment.content).toContain('[REDACTED_SECRET]');
    expect(segment.content).not.toContain('segredo123');
    expect(segment.content).not.toContain('ghp_');
  });

  it('recupera primeiro a conversa e o projeto atuais e exige relevância para outras conversas', () => {
    const base = {
      userId: 'user-1',
      tenantId: 'tenant-a',
      projectId: null,
      sourceMessageIds: ['m1'],
      messageCount: 1,
      characterCount: 50,
      firstMessageAt: null,
      lastMessageAt: null,
      createdAt: '2026-08-28T10:00:00.000Z',
    };
    const result = rankLongTermConversationSegments({
      prompt: 'Continue a configuração do domínio e do deploy',
      conversationId: 'current',
      projectId: 'project-a',
      segments: [
        {
          ...base,
          id: 'current-segment',
          conversationId: 'current',
          conversationTitle: 'Configuração',
          content: 'O domínio foi configurado e o deploy ficou pendente.',
        },
        {
          ...base,
          id: 'project-segment',
          conversationId: 'old-project-conversation',
          projectId: 'project-a',
          conversationTitle: 'Projeto A',
          content: 'Checklist do domínio do projeto.',
        },
        {
          ...base,
          id: 'unrelated',
          conversationId: 'other',
          conversationTitle: 'Receitas',
          content: 'Receita de bolo de chocolate.',
        },
      ],
    });

    expect(result.map((segment) => segment.id)).toEqual([
      'current-segment',
      'project-segment',
    ]);
    expect(result[0].retrievalReason).toContain('conversa atual');
  });

  it('recupera significado relacionado mesmo quando as palavras são diferentes', () => {
    const base = {
      userId: 'user-1',
      tenantId: 'tenant-a',
      projectId: null,
      sourceMessageIds: ['m1'],
      messageCount: 1,
      characterCount: 50,
      firstMessageAt: null,
      lastMessageAt: null,
      createdAt: '2026-08-28T10:00:00.000Z',
    };
    const result = rankLongTermConversationSegments({
      prompt: 'Qual foi a decisão sobre manter dados antigos?',
      queryEmbedding: [1, 0, 0],
      segments: [
        {
          ...base,
          id: 'semantic-match',
          conversationId: 'older',
          conversationTitle: 'Arquitetura',
          content: 'Escolhemos persistência histórica criptografada.',
          embedding: [0.98, 0.02, 0],
        },
        {
          ...base,
          id: 'semantic-unrelated',
          conversationId: 'other',
          conversationTitle: 'Culinária',
          content: 'Receita de bolo de chocolate.',
          embedding: [0, 1, 0],
        },
      ],
    });

    expect(result.map((segment) => segment.id)).toEqual(['semantic-match']);
    expect(result[0].relevanceScore).toBeGreaterThan(10);
  });

  it('injeta somente segmentos recuperados e identificados como dados não confiáveis', async () => {
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    vi.spyOn(RAGService, 'retrieveRelevantChunks').mockResolvedValue([]);
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue(
      'Responda com precisão.'
    );

    const assembled = await ContextBuilder.assemble({
      userId: 'user-1',
      tenantId: 'tenant-a',
      mode: 'smart',
      prompt: 'Qual domínio foi escolhido?',
      conversationSummary: {
        summary: '',
        summarySourceMessageIds: [],
        omittedMessageCount: 30,
        historyWindowLimited: true,
        longTermMessagesPreserved: 30,
        longTermSegments: [
          {
            id: 'segment-1',
            conversationId: 'conversation-1',
            conversationTitle: 'Projeto principal',
            content: '[msg:m1] Usuário: O domínio escolhido foi frocia2.vercel.app.',
            sourceMessageIds: ['m1'],
            messageCount: 1,
          },
        ],
      },
    });

    expect(assembled.userMessage).toContain('[MEMÓRIA EXTENSA RECUPERADA');
    expect(assembled.userMessage).toContain('frocia2.vercel.app');
    expect(assembled.userMessage).toContain('origem:msg:m1');
    expect(assembled.longTermSegmentsUsed).toBe(1);
    expect(assembled.longTermMessagesUsed).toBe(1);
  });

  it('mantém segmentos e auditoria inacessíveis diretamente pelo cliente', () => {
    const rules = readFileSync(
      new URL('../firestore.rules', import.meta.url),
      'utf8'
    );
    const routes = readFileSync(
      new URL('../server/routes/memoryRoutes.ts', import.meta.url),
      'utf8'
    );
    expect(rules).toContain('match /conversation_memory_segments/{segmentId}');
    expect(routes).toContain("memoryRouter.get('/long-term/stats'");
    expect(routes).toContain("memoryRouter.delete('/long-term'");
  });
});
