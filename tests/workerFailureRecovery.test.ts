import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const records = new Map<string, any>();
  let beforeRead: (() => void) | undefined;
  const ref = (id: string) => ({ id });
  const snapshot = (id: string) => ({ id, ref: ref(id), exists: records.has(id), data: () => records.get(id) });
  const db = {
    collection: () => ({ where: () => ({ get: async () => ({ docs: [...records.keys()].filter(id => records.get(id).state === 'tests_failed').map(snapshot) }) }) }),
    runTransaction: async (fn: any) => fn({
      get: async ({ id }: any) => { beforeRead?.(); beforeRead = undefined; return snapshot(id); },
      update: ({ id }: any, value: any) => records.set(id, { ...records.get(id), ...value }),
    }),
  };
  return { records, db, changeBeforeRead: (fn: () => void) => { beforeRead = fn; } };
});
vi.mock('../server/lib/firebaseAdmin.js', () => ({ adminDb: fixture.db, isFirebaseAdminConfigured: () => true }));
import { planWorkerFailureRecovery, WorkerFailureRecoveryService } from '../server/selfEvolution/workerFailureRecoveryService.js';

const context = { sourceSha: 'a'.repeat(40), runId: 'run-26:1', manual: false, now: new Date('2026-10-23T13:00:00Z') };
const failed = () => ({ state: 'tests_failed', title: 'Defeito real', evidence: ['auditoria'], updatedAt: '2026-10-23T12:00:00Z' });

describe('Retomada limitada das tarefas que falharam no worker', () => {
  beforeEach(() => fixture.records.clear());
  afterEach(() => vi.restoreAllMocks());

  it('retoma a tarefa existente sem apagar evidencia ou aprovar sua publicacao', async () => {
    fixture.records.set('site-failed', failed());
    expect(await WorkerFailureRecoveryService.recoverNext(context)).toBe('site-failed');
    expect(fixture.records.size).toBe(1);
    expect(fixture.records.get('site-failed')).toMatchObject({ state: 'detected', evidence: ['auditoria'],
      workerRecovery: { count: 1, dateKey: '2026-10-23', sourceShas: [context.sourceSha] } });
  });

  it('nao cobra novamente a mesma tarefa a cada agendamento com o mesmo codigo', async () => {
    const update = planWorkerFailureRecovery(failed(), context)!;
    const failedAgain = { ...failed(), ...update, state: 'tests_failed' };
    expect(planWorkerFailureRecovery(failedAgain, { ...context, runId: 'run-27:1' })).toBeNull();
    expect(planWorkerFailureRecovery(failedAgain, { ...context, runId: 'run-27:1', sourceSha: 'b'.repeat(40) })).toMatchObject({ state: 'detected' });
  });

  it('permite tentativa manual e respeita o teto de tres retomadas por versao no dia', () => {
    let candidate: Record<string, unknown> = failed();
    for (let i = 1; i <= 3; i++) {
      const update = planWorkerFailureRecovery(candidate, { ...context, manual: true, runId: `manual-${i}` });
      expect(update).toMatchObject({ workerRecovery: { count: i } });
      candidate = { ...candidate, ...update, state: 'tests_failed' };
    }
    expect(planWorkerFailureRecovery(candidate, { ...context, manual: true, runId: 'manual-4' })).toBeNull();
  });

  it('permite testar codigo corrigido depois de esgotar as tentativas da versao antiga', () => {
    const candidate = { ...failed(), workerRecovery: { dateKey: '2026-10-23', count: 3, runId: 'old', sourceShas: [context.sourceSha] } };
    expect(planWorkerFailureRecovery(candidate, context)).toBeNull();
    expect(planWorkerFailureRecovery(candidate, { ...context, sourceSha: 'c'.repeat(40) })).toMatchObject({
      state: 'detected', workerRecovery: { count: 4, sourceCounts: { ['c'.repeat(40)]: 1 } },
    });
  });

  it('usa o dia de Brasilia para liberar uma nova retomada diaria', () => {
    const candidate = { ...failed(), workerRecovery: { dateKey: '2026-10-23', count: 3, sourceShas: [context.sourceSha], runId: 'old' } };
    expect(planWorkerFailureRecovery(candidate, { ...context, now: new Date('2026-10-24T02:00:00Z') })).toBeNull();
    expect(planWorkerFailureRecovery(candidate, { ...context, now: new Date('2026-10-24T03:00:00Z') })).toMatchObject({ workerRecovery: { count: 1, dateKey: '2026-10-24' } });
  });

  it('nao retoma duas vezes a mesma execucao nem estados posteriores ao patch', () => {
    const update = planWorkerFailureRecovery(failed(), context)!;
    expect(planWorkerFailureRecovery({ ...failed(), ...update, state: 'tests_failed' }, { ...context, manual: true })).toBeNull();
    for (const state of ['accepted', 'rejected', 'ci_failed', 'cancelled', 'agent_running'])
      expect(planWorkerFailureRecovery({ ...failed(), state }, context)).toBeNull();
    expect(planWorkerFailureRecovery({ ...failed(), pullRequestUrl: 'https://github.com/owner/repo/pull/1' }, context)).toBeNull();
    expect(planWorkerFailureRecovery({ ...failed(), productionMergeSha: 'b'.repeat(40) }, context)).toBeNull();
    expect(planWorkerFailureRecovery(failed(), { ...context, sourceSha: 'invalid' })).toBeNull();
  });

  it('confere o estado dentro da transacao antes de alterar um candidato', async () => {
    fixture.records.set('site-failed', failed());
    fixture.changeBeforeRead(() => fixture.records.set('site-failed', { ...failed(), state: 'accepted' }));
    expect(await WorkerFailureRecoveryService.recoverNext(context)).toBeUndefined();
    expect(fixture.records.get('site-failed').state).toBe('accepted');
  });
});
