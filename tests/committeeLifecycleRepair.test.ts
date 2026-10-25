import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelfEvolutionOrchestrator } from '../server/selfEvolution/selfEvolutionOrchestrator';
import { ImprovementPlannerService } from '../server/selfEvolution/improvementPlannerService';
import { SelfEvolutionPolicyEngine } from '../server/selfEvolution/selfEvolutionPolicyEngine';
import { LockService } from '../server/selfEvolution/lockService';
import { AuditService } from '../server/selfEvolution/auditService';
import { CIGateService } from '../server/selfEvolution/ciGateService';
import { AutonomousBrowserValidationService, REQUIRED_BROWSER_SCENARIOS } from '../server/selfEvolution/autonomousBrowserValidationService';
import { ContinuousCapabilityEvaluationService } from '../server/ai/continuousCapabilityEvaluationService';
import { SpecialistCommitteeExecutionService } from '../server/selfEvolution/specialistCommitteeExecutionService';
import { CommitteeRepairService } from '../server/selfEvolution/committeeRepairService';
import { CodeAgentService } from '../server/selfEvolution/codeAgentService';
import { BudgetService } from '../server/selfEvolution/budgetService';
import { CertifiedPatchCheckpointService } from '../server/selfEvolution/certifiedPatchCheckpointService';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService';
import { COMMITTEE_ROLES, type ImprovementCandidate } from '../server/selfEvolution/selfEvolutionTypes';

