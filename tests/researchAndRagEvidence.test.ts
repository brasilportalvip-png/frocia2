import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CitationService,
  normalizePublicHttpsUrl,
} from '../server/ai/citationService.js';
import { ContextBuilder } from '../server/ai/contextBuilder.js';
import { MemoryService } from '../server/ai/memoryService.js';
import { PromptRegistry } from '../server/ai/promptRegistry.js';
import {
  isKnowledgeChunkEligible,
  RAGService,
} from '../server/ai/ragService.js';
import { ResearchEvidenceService } from '../server/ai/researchEvidenceService.js';
import {
  KnowledgeChunk,
  MessageCitation,
} from '../server/ai/types/ai.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const webCitation = (
  domain: string,
  index = 1
): MessageCitation => ({
  index,
  title: domain,
  uri: `https://${domain}/evidence`,
  sourceType: 'web',
  domain,
});

const ragChunk: KnowledgeChunk = {
  id: 'chunk-active',
  documentId: 'document-active',
  knowledgeBaseId: 'base-a',
  userId: 'user-a',
  text: 'Política oficial com vigência registrada.',
  filename: 'politica.md',
  chunkIndex: 0,
  contentHash: 'hash-active',
  revisionId: 'revision-active',
  documentVersion: 'v2',
  embeddingModel: 'gemini-embedding-2',
  embeddingVersion: 'v2',
  createdAt: '2026-08-26T00:00:00.000Z',
};

describe('Pesquisa real e evidência verificável', () => {
  it('aceita somente URLs HTTPS públicas sem credenciais', () => {
    expect(
      normalizePublicHttpsUrl('https://example.com/source')?.href
    ).toBe('https://example.com/source');
    expect(normalizePublicHttpsUrl('http://example.com')).toBeNull();
    expect(normalizePublicHttpsUrl('https://localhost/admin')).toBeNull();
    expect(normalizePublicHttpsUrl('https://127.0.0.1/private')).toBeNull();
    expect(normalizePublicHttpsUrl('https://169.254.169.254/latest')).toBeNull();
    expect(normalizePublicHttpsUrl('https://[::1]/private')).toBeNull();
    expect(normalizePublicHttpsUrl('https://user:secret@example.com')).toBeNull();
    expect(normalizePublicHttpsUrl('javascript:alert(1)')).toBeNull();
  });

  it('remove fontes inseguras e duplicadas do grounding', () => {
    const citations =
      CitationService.extractSearchGroundingCitations({
        groundingChunks: [
          {
            web: {
              uri: 'https://example.com/fato#trecho',
              title: 'Fonte principal',
            },
          },
          {
            web: {
              uri: 'https://example.com/fato',
              title: 'Duplicada',
            },
          },
          {
            web: {
              uri: 'https://10.0.0.8/segredo',
              title: 'Rede privada',
            },
          },
        ],
      });

    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      index: 1,
      uri: 'https://example.com/fato',
      domain: 'example.com',
    });
  });

  it('usa a ferramenta real de Google Search grounding', () => {
    const providerSource = readFileSync(
      new URL('../server/ai/providers/geminiProvider.ts', import.meta.url),
      'utf8'
    );

    expect(providerSource).toContain('googleSearch: {}');
    expect(providerSource).toContain('groundingMetadata');
  });

  it('bloqueia uma conclusão atual quando o provedor não retorna fonte', () => {
    const result = ResearchEvidenceService.finalize({
      text: 'O preço atual é R$ 100.',
      citations: [],
      requiresSearch: true,
      sensitivity: 'normal',
      knowledgeBaseRequested: false,
      ragChunksUsed: [],
    });

    expect(result.researchStatus).toBe('unsupported');
    expect(result.text).toContain('não vou afirmar uma conclusão sem evidência');
    expect(result.text).not.toContain('R$ 100');
  });

  it('marca pesquisa sensível com uma única origem como limitada', () => {
    const result = ResearchEvidenceService.finalize({
      text: 'Informação geral de saúde.',
      citations: [webCitation('saude.gov.br')],
      requiresSearch: true,
      sensitivity: 'high-stakes',
      knowledgeBaseRequested: false,
      ragChunksUsed: [],
    });

    expect(result.researchStatus).toBe('limited');
    expect(result.text).toContain('evidência limitada');
  });

  it('aceita duas origens distintas para pesquisa sensível', () => {
    const result = ResearchEvidenceService.finalize({
      text: 'Síntese sustentada.',
      citations: [
        webCitation('gov.br', 1),
        webCitation('who.int', 2),
      ],
      requiresSearch: true,
      sensitivity: 'high-stakes',
      knowledgeBaseRequested: false,
      ragChunksUsed: [],
    });

    expect(result.researchStatus).toBe('supported');
    expect(result.sourceDomains).toEqual(['gov.br', 'who.int']);
  });
});

