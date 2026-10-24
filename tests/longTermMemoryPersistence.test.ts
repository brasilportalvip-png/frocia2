import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createMemoryFirestoreFixture } from './helpers/memoryFirestoreFixture.js';

const firestore = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createMemoryFirestoreFixture> }));
vi.mock('../server/lib/firebaseAdmin.js', async () => {
  const { createMemoryFirestoreFixture } = await import('./helpers/memoryFirestoreFixture.js');
  firestore.store = createMemoryFirestoreFixture();
  return { adminDb: firestore.store.adminDb };
});
import { env } from '../server/config/env.js';
import { LongTermConversationMemoryService as Memory } from '../server/ai/longTermConversationMemoryService.js';
import { decryptPersonalMemory, encryptPersonalMemory, protectedMemoryLookupTerms } from '../server/ai/memoryCryptoService.js';
import { EmbeddingService } from '../server/ai/embeddingService.js';

const owner = { userId: 'user-1', tenantId: 'tenant-a', conversationId: 'conversation-1' };
const originalKey = env.MEMORY_ENCRYPTION_KEY;
beforeEach(() => {
  firestore.store.reset();
  (env as any).MEMORY_ENCRYPTION_KEY = 'test-only-long-term-memory-encryption-key';
  vi.spyOn(EmbeddingService, 'generateEmbedding').mockResolvedValue([1, 0]);
  firestore.store.documents.set('conversations/conversation-1', { ...owner, title: 'Projeto principal' });
});
afterEach(() => { vi.restoreAllMocks(); (env as any).MEMORY_ENCRYPTION_KEY = originalKey; });
const segmentEntries = () => [...firestore.store.documents].filter(([key]) => key.startsWith('conversation_memory_segments/'));

