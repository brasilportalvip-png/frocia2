import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const writes: Array<{ collection: string; id: string; data: any }> = [];
  const documents = new Map<string, any>();

  const collection = vi.fn((collectionName: string) => ({
    doc: vi.fn((requestedId?: string) => {
      const id = requestedId || `generated-${writes.length + 1}`;
      return {
        id,
        set: vi.fn(async (data: any) => {
          writes.push({ collection: collectionName, id, data });
          documents.set(`${collectionName}/${id}`, data);
        }),
        get: vi.fn(async () => {
          const data = documents.get(`${collectionName}/${id}`);
          return {
            exists: Boolean(data),
            data: () => data,
          };
        }),
        update: vi.fn(async (data: any) => {
          const current = documents.get(`${collectionName}/${id}`) || {};
          documents.set(`${collectionName}/${id}`, { ...current, ...data });
        }),
        delete: vi.fn(async () => {
          documents.delete(`${collectionName}/${id}`);
        }),
      };
    }),
  }));

  return {
    writes,
    documents,
    adminDb: { collection },
  };
});

vi.mock('../server/lib/firebaseAdmin.js', () => ({
  adminDb: firestore.adminDb,
}));

import { env } from '../server/config/env.js';
import {
  assertMemoryContentAllowed,
  classifyMemorySensitivity,
  memoryQueryFingerprint,
  MemoryPolicyViolationError,
  resolveRetention,
} from '../server/ai/memoryPolicy.js';
import {
  decryptPersonalMemory,
  encryptPersonalMemory,
  MemoryEncryptionUnavailableError,
} from '../server/ai/memoryCryptoService.js';
import { MemoryService } from '../server/ai/memoryService.js';
import {
  buildExtractiveConversationSummary,
} from '../server/ai/conversationContextService.js';
import {
  ContextBuilder,
  ContextLimitExceededError,
  sanitizeConversationHistoryContent,
} from '../server/ai/contextBuilder.js';
import { RAGService } from '../server/ai/ragService.js';
import { PromptRegistry } from '../server/ai/promptRegistry.js';

const originalEncryptionKey = env.MEMORY_ENCRYPTION_KEY;

beforeEach(() => {
  firestore.writes.length = 0;
  firestore.documents.clear();
  vi.restoreAllMocks();
  (env as any).MEMORY_ENCRYPTION_KEY = originalEncryptionKey;
});