describe('RAG privado, versionado e fail-closed', () => {
  const chunkData = {
    userId: 'user-a',
    knowledgeBaseId: 'base-a',
    revisionId: 'revision-active',
    expiresAt: null,
  };
  const documentState = {
    userId: 'user-a',
    knowledgeBaseId: 'base-a',
    status: 'indexed',
    activeRevisionId: 'revision-active',
    expiresAt: null,
  };
  const context = {
    userId: 'user-a',
    selectedBaseIds: new Set(['base-a']),
    now: new Date('2026-08-26T12:00:00.000Z'),
  };

  it('aceita somente a revisão ativa do usuário e da base selecionada', () => {
    expect(
      isKnowledgeChunkEligible(chunkData, documentState, context)
    ).toBe(true);
    expect(
      isKnowledgeChunkEligible(
        { ...chunkData, userId: 'user-b' },
        documentState,
        context
      )
    ).toBe(false);
    expect(
      isKnowledgeChunkEligible(
        { ...chunkData, knowledgeBaseId: 'base-b' },
        documentState,
        context
      )
    ).toBe(false);
    expect(
      isKnowledgeChunkEligible(
        { ...chunkData, revisionId: 'revision-old' },
        documentState,
        context
      )
    ).toBe(false);
  });

  it('descarta documento expirado ou não indexado', () => {
    expect(
      isKnowledgeChunkEligible(
        chunkData,
        {
          ...documentState,
          expiresAt: '2026-08-25T00:00:00.000Z',
        },
        context
      )
    ).toBe(false);
    expect(
      isKnowledgeChunkEligible(
        chunkData,
        { ...documentState, status: 'processing' },
        context
      )
    ).toBe(false);
  });

  it('não consulta nenhuma base privada sem seleção explícita', async () => {
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue(
      'Você é a Froc.IA.'
    );
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    const retrieveSpy = vi
      .spyOn(RAGService, 'retrieveRelevantChunks')
      .mockResolvedValue([]);

    const result = await ContextBuilder.assemble({
      userId: 'user-a',
      mode: 'smart',
      prompt: 'Responda normalmente.',
    });

    expect(retrieveSpy).not.toHaveBeenCalled();
    expect(result.ragChunksUsed).toEqual([]);
  });

  it('informa ausência de sustentação documental', () => {
    const result = ResearchEvidenceService.finalize({
      text: 'Resposta que não veio dos documentos.',
      citations: [],
      requiresSearch: false,
      sensitivity: 'normal',
      knowledgeBaseRequested: true,
      ragChunksUsed: [],
    });

    expect(result.ragStatus).toBe('unsupported');
    expect(result.text).toContain('Não encontrei trechos relevantes');
    expect(result.text).not.toContain('não veio dos documentos');
  });

  it('preserva proveniência na citação de documento', () => {
    const citation = CitationService.buildRAGCitationPill(ragChunk);

    expect(citation).toMatchObject({
      title: 'politica.md',
      sourceType: 'knowledge_base',
      docId: 'document-active',
    });
    expect(citation.snippet).toContain('vigência registrada');
  });

  it('expõe reindexação e fontes no fluxo real da interface', () => {
    const routeSource = readFileSync(
      new URL('../server/routes/knowledgeRoutes.ts', import.meta.url),
      'utf8'
    );
    const appSource = readFileSync(
      new URL('../src/App.tsx', import.meta.url),
      'utf8'
    );
    const chatSource = readFileSync(
      new URL('../src/components/ChatCentral.tsx', import.meta.url),
      'utf8'
    );

    expect(routeSource).toContain(
      '/knowledge-bases/:id/documents/:documentId/reindex'
    );
    expect(routeSource).toContain('activeRevisionId');
    expect(appSource).toContain('citations: result.citations ?? []');
    expect(chatSource).toContain('Fontes verificáveis');
    expect(chatSource).toContain('rel="noopener noreferrer"');
  });
});
