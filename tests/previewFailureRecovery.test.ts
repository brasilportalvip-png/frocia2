import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: null as any }));
vi.mock('../server/lib/firebaseAdmin.js', async () => {
  const { createMemoryFirestoreFixture } = await import('./helpers/memoryFirestoreFixture.js');
  state.store = createMemoryFirestoreFixture();
  return { adminDb: state.store.adminDb, isFirebaseAdminConfigured: () => true };
});
import { planPreviewRecovery, PreviewFailureRecoveryService } from '../server/selfEvolution/previewFailureRecoveryService.js';
import { runnerOutcomePolicy } from '../server/selfEvolution/runnerOutcomePolicy.js';
const sha = 'a'.repeat(40);
const context = { sourceSha: sha, runId: 'run-1', now: new Date('2026-10-24T13:00:00Z') };
const candidate = { state: 'preview_failed', pullRequestUrl: 'https://github.com/brasilportalvip-png/frocia2/pull/90',
  branchName: 'froc-evolution/r1/test', headCommitSha: 'b'.repeat(40), updatedAt: '2026-10-24T12:00:00Z' };
beforeEach(() => state.store.reset());
describe('retomada limitada da validação do preview', () => {
  it('retoma o mesmo patch a partir do CI; não gera ou aprova código', async () => {
    state.store.documents.set('self_evolution_candidates/id', { ...candidate, evidence: ['unchanged'] });
    state.store.documents.set('self_evolution_patch_checkpoints/id', { baseSha: sha });
    expect(await PreviewFailureRecoveryService.recoverNext(context)).toMatchObject({ candidateId: 'id' });
    expect(state.store.documents.get('self_evolution_candidates/id')).toMatchObject({
      state: 'ci_pending', evidence: ['unchanged'], headCommitSha: candidate.headCommitSha, previewRecovery: { count: 1 },
    });
    expect(await PreviewFailureRecoveryService.recoverNext(context)).toMatchObject({ candidateId: undefined, unresolved: false });
  });
  it('bloqueia o PR antigo quando a base mudou ou não existe comprovação da base', () => {
    for (const base of [undefined, 'c'.repeat(40)]) expect(planPreviewRecovery(candidate, base, context)).toMatchObject({ allowed: false, reason: 'stale_or_unverified_base' });
  });
  it('aguarda 15 minutos e limita a duas retomadas no dia de Brasília', () => {
    const one = planPreviewRecovery(candidate, sha, context);
    if (!one.allowed) throw new Error('expected first retry');
    const second = { ...candidate, ...one.update, state: 'preview_failed' };
    expect(planPreviewRecovery(second, sha, { ...context, runId: 'run-2' })).toMatchObject({ allowed: false });
    const later = { ...context, runId: 'run-2', now: new Date('2026-10-24T13:16:00Z') };
    const two = planPreviewRecovery(second, sha, later);
    expect(two).toMatchObject({ allowed: true, update: { previewRecovery: { count: 2 } } });
    if (!two.allowed) throw new Error('expected second retry');
    expect(planPreviewRecovery({ ...second, ...two.update, state: 'preview_failed' }, sha,
      { ...later, runId: 'run-3', now: new Date('2026-10-24T14:00:00Z') })).toMatchObject({ allowed: false, reason: 'retry_limit' });
  });
  it('não retoma produção publicada nem candidato sem SHA', () => {
    expect(planPreviewRecovery({ ...candidate, productionMergeSha: sha }, sha, context).allowed).toBe(false);
    expect(planPreviewRecovery({ ...candidate, headCommitSha: '' }, sha, context).allowed).toBe(false);
  });
  it('conserva pendência diagnosticada quando nenhuma retomada é elegível', async () => {
    state.store.documents.set('self_evolution_candidates/old', candidate);
    const result = await PreviewFailureRecoveryService.recoverNext(context);
    expect(result).toMatchObject({ unresolved: true, blocked: [{ candidateId: 'old', reason: 'stale_or_unverified_base' }] });
    expect(state.store.documents.get('self_evolution_candidates/old').state).toBe('preview_failed');
  });
});
describe('resultado diário não confunde falha ou espera com publicação', () => {
  it.each(['preview_failed', 'ci_failed', 'tests_failed', 'preview_requires_attention', 'audit_requires_attention'])('não encerra o dia como sucesso em %s', state => {
    expect(runnerOutcomePolicy({ state }, false)).toMatchObject({ failed: true, dailyComplete: false });
  });
  it('CI pendente conserva a retomada e não encerra o dia', () => {
    expect(runnerOutcomePolicy({ state: 'ci_pending' }, true)).toMatchObject({ failed: false, dailyComplete: false, requiresResume: true });
  });
  it('aceita conclusão comprovada e não ignora auditoria parcial ou falhas abertas', () => {
    expect(runnerOutcomePolicy({ state: 'accepted' }, false).dailyComplete).toBe(true);
    expect(runnerOutcomePolicy({ status: 'idle', siteAudit: { findings: 0, coverageComplete: true } }, false).dailyComplete).toBe(true);
    expect(runnerOutcomePolicy({ status: 'idle', siteAudit: { findings: 1 } }, false).dailyComplete).toBe(false);
    expect(runnerOutcomePolicy({ status: 'idle', siteAudit: { findings: 0, coverageComplete: false } }, false).dailyComplete).toBe(false);
  });
});
