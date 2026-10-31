import { describe, expect, it } from 'vitest';
import { parseConversationId, persistMediaConversation } from '../server/services/mediaPersistence';

function fakeDb(conversation: { exists: boolean; userId?: string }) {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        get: async () => ({ exists: conversation.exists, data: () => ({ userId: conversation.userId }) }),
      }),
    }),
    batch: () => ({
      set: (ref: { path: string }, data: Record<string, unknown>) => writes.push({ path: ref.path, data }),
      update: (ref: { path: string }, data: Record<string, unknown>) => writes.push({ path: `${ref.path}#update`, data }),
      commit: async () => undefined,
    }),
  };
  return { db: db as never, writes };
}

const media = { id: 'img_1_abc', type: 'image' as const, prompt: 'paisagem', status: 'completed' as const, persisted: true };

describe('persistência de mídia na conversa', () => {
  it('valida o id da conversa', () => {
    expect(parseConversationId('abc_123-X')).toBe('abc_123-X');
    expect(parseConversationId('../x')).toBeNull();
    expect(parseConversationId(42)).toBeNull();
  });

  it('grava o pedido e a resposta com a mídia, em ordem', async () => {
    const { db, writes } = fakeDb({ exists: true, userId: 'u1' });
    const ok = await persistMediaConversation({ db, userId: 'u1', conversationId: 'c1', prompt: 'paisagem', media, createdAt: '2026-10-31T10:00:00.000Z' });
    expect(ok).toBe(true);
    const user = writes.find((w) => w.path === 'messages/media-user-img_1_abc')!;
    const ai = writes.find((w) => w.path === 'messages/media-ai-img_1_abc')!;
    expect(user.data.role).toBe('user');
    expect(ai.data.media).toMatchObject({ id: 'img_1_abc', type: 'image' });
    expect((ai.data.createdAt as Date).getTime()).toBeGreaterThan((user.data.createdAt as Date).getTime());
  });

  it('não grava em conversa de outro usuário nem sem conversa', async () => {
    const other = fakeDb({ exists: true, userId: 'outro' });
    expect(await persistMediaConversation({ db: other.db, userId: 'u1', conversationId: 'c1', prompt: 'x', media })).toBe(false);
    expect(other.writes).toHaveLength(0);
    expect(await persistMediaConversation({ db: other.db, userId: 'u1', conversationId: null, prompt: 'x', media })).toBe(false);
  });
});
