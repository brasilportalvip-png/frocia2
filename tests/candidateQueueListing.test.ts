import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ pages: [] as any[][], next: 0, startAfter: vi.fn() }));
vi.mock('../server/lib/firebaseAdmin.js', () => ({
  isFirebaseAdminConfigured: () => true,
  adminDb: { collection: () => ({ orderBy: () => ({ limit: () => {
    const query: any = {
      get: async () => {
        const items = fixture.pages[fixture.next++] || [];
        return { empty: items.length === 0, docs: items.map(data => ({ data: () => data })) };
      },
      startAfter: (cursor: any) => { fixture.startAfter(cursor); return query; },
    };
    return query;
  } }) }) },
}));
import { ImprovementPlannerService } from '../server/selfEvolution/improvementPlannerService';

describe('Fila depois de excluir tarefas', () => {
  beforeEach(() => { fixture.pages = []; fixture.next = 0; fixture.startAfter.mockClear(); });
  it('continua a paginação para que registros excluídos não escondam tarefas mais antigas', async () => {
    fixture.pages = [[{ id: 'removed', deletedAt: 'now', state: 'cancelled' }], [{ id: 'older-active', state: 'detected' }]];
    expect(await ImprovementPlannerService.getCandidates(1)).toEqual([{ id: 'older-active', state: 'detected' }]);
    expect(fixture.startAfter).toHaveBeenCalledTimes(1);
  });
  it('retorna fila vazia quando todos os registros foram excluídos', async () => {
    fixture.pages = [[{ id: 'removed', deletedAt: 'now', state: 'cancelled' }], []];
    expect(await ImprovementPlannerService.getCandidates(1)).toEqual([]);
  });
});
