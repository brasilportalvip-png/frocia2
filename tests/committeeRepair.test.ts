import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ current: undefined as any, update: vi.fn(), create: vi.fn() }));
vi.mock('../server/lib/firebaseAdmin.js', () => ({
  isFirebaseAdminConfigured: () => true, hasFullServiceAccountCredentials: () => false,
  adminDb: {
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
    runTransaction: async (fn: any) => fn({
      get: async () => ({ exists: Boolean(fixture.current), data: () => fixture.current }),
      update: fixture.update, create: fixture.create,
    }),
  },
}));
import { CommitteeRepairService, planCommitteeRepair } from '../server/selfEvolution/committeeRepairService';
import { CommitteeGateService } from '../server/selfEvolution/committeeGateService';
import { COMMITTEE_ROLES, type CommitteeReview, type ImprovementCandidate } from '../server/selfEvolution/selfEvolutionTypes';
const sha = 'a'.repeat(40);
const now = new Date('2026-10-25T19:00:00Z');
const candidate = { id: 'owner-review-test', state: 'failed', headCommitSha: sha, pullRequestUrl: 'https://github.com/owner/repo/pull/1',
  branchName: 'froc-evolution/r1/test', previewUrl: 'https://preview.example.com/', riskLevel: 'R1', evidence: ['trace:original'],
  estimatedCostCredits: 10 } as ImprovementCandidate;
function reviews(): CommitteeReview[] {
  return COMMITTEE_ROLES.map(role => ({ id: 'review-' + role, candidateId: candidate.id, role, actorUid: 'actor-' + role,
    commitSha: sha, verdict: role === 'qa' ? 'changes_required' : 'approved', summary: 'Reproduzir erro e adicionar teste de regressão.',
    fileRefs: ['src/fix.ts'], testRefs: [], evidenceRefs: ['trace:original'], risks: [], createdAt: '', updatedAt: '' }));
}
function gate(rows = reviews()) {
  return CommitteeGateService.evaluateReviews({ candidateId: candidate.id, commitSha: sha, riskLevel: 'R1', reviews: rows });
}
beforeEach(() => { fixture.current = { ...candidate }; fixture.update.mockClear(); fixture.create.mockClear(); });
afterEach(() => vi.restoreAllMocks());
describe('Pareceres viram correção de código em vez de encerrar a manutenção', () => {
  it('prepara tentativa certificada nova e preserva o PR reprovado no histórico', async () => {
    expect(await CommitteeRepairService.prepare(candidate, reviews(), gate(), now)).toBe(true);
    expect(fixture.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ previousCommitSha: sha,
      previousPullRequestUrl: candidate.pullRequestUrl, attempt: 1 }));
    const update = fixture.update.mock.calls[0][1];
    expect(update.state).toBe('approved_for_work');
    expect(update.evidence.join(' ')).toContain('review-qa');
    expect(update.evidence.join(' ')).toContain('adicionar teste de regressão');
    expect(update.headCommitSha).not.toBe(sha);
    expect(update.pullRequestUrl).not.toBe(candidate.pullRequestUrl);
  });
  it('não aprova nem tenta publicar um veto explícito', () => {
    const rows = reviews(); rows.find(r => r.role === 'security')!.verdict = 'blocked';
    expect(planCommitteeRepair(candidate, rows, gate(rows), now)).toBeNull();
  });
  it('limita correções a duas tentativas por tarefa/dia', () => {
    expect(planCommitteeRepair({ ...candidate, committeeRepair: { dateKey: '2026-10-25', attempt: 1, previousCommitSha: sha } }, reviews(), gate(), now)?.attempt).toBe(2);
    expect(planCommitteeRepair({ ...candidate, committeeRepair: { dateKey: '2026-10-25', attempt: 2, previousCommitSha: sha } }, reviews(), gate(), now)).toBeNull();
  });
  it('rejeita parecer de outro SHA ou candidato', () => {
    const rows = reviews(); rows.find(r => r.role === 'qa')!.commitSha = 'b'.repeat(40);
    expect(planCommitteeRepair(candidate, rows, gate(rows), now)).toBeNull();
    const wrong = reviews(); wrong.find(r => r.role === 'qa')!.candidateId = 'other';
    expect(planCommitteeRepair(candidate, wrong, gate(wrong), now)).toBeNull();
  });
  it('não transforma falta de evidência em nova geração nem em aprovação', () => {
    const rows = reviews(); rows.find(r => r.role === 'security')!.evidenceRefs = [];
    expect(planCommitteeRepair(candidate, rows, gate(rows), now)).toBeNull();
  });
  it('recusa uma tarefa excluída ou já publicada', async () => {
    fixture.current = { ...candidate, deletedAt: 'now' };
    expect(await CommitteeRepairService.prepare(candidate, reviews(), gate(), now)).toBe(false);
    expect(planCommitteeRepair({ ...candidate, productionMergeSha: 'b'.repeat(40) }, reviews(), gate(), now)).toBeNull();
    expect(fixture.update).not.toHaveBeenCalled();
  });
  it('uma mudança de estado concorrente não reabre a tarefa', async () => {
    fixture.current = { ...candidate, state: 'cancelled' };
    expect(await CommitteeRepairService.prepare(candidate, reviews(), gate(), now)).toBe(false);
  });
  it('mascara segredos nos motivos enviados ao gerador', () => {
    const rows = reviews(); rows.find(r => r.role === 'qa')!.summary = 'Erro com Authorization: Bearer abcdefghijklmnopqrstuvwxyz';
    const plan = planCommitteeRepair(candidate, rows, gate(rows), now);
    expect(JSON.stringify(plan?.feedback)).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});