describe('Persistencia protegida e retomavel da memoria extensa', () => {
  it('grava AES-GCM e indice privado, marca as origens e nao duplica contadores no retry', async () => {
    const input = { ...owner, conversationTitle: 'Projeto principal', projectId: 'project-1', messages: [
      { id: 'm1', role: 'user' as const, content: 'Decidimos publicar no dominio exemplo.com.' },
      { id: 'm2', role: 'assistant' as const, content: 'A proxima etapa e validar a producao.' },
    ] };
    expect(await Memory.archive(input)).toEqual({ segmentCount: 1, archivedMessageCount: 2 });
    const [, data] = segmentEntries()[0];
    expect(data).toMatchObject({ ...owner, projectId: 'project-1', encryptionVersion: 'aes-256-gcm-v1', formatVersion: 2, messageCount: 2 });
    expect(data.content).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('exemplo.com');
    expect(data.lookupTokens).toContain(protectedMemoryLookupTerms(['exemplo'], owner.tenantId, owner.userId)[0]);
    expect(protectedMemoryLookupTerms(['exemplo'], 'other', owner.userId)).not.toEqual(protectedMemoryLookupTerms(['exemplo'], owner.tenantId, owner.userId));
    expect(decryptPersonalMemory(data, owner.tenantId, owner.userId)).toContain('exemplo.com');
    expect(firestore.store.documents.get('messages/m1')).toMatchObject({ longTermMemoryVersion: 2 });
    expect(await Memory.archive(input)).toEqual({ segmentCount: 0, archivedMessageCount: 0 });
    expect(firestore.store.documents.get('conversations/conversation-1')).toMatchObject({ longTermMemorySegmentCount: 1, longTermMemoryMessageCount: 2 });
    expect(EmbeddingService.generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it('retoma um texto de 180 mil caracteres interrompido sem considerar a mensagem completa antes da ultima parte', async () => {
    const content = 'Texto original sem corte. '.repeat(7500) + 'FINAL UNICO 92741';
    const input = { ...owner, conversationTitle: 'Historia', messages: [{ id: 'long', role: 'user' as const, content }] };
    firestore.store.failAtTransaction(3);
    await expect(Memory.archive(input)).rejects.toThrow('injected_commit_interruption');
    expect(segmentEntries()).toHaveLength(2);
    expect(firestore.store.documents.get('messages/long')).toBeUndefined();
    firestore.store.failAtTransaction(null);
    expect((await Memory.archive(input)).archivedMessageCount).toBe(1);
    const parts = segmentEntries().map(([, data]) => ({ part: data.sourceMessageParts[0].part,
      text: decryptPersonalMemory(data, owner.tenantId, owner.userId).replace(/^.*?: /, '') })).sort((a, b) => a.part - b.part);
    expect(parts.map(part => part.text).join('')).toBe(content);
    expect(firestore.store.documents.get('messages/long')).toMatchObject({ longTermMemoryVersion: 2 });
    expect(firestore.store.documents.get('conversations/conversation-1')?.longTermMemoryMessageCount).toBe(1);
  });

  it('limita trabalho por requisicao e retoma partes pendentes na proxima', async () => {
    const input = { ...owner, conversationTitle: 'Extensa', maximumNewSegments: 2,
      messages: [{ id: 'large', role: 'user' as const, content: 'conteudo '.repeat(8000) }] };
    const first = await Memory.archive(input);
    expect(first).toMatchObject({ segmentCount: 2, archivedMessageCount: 0, requiresResume: true });
    expect(firestore.store.documents.get('messages/large')).toBeUndefined();
    for (let i = 0; i < 4; i++) await Memory.archive(input);
    expect(firestore.store.documents.get('messages/large')).toMatchObject({ longTermMemoryVersion: 2 });
    expect(firestore.store.documents.get('conversations/conversation-1')?.longTermMemoryMessageCount).toBe(1);
  });

  it('percorre 450 mensagens antigas por paginas sem teto total e protege o cursor contra falha', async () => {
    for (let i = 0; i < 450; i++) firestore.store.documents.set(`messages/m${String(i).padStart(4, '0')}`, {
      ...owner, content: `Mensagem preservavel numero ${i}`, role: 'user', createdAt: new Date(1760000000000 + i * 1000).toISOString(),
    });
    firestore.store.failAtTransaction(1);
    await expect(Memory.archiveOwnedConversation(owner)).rejects.toThrow('injected_commit_interruption');
    expect(firestore.store.documents.get('conversations/conversation-1')?.longTermMemoryArchiveCursor).toBeUndefined();
    firestore.store.failAtTransaction(null);
    for (let i = 0; i < 12; i++) await Memory.archiveOwnedConversation(owner);
    const messages = [...firestore.store.documents].filter(([key]) => key.startsWith('messages/'));
    expect(messages.filter(([, value]) => value.longTermMemoryVersion === 2)).toHaveLength(450);
    expect(firestore.store.documents.get('conversations/conversation-1')).toMatchObject({ longTermMemoryMessageCount: 450, longTermMemoryArchiveCursor: 'm0449', longTermMemoryBackfillPending: false });
    expect(await Memory.archiveOwnedConversation({ ...owner, tenantId: 'other' })).toEqual({ segmentCount: 0, archivedMessageCount: 0 });
  });

  it.each([false, true])('busca fatos anteriores aos mil recentes, mesmo com falha da consulta recente: %s', async failRecent => {
    const lookupTokens = protectedMemoryLookupTerms(['jacaranda92741'], owner.tenantId, owner.userId);
    for (let i = 0; i < 1005; i++) firestore.store.documents.set(`conversation_memory_segments/new-${i}`, {
      ...owner, conversationId: 'unrelated', createdAt: `2026-10-23T${String(i).padStart(5, '0')}`, lookupTokens: [],
      ...encryptPersonalMemory('contexto sem relacao', owner.tenantId, owner.userId),
    });
    firestore.store.documents.set('conversation_memory_segments/old-decision', {
      ...owner, createdAt: '2025-01-01T00:00:00Z', lookupTokens,
      ...encryptPersonalMemory('Codigo escolhido: JACARANDA92741. Dominio antigo preservado.', owner.tenantId, owner.userId),
    });
    // Um resultado inconsistente nunca deve ser descriptografado como outra conta.
    firestore.store.documents.set('conversation_memory_segments/foreign', {
      ...owner, userId: 'stranger', tenantId: 'other', createdAt: '2026-01-01', lookupTokens,
      ...encryptPersonalMemory('DADO PRIVADO EXTERNO', 'other', 'stranger'),
    });
    firestore.store.failRecent(failRecent);
    vi.mocked(EmbeddingService.generateEmbedding).mockRejectedValue(new Error('semantic_service_unavailable'));
    const result = await Memory.retrieve({ ...owner, prompt: 'Qual foi o codigo JACARANDA92741?' });
    expect(result[0]).toMatchObject({ id: 'old-decision', userId: owner.userId });
    expect(result.some(segment => segment.id === 'foreign')).toBe(false);
  });

  it('nao envia conteudo ao provedor nem grava texto aberto se falta a chave', async () => {
    (env as any).MEMORY_ENCRYPTION_KEY = '';
    await expect(Memory.archive({ ...owner, conversationTitle: 'Privada',
      messages: [{ id: 'secret', role: 'user', content: 'Preferencia pessoal importante' }] })).rejects.toThrow('criptografia');
    expect(segmentEntries()).toHaveLength(0);
    expect(EmbeddingService.generateEmbedding).not.toHaveBeenCalled();
  });

  it('a exclusao da memoria remove tambem a continuidade cifrada, preservando outras contas', async () => {
    const state = encryptPersonalMemory('objetivos privados do usuario', owner.tenantId, owner.userId);
    firestore.store.documents.set('conversations/conversation-1', { ...owner, continuityMemory: state, longTermMemoryArchiveCursor: 'm1' });
    firestore.store.documents.set('conversations/other-tenant', { ...owner, tenantId: 'other', continuityMemory: state });
    firestore.store.documents.set('conversations/other-user', { ...owner, userId: 'other-user', continuityMemory: state });
    await Memory.deleteAll(owner.userId, owner.tenantId);
    expect(firestore.store.documents.get('conversations/conversation-1')?.continuityMemory).toBeUndefined();
    expect(firestore.store.documents.get('conversations/conversation-1')?.longTermMemoryArchiveCursor).toBeUndefined();
    expect(firestore.store.documents.get('conversations/other-tenant')?.continuityMemory).toEqual(state);
    expect(firestore.store.documents.get('conversations/other-user')?.continuityMemory).toEqual(state);
  });
});