describe('Ciclo de revisão, correção, certificação e CI novo', () => {
  let candidate: ImprovementCandidate;
  beforeEach(() => {
    candidate = { id: 'owner-cycle', state: 'preview_deployed', headCommitSha: 'a'.repeat(40),
      branchName: 'froc-evolution/r1/old', pullRequestUrl: 'https://github.com/brasilportalvip-png/frocia2/pull/1',
      previewUrl: 'https://preview.example.com/', riskLevel: 'R1', probableFiles: ['src/fix.ts'], evidence: ['trace:original'],
      estimatedCostCredits: 10 } as ImprovementCandidate;
    vi.spyOn(ImprovementPlannerService, 'getCandidateById').mockImplementation(async () => candidate);
    vi.spyOn(ImprovementPlannerService, 'updateCandidateState').mockImplementation(async (_id, state) => { candidate.state = state; return true; });
    vi.spyOn(ImprovementPlannerService, 'updateCandidateMetadata').mockImplementation(async (_id, metadata) => { Object.assign(candidate, metadata); return true; });
    vi.spyOn(SelfEvolutionPolicyEngine, 'isSelfEvolutionEnabledPersisted').mockResolvedValue(true);
    vi.spyOn(LockService, 'acquireLock').mockResolvedValue({} as any);
    vi.spyOn(LockService, 'releaseLock').mockResolvedValue(true);
    vi.spyOn(AuditService, 'logEvent').mockResolvedValue({} as any);
    vi.spyOn(CIGateService, 'runCIGate').mockResolvedValue({ status: 'success', passed: true, details: 'CI oficial aprovado.' } as any);
    vi.spyOn(ContinuousCapabilityEvaluationService, 'hasPassingComparison').mockResolvedValue(true);
    vi.spyOn(AutonomousBrowserValidationService, 'validate').mockResolvedValue({
      passed: true, commitSha: candidate.headCommitSha!, previewUrl: candidate.previewUrl!, completedAt: '2026-10-25T19:00:00Z',
      scenarios: REQUIRED_BROWSER_SCENARIOS.map(id => ({ id, status: 'passed', details: 'ok', durationMs: 1, traceSha256: 'b'.repeat(64) })),
    } as any);
    vi.spyOn(SpecialistCommitteeExecutionService, 'execute').mockImplementation(async current =>
      COMMITTEE_ROLES.map(role => ({ id: 'review-' + role, role, candidateId: current.id, actorUid: 'actor-' + role,
        commitSha: current.headCommitSha!, verdict: role === 'qa' ? 'changes_required' : 'approved',
        summary: 'Criar teste de regressão específico.', evidenceRefs: ['ci:passed'], fileRefs: ['src/fix.ts'],
        testRefs: [], risks: [], createdAt: '', updatedAt: '' })));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it('entrega as verificações reais ao revisor e a solicitação de mudança ao gerador seguinte', async () => {
    const prepare = vi.spyOn(CommitteeRepairService, 'prepare').mockImplementation(async () => {
      candidate.state = 'approved_for_work';
      candidate.evidence.push('CORREÇÃO SOLICITADA PELO COMITÊ: criar teste de regressão específico.');
      delete candidate.headCommitSha; delete candidate.branchName; delete candidate.pullRequestUrl; delete candidate.previewUrl;
      return true;
    });
    const generated = vi.spyOn(CodeAgentService, 'generatePatchAndTest').mockResolvedValue({
      status: 'success', success: true, baseSha: 'b'.repeat(40), files: [{ path: 'src/fix.ts', content: 'export const corrected = true;' }],
    } as any);
    expect(await SelfEvolutionOrchestrator.processCandidateLifecycle(candidate.id)).toMatchObject({ state: 'approved_for_work', retryAfterReview: true });
    expect(prepare).toHaveBeenCalledOnce();
    expect(SpecialistCommitteeExecutionService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      commitSha: 'a'.repeat(40), ci: expect.objectContaining({ passed: true }),
      browser: expect.objectContaining({ passed: true, commitSha: 'a'.repeat(40) }), capabilityComparisonPassed: true,
    }));
    expect(generated).not.toHaveBeenCalled();
    vi.spyOn(BudgetService, 'canExecuteAgentRun').mockResolvedValue(true);
    vi.spyOn(BudgetService, 'consumeBudget').mockResolvedValue(true);
    vi.spyOn(CertifiedPatchCheckpointService, 'save').mockResolvedValue(undefined);
    vi.spyOn(GithubAutomationService, 'createBranchAndPR').mockResolvedValue({ success: true, status: 'success',
      branchName: 'froc-evolution/r1/new', commitSha: 'c'.repeat(40), pullRequestUrl: 'https://github.com/brasilportalvip-png/frocia2/pull/2' });
    vi.spyOn(GithubAutomationService, 'inspectEffectivePullRequest').mockResolvedValue({ status: 'changed', message: 'Patch efetivo.' });
    vi.mocked(CIGateService.runCIGate).mockResolvedValue({ status: 'pending', passed: false, details: 'Novo CI aguardando.' } as any);
    vi.stubEnv('SELF_EVOLUTION_CI_DISPATCH_REQUIRED', 'false');
    expect(await SelfEvolutionOrchestrator.processCandidateLifecycle(candidate.id)).toMatchObject({ state: 'ci_pending' });
    expect(generated).toHaveBeenCalledWith(expect.objectContaining({ evidence: expect.arrayContaining([expect.stringContaining('CORREÇÃO SOLICITADA')]) }));
    expect(BudgetService.consumeBudget).toHaveBeenCalledTimes(1);
    expect(candidate.headCommitSha).toBe('c'.repeat(40));
  });
  it('não aprova nem regenera automaticamente um veto explícito', async () => {
    vi.mocked(SpecialistCommitteeExecutionService.execute).mockImplementation(async current =>
      COMMITTEE_ROLES.map(role => ({ id: role, role, candidateId: current.id, actorUid: role, commitSha: current.headCommitSha!,
        verdict: role === 'security' ? 'blocked' : 'approved', summary: 'Falha concreta exige intervenção.',
        fileRefs: ['src/fix.ts'], evidenceRefs: ['trace:failed'], testRefs: [], risks: [], createdAt: '', updatedAt: '' })));
    vi.spyOn(CommitteeRepairService, 'prepare').mockResolvedValue(false);
    const generated = vi.spyOn(CodeAgentService, 'generatePatchAndTest');
    expect(await SelfEvolutionOrchestrator.processCandidateLifecycle(candidate.id)).toMatchObject({ state: 'failed' });
    expect(generated).not.toHaveBeenCalled();
  });
});