describe('Memory privacy policy', () => {
  it('preserva códigos comuns de homologação no histórico autenticado', async () => {
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    vi.spyOn(RAGService, 'retrieveRelevantChunks').mockResolvedValue([]);
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue('Responda com precisão.');

    const priorTurn = 'Guarde nesta conversa o código de homologação JACARANDÁ-47.';
    expect(sanitizeConversationHistoryContent(priorTurn)).toBe(priorTurn);

    const assembled = await ContextBuilder.assemble({
      userId: 'user-1',
      mode: 'smart',
      prompt: 'Qual foi o código informado?',
      recentMessages: [
        { id: 'm1', role: 'user', content: priorTurn },
        { id: 'm2', role: 'assistant', content: 'Código confirmado.' },
      ],
    });

    expect(assembled.userMessage).toContain('JACARANDÁ-47');
    expect(assembled.userMessage).toContain('<historico_nao_confiavel>');
    expect(assembled.userMessage).toContain('[NOVA MENSAGEM DO USUÁRIO]');
  });

  it('blocks credentials, tokens, private keys and complete card data', () => {
    const forbidden = [
      'senha: minha-senha-super-secreta',
      'api_key=abcdefghijklmnop',
      'ghp_abcdefghijklmnopqrstuvwxyz123456',
      'eyJabcdefghijk.eyJabcdefghijk.signature12345',
      '-----BEGIN PRIVATE KEY----- segredo',
      '4111 1111 1111 1111 cvv 123',
    ];

    forbidden.forEach((content) =>
      expect(() => assertMemoryContentAllowed(content)).toThrow(
        MemoryPolicyViolationError
      )
    );
  });

  it('classifies email, phone and CPF as personal data', () => {
    expect(classifyMemorySensitivity('Meu e-mail é flavio@example.com')).toBe('personal');
    expect(classifyMemorySensitivity('Telefone (11) 99999-9999')).toBe('personal');
    expect(classifyMemorySensitivity('CPF 123.456.789-00')).toBe('personal');
    expect(classifyMemorySensitivity('Prefiro respostas curtas')).toBe('standard');
  });

  it('applies bounded retention and a content-free query fingerprint', () => {
    expect(resolveRetention('conversation').retentionDays).toBe(30);
    expect(resolveRetention('user', 900).retentionDays).toBe(730);
    const fingerprint = memoryQueryFingerprint('segredo que não deve aparecer');
    expect(fingerprint).toMatch(/^[a-f0-9]{24}$/);
    expect(fingerprint).not.toContain('segredo');
  });

  it('refuses personal data if application-level encryption is unavailable', () => {
    (env as any).MEMORY_ENCRYPTION_KEY = undefined;
    expect(() =>
      encryptPersonalMemory('flavio@example.com', 'tenant-a', 'user-1')
    ).toThrow(MemoryEncryptionUnavailableError);
  });

  it('encrypts personal data with tenant-bound authenticated encryption', () => {
    (env as any).MEMORY_ENCRYPTION_KEY = 'high-entropy-test-key-that-is-not-used-in-production';
    const encrypted = encryptPersonalMemory(
      'flavio@example.com',
      'tenant-a',
      'user-1'
    );

    expect(JSON.stringify(encrypted)).not.toContain('flavio@example.com');
    expect(
      decryptPersonalMemory(encrypted as any, 'tenant-a', 'user-1')
    ).toBe('flavio@example.com');
    expect(() =>
      decryptPersonalMemory(encrypted as any, 'tenant-b', 'user-1')
    ).toThrow();
  });

  it('persists personal memory only as ciphertext after explicit consent', async () => {
    (env as any).MEMORY_ENCRYPTION_KEY = 'another-high-entropy-test-key';
    await MemoryService.saveMemory(
      'user-1',
      {
        scope: 'user',
        category: 'contato',
        content: 'Meu e-mail é flavio@example.com',
        sensitivity: 'standard',
        userApproved: true,
        consentedAt: new Date().toISOString(),
      },
      'user:user-1'
    );

    const write = firestore.writes.find(
      (entry) => entry.collection === 'user_memories'
    );
    expect(write?.data.content).toBeUndefined();
    expect(write?.data.contentCiphertext).toEqual(expect.any(String));
    expect(write?.data.sensitivity).toBe('personal');
    expect(write?.data.validUntil).toEqual(expect.any(String));
  });

  it('does not persist a memory without explicit consent', async () => {
    await expect(
      MemoryService.saveMemory('user-1', {
        scope: 'user',
        category: 'preferência',
        content: 'Prefiro respostas curtas.',
        userApproved: true,
      })
    ).rejects.toThrow(/consentimento explícito/i);
    expect(firestore.writes).toHaveLength(0);
  });

  it('does not expose personal data through organization-wide memory', async () => {
    await expect(
      MemoryService.saveMemory(
        'user-1',
        {
          scope: 'organization',
          category: 'contato',
          content: 'E-mail pessoal flavio@example.com',
          userApproved: true,
          consentedAt: new Date().toISOString(),
        },
        'tenant-a'
      )
    ).rejects.toMatchObject({
      code: 'personal_organization_memory_forbidden',
    });
  });

  it('prevents a user from updating a memory from another tenant', async () => {
    firestore.documents.set('user_memories/memory-1', {
      userId: 'user-1',
      tenantId: 'tenant-b',
      scope: 'user',
      content: 'Outra empresa',
    });
    await expect(
      MemoryService.updateMemory(
        'user-1',
        'memory-1',
        { content: 'Tentativa de alteração' },
        'tenant-a'
      )
    ).resolves.toBe(false);
  });
});

