import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const batchSets: Array<{
    collection: string;
    id: string;
    data: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];
  const directSets: Array<{
    collection: string;
    id: string;
    data: Record<string, unknown>;
  }> = [];

  const document = (collectionName: string, id: string) => ({
    id,
    __collection: collectionName,
    set: vi.fn(async (data: Record<string, unknown>) => {
      directSets.push({ collection: collectionName, id, data });
    }),
  });
  const adminDb = {
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((id: string) => document(collectionName, id)),
    })),
    batch: vi.fn(() => ({
      set: vi.fn(
        (
          ref: ReturnType<typeof document>,
          data: Record<string, unknown>,
          options?: Record<string, unknown>
        ) => {
          batchSets.push({
            collection: ref.__collection,
            id: ref.id,
            data,
            options,
          });
        }
      ),
      commit: vi.fn(async () => undefined),
    })),
  };
  return { adminDb, batchSets, directSets };
});

vi.mock('../server/lib/firebaseAdmin.js', () => ({
  adminDb: firestore.adminDb,
}));

import { env } from '../server/config/env.js';
import { LongTermConversationMemoryService } from '../server/ai/longTermConversationMemoryService.js';

beforeEach(() => {
  firestore.batchSets.length = 0;
  firestore.directSets.length = 0;
  vi.clearAllMocks();
  (env as any).MEMORY_ENCRYPTION_KEY = 'test-only-long-term-memory-encryption-key';
});

describe('Persistência protegida da memória extensa', () => {
  it('grava conteúdo somente como AES-GCM e marca as mensagens de origem', async () => {
    const result = await LongTermConversationMemoryService.archive({
      userId: 'user-1',
      tenantId: 'tenant-a',
      conversationId: 'conversation-1',
      conversationTitle: 'Projeto principal',
      projectId: 'project-1',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'Decidimos publicar no domínio exemplo.com.',
          createdAt: '2026-08-28T10:00:00.000Z',
        },
        {
          id: 'message-2',
          role: 'assistant',
          content: 'A próxima etapa é validar a produção.',
          createdAt: '2026-08-28T10:01:00.000Z',
        },
      ],
    });

    expect(result).toEqual({ segmentCount: 1, archivedMessageCount: 2 });
    const segmentWrite = firestore.batchSets.find(
      (entry) => entry.collection === 'conversation_memory_segments'
    );
    expect(segmentWrite?.data).toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-a',
      conversationId: 'conversation-1',
      projectId: 'project-1',
      encryptionVersion: 'aes-256-gcm-v1',
      messageCount: 2,
    });
    expect(segmentWrite?.data.content).toBeUndefined();
    expect(segmentWrite?.data.contentCiphertext).toEqual(expect.any(String));
    expect(JSON.stringify(segmentWrite?.data)).not.toContain('exemplo.com');
    expect(
      firestore.batchSets.filter((entry) => entry.collection === 'messages')
    ).toHaveLength(2);
    expect(firestore.directSets).toEqual([
      expect.objectContaining({
        collection: 'conversations',
        id: 'conversation-1',
        data: expect.objectContaining({ longTermMemoryEnabled: true }),
      }),
    ]);
  });
});
