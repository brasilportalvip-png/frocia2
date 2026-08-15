import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextBuilder } from '../server/ai/contextBuilder.js';
import { MemoryService } from '../server/ai/memoryService.js';
import { PromptRegistry } from '../server/ai/promptRegistry.js';
import { RAGService } from '../server/ai/ragService.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Base de Conhecimento e RAG', () => {
  it('encaminha somente as bases selecionadas e injeta os trechos recuperados', async () => {
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue(
      'Você é a Froc.IA e deve responder com precisão.'
    );
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);

    const retrieveSpy = vi
      .spyOn(RAGService, 'retrieveRelevantChunks')
      .mockResolvedValue([
        {
          chunk: {
            id: 'chunk-1',
            documentId: 'document-1',
            knowledgeBaseId: 'base-selecionada',
            userId: 'user-test-123',
            text: 'A política oficial concede garantia de 24 meses.',
            section: 'Garantia',
            chunkIndex: 0,
            contentHash: 'hash-1',
            embeddingModel: 'gemini-embedding-2',
            embeddingVersion: 'v1',
            createdAt: '2026-08-08T00:00:00.000Z'
          },
          similarity: 0.96
        }
      ]);

    const result = await ContextBuilder.assemble({
      userId: 'user-test-123',
      mode: 'smart',
      prompt: 'Qual é o prazo da garantia?',
      knowledgeBaseIds: ['base-selecionada']
    });

    expect(retrieveSpy).toHaveBeenCalledTimes(1);
    expect(retrieveSpy).toHaveBeenCalledWith(
      'user-test-123',
      'Qual é o prazo da garantia?',
      ['base-selecionada'],
      3
    );
    expect(result.systemInstruction).toContain(
      '[BASE DE CONHECIMENTO & DOCUMENTOS INDEXADOS]'
    );
    expect(result.systemInstruction).toContain(
      'A política oficial concede garantia de 24 meses.'
    );
    expect(result.ragChunksUsed).toHaveLength(1);
    expect(result.ragChunksUsed[0].knowledgeBaseId).toBe(
      'base-selecionada'
    );
  });

  it('não inventa contexto quando nenhuma parte relevante é encontrada', async () => {
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue(
      'Você é a Froc.IA.'
    );
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    vi.spyOn(RAGService, 'retrieveRelevantChunks').mockResolvedValue([]);

    const result = await ContextBuilder.assemble({
      userId: 'user-test-456',
      mode: 'smart',
      prompt: 'Existe informação sobre este assunto?',
      knowledgeBaseIds: ['base-sem-resultados']
    });

    expect(result.ragChunksUsed).toEqual([]);
    expect(result.systemInstruction).not.toContain(
      '[BASE DE CONHECIMENTO & DOCUMENTOS INDEXADOS]'
    );
  });
});