describe('Conversation continuity and explicit context limits', () => {
  it('prioritizes decisions and keeps references to original messages', () => {
    const result = buildExtractiveConversationSummary([
      { id: 'm1', role: 'user', content: 'Olá, tudo bem?' },
      { id: 'm2', role: 'user', content: 'Decidimos usar PostgreSQL versão 17.' },
      { id: 'm3', role: 'assistant', content: 'A pendência é configurar o deploy.' },
      { id: 'm4', role: 'user', content: 'Obrigado.' },
    ]);

    expect(result.summary).toContain('[msg:m2]');
    expect(result.summary).toContain('PostgreSQL');
    expect(result.summary).toContain('[msg:m3]');
    expect(result.sourceMessageIds).toContain('m2');
  });

  it('preserves a previous summary while adding new confirmed decisions', () => {
    const result = buildExtractiveConversationSummary(
      [{ id: 'm9', role: 'user', content: 'Confirmado: domínio será exemplo.com.' }],
      '[msg:m2] Decisão anterior preservada.'
    );
    expect(result.summary).toContain('Decisão anterior preservada');
    expect(result.summary).toContain('[msg:m9]');
  });

  it('reduces oversized history while preserving at least four recent messages', async () => {
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    vi.spyOn(RAGService, 'retrieveRelevantChunks').mockResolvedValue([]);
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue('Responda com precisão.');

    const assembled = await ContextBuilder.assemble({
      userId: 'user-1',
      mode: 'smart',
      prompt: 'Qual foi a decisão final?',
      recentMessages: Array.from({ length: 6 }, (_, index) => ({
        id: `m${index}`,
        role: index % 2 ? 'assistant' : 'user',
        content: `Mensagem ${index} ${'contexto '.repeat(75)}`,
      })),
      maxContextTokens: 2200,
    });

    expect(assembled.contextTruncated).toBe(true);
    expect(assembled.omittedHistoryCount).toBe(1);
    expect(assembled.userMessage).not.toContain('[msg:m0]');
    expect(assembled.userMessage).toContain('[msg:m1]');
    expect(assembled.userMessage).toContain('[msg:m2]');
    expect(assembled.userMessage).toContain('[msg:m5]');
    expect(assembled.tokenCountEstimate).toBeLessThanOrEqual(2200);
    expect(assembled.systemInstruction).toContain('[LIMITE DE CONTEXTO]');
  });

  it('descarta contexto menos prioritário antes do histórico recente', async () => {
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([
      {
        id: 'memory-1',
        userId: 'user-1',
        tenantId: 'user:user-1',
        scope: 'user',
        scopeId: null,
        category: 'contexto antigo',
        content: 'memória antiga '.repeat(300),
        source: 'user_manual',
        confidence: 1,
        purpose: 'personalization',
        sensitivity: 'standard',
        retentionDays: 365,
        consentVersion: 'memory-consent-v1',
        consentedAt: '2026-09-17T00:00:00.000Z',
        sourceMessageIds: [],
        validFrom: '2026-09-17T00:00:00.000Z',
        validUntil: '2027-09-17T00:00:00.000Z',
        status: 'active',
        userApproved: true,
        createdAt: '2026-09-17T00:00:00.000Z',
        updatedAt: '2026-09-17T00:00:00.000Z',
      },
    ]);
    vi.spyOn(RAGService, 'retrieveRelevantChunks').mockResolvedValue([]);
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue('Responda com precisão.');

    const assembled = await ContextBuilder.assemble({
      userId: 'user-1',
      mode: 'smart',
      prompt: 'Continue a conversa.',
      recentMessages: Array.from({ length: 6 }, (_, index) => ({
        id: `recent-${index}`,
        role: index % 2 ? 'assistant' : 'user',
        content: `Mensagem recente ${index}.`,
      })),
      maxContextTokens: 1550,
    });

    expect(assembled.contextTruncated).toBe(true);
    expect(assembled.memoriesUsed).toHaveLength(0);
    expect(assembled.omittedHistoryCount).toBe(0);
    expect(assembled.userMessage).toContain('[msg:recent-0]');
    expect(assembled.userMessage).toContain('[msg:recent-5]');
  });

  it('falha fechada em vez de remover as quatro mensagens mais recentes', async () => {
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    vi.spyOn(RAGService, 'retrieveRelevantChunks').mockResolvedValue([]);
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue('Base');

    await expect(
      ContextBuilder.assemble({
        userId: 'user-1',
        mode: 'smart',
        prompt: 'Continue.',
        recentMessages: Array.from({ length: 4 }, (_, index) => ({
          id: `protected-${index}`,
          role: index % 2 ? 'assistant' : 'user',
          content: `Contexto indispensável ${index} ${'detalhe '.repeat(300)}`,
        })),
        maxContextTokens: 500,
      })
    ).rejects.toBeInstanceOf(ContextLimitExceededError);
  });

  it('fails closed when even the current request cannot fit safely', async () => {
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue('Base');
    await expect(
      ContextBuilder.assemble({
        userId: 'user-1',
        mode: 'smart',
        prompt: 'x'.repeat(20_000),
        maxContextTokens: 200,
      })
    ).rejects.toBeInstanceOf(ContextLimitExceededError);
  });
});
