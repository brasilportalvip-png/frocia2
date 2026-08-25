import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const state = { docs: [] as any[] };
  const query = {
    where: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
  } as any;
  query.where.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.get.mockImplementation(async () => ({ docs: state.docs }));

  return {
    state,
    query,
    adminDb: {
      collection: vi.fn(() => query),
    },
  };
});

vi.mock('../server/lib/firebaseAdmin.js', () => ({
  adminDb: firestore.adminDb,
}));

import { MemoryService } from '../server/ai/memoryService.js';

function memoryDoc(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  const now = new Date().toISOString();
  return {
    id,
    data: () => ({
      userId: 'user-1',
      scope: 'user',
      scopeId: null,
      category: 'geral',
      content: `Memória ${id}`,
      source: 'user_manual',
      confidence: 1,
      validFrom: now,
      validUntil: null,
      status: 'active',
      userApproved: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    }),
  };
}

beforeEach(() => {
  firestore.state.docs = [];
  vi.clearAllMocks();
  firestore.query.where.mockReturnValue(firestore.query);
  firestore.query.limit.mockReturnValue(firestore.query);
  firestore.query.get.mockImplementation(async () => ({
    docs: firestore.state.docs,
  }));
  firestore.adminDb.collection.mockReturnValue(firestore.query);
});

describe('Controlled AI memory', () => {
  it('uses only approved, valid and correctly scoped memories', async () => {
    firestore.state.docs = [
      memoryDoc('approved', {
        content: 'O usuário prefere respostas em português.',
      }),
      memoryDoc('not-approved', { userApproved: false }),
      memoryDoc('expired', {
        validUntil: '2020-01-01T00:00:00.000Z',
      }),
      memoryDoc('future', {
        validFrom: '2099-01-01T00:00:00.000Z',
      }),
      memoryDoc('wrong-project', {
        scope: 'project',
        scopeId: 'another-project',
      }),
      memoryDoc('right-project', {
        scope: 'project',
        scopeId: 'project-1',
        content: 'Este projeto usa acessibilidade WCAG.',
      }),
    ];

    const memories = await MemoryService.getActiveMemories(
      'user-1',
      'project-1',
      null,
      'Responda em português sobre acessibilidade.'
    );

    expect(memories.map((memory) => memory.id)).toEqual([
      'right-project',
      'approved',
    ]);
  });

  it('limits context and prioritizes memories relevant to the prompt', async () => {
    firestore.state.docs = [
      ...Array.from({ length: 12 }, (_, index) =>
        memoryDoc(`generic-${index}`)
      ),
      memoryDoc('relevant', {
        content: 'Prefere sempre conteúdo sobre restaurantes veganos.',
        category: 'preferência',
      }),
    ];

    const memories = await MemoryService.getActiveMemories(
      'user-1',
      null,
      null,
      'Quero um site para restaurantes veganos.'
    );

    expect(memories).toHaveLength(12);
    expect(memories[0].id).toBe('relevant');
  });

  it('lists paused memories for management but omits deleted records', async () => {
    firestore.state.docs = [
      memoryDoc('paused', {
        userApproved: false,
        updatedAt: '2026-08-25T12:00:00.000Z',
      }),
      memoryDoc('deleted', { status: 'deleted' }),
    ];

    const memories = await MemoryService.listMemories('user-1');

    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      id: 'paused',
      userApproved: false,
    });
    expect(firestore.query.limit).toHaveBeenCalledWith(200);
  });
});
