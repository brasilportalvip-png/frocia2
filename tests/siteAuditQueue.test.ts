import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ docs: new Map<string, any>(), create: vi.fn(), set: vi.fn() }));
vi.mock('../server/lib/firebaseAdmin.js', () => ({
  isFirebaseAdminConfigured: () => true, hasFullServiceAccountCredentials: () => false,
  adminDb: {
    collection: (name: string) => ({ doc: (id: string) => ({ path: name + '/' + id }) }),
    runTransaction: async (fn: any) => fn({
      get: async (ref: any) => ({ exists: fixture.docs.has(ref.path), data: () => fixture.docs.get(ref.path) }),
      create: (ref: any, data: any) => { fixture.create(ref.path, data); fixture.docs.set(ref.path, data); },
      set: (ref: any, data: any) => { fixture.set(ref.path, data); fixture.docs.set(ref.path, data); },
    }),
  },
}));
import { SiteAuditQueueService, planAuditQueue } from '../server/selfEvolution/siteAuditQueueService';
const sha = 'b'.repeat(40);
const context = { origin: 'https://frocia2.vercel.app', auditId: 'audit-test', generation: '12345678-aaaa-bbbb-cccc-123456789012',
  commitSha: sha, now: new Date('2026-10-25T18:50:00Z'), manual: true };
const finding = { code: 'BROWSER_console-errors', severity: 'high' as const, url: context.origin + '/',
  message: 'Falha de console.', evidence: 'TypeError observado ao abrir a conversa; trace abc.', probableFiles: ['src/App.tsx'] };
const signature = createHash('sha256').update(context.origin + '|BROWSER_console-errors|src/App.tsx').digest('hex');
function previous(state: string, extra = {}, version = sha) {
  const id = 'site-legacy-2026-10-25';
  fixture.docs.set('self_evolution_site_issue_signatures/' + signature, { candidateId: id, repositorySha: version });
  fixture.docs.set('self_evolution_candidates/' + id, { id, state, ...extra });
  return id;
}
beforeEach(() => { fixture.docs.clear(); fixture.create.mockClear(); fixture.set.mockClear(); });
describe('Regressão da rodada #66: falha observada sem tarefa retomável', () => {
  it.each(['failed', 'tests_failed', 'preview_failed', 'cancelled', 'no_change'])('um pedido manual cria investigação nova depois de %s, inclusive no mesmo dia e SHA', async state => {
    const id = previous(state);
    const queue = await SiteAuditQueueService.enqueue([finding], context);
    expect(queue.createdCount).toBe(1); expect(queue.blockedCandidates).toEqual([]);
    expect(queue.candidateIds[0]).not.toBe(id);
    const candidate = fixture.docs.get('self_evolution_candidates/' + queue.candidateIds[0]);
    expect(candidate.state).toBe('detected');
    expect(candidate.evidence.join('\n')).toContain('TypeError observado');
    expect(fixture.docs.get('self_evolution_candidates/' + id).state).toBe(state);
  });
  it('preserva uma tarefa excluída e cria outra investigação para o novo pedido manual', async () => {
    const id = previous('cancelled', { deletedAt: 'earlier', deletedBy: 'owner' });
    const queue = await SiteAuditQueueService.enqueue([finding], context);
    expect(queue.createdCount).toBe(1);
    expect(fixture.docs.get('self_evolution_candidates/' + id)).toMatchObject({ deletedAt: 'earlier', deletedBy: 'owner', state: 'cancelled' });
  });
  it('reutiliza trabalho ativo em vez de criar ou cobrar outra tarefa', async () => {
    const id = previous('ci_pending');
    const queue = await SiteAuditQueueService.enqueue([finding], context);
    expect(queue.candidateIds).toEqual([id]); expect(queue.createdCount).toBe(0); expect(fixture.create).not.toHaveBeenCalled();
  });
  it('é idempotente quando o mesmo achado reaparece na mesma geração', async () => {
    const one = await SiteAuditQueueService.enqueue([finding], context);
    const two = await SiteAuditQueueService.enqueue([finding], { ...context, generation: 'another-manual-generation' });
    expect(two.candidateIds).toEqual(one.candidateIds); expect(fixture.create).toHaveBeenCalledTimes(1);
  });
  it('uma nova versão permite investigação automática de um erro ainda presente', async () => {
    previous('failed', {}, 'a'.repeat(40));
    expect((await SiteAuditQueueService.enqueue([finding], { ...context, manual: false })).createdCount).toBe(1);
  });
  it('o agendamento não reativa uma exclusão explícita na mesma versão e informa o item exato', async () => {
    const id = previous('cancelled', { deletedAt: 'earlier' });
    const queue = await SiteAuditQueueService.enqueue([finding], { ...context, manual: false });
    expect(queue.createdCount).toBe(0);
    expect(queue.blockedCandidates).toEqual([expect.objectContaining({ candidateId: id, state: 'cancelled' })]);
    expect(fixture.create).not.toHaveBeenCalled();
  });
  it('não mascara tentativas encerradas da mesma versão como se não houvesse erro', () => {
    expect(planAuditQueue({ state: 'failed' }, sha, { commitSha: sha, manual: false })).toBe('wait');
    expect(planAuditQueue({ state: 'failed' }, sha, { commitSha: sha, manual: true })).toBe('create');
  });
});
