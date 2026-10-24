import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelfEvolutionOrchestrator } from '../server/selfEvolution/selfEvolutionOrchestrator.js';
import { ImprovementPlannerService } from '../server/selfEvolution/improvementPlannerService.js';
import { ProductionReleaseVerificationService } from '../server/selfEvolution/productionReleaseVerificationService.js';
import { SelfEvolutionPolicyEngine } from '../server/selfEvolution/selfEvolutionPolicyEngine.js';
import { LockService } from '../server/selfEvolution/lockService.js';
import { AuditService } from '../server/selfEvolution/auditService.js';
import { CodeAgentService } from '../server/selfEvolution/codeAgentService.js';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService.js';
import { CIGateService } from '../server/selfEvolution/ciGateService.js';
import { BudgetService } from '../server/selfEvolution/budgetService.js';
import type { ImprovementCandidate } from '../server/selfEvolution/selfEvolutionTypes.js';
import { CertifiedPatchCheckpointService } from '../server/selfEvolution/certifiedPatchCheckpointService.js';

describe('Retomada do ciclo depois do merge', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  function setup() {
    const candidate = { id: 'publication-test', state: 'approved_for_release', riskLevel: 'R1', productionMergeSha: 'a'.repeat(40) } as ImprovementCandidate;
    vi.spyOn(ImprovementPlannerService, 'getCandidateById').mockResolvedValue(candidate);
    vi.spyOn(ImprovementPlannerService, 'updateCandidateState').mockImplementation(async (_id, state) => { candidate.state = state; return true; });
    vi.spyOn(ImprovementPlannerService, 'updateCandidateMetadata').mockResolvedValue(true);
    vi.spyOn(SelfEvolutionPolicyEngine, 'isSelfEvolutionEnabledPersisted').mockResolvedValue(true);
    vi.spyOn(LockService, 'acquireLock').mockResolvedValue({} as any);
    vi.spyOn(LockService, 'releaseLock').mockResolvedValue(true);
    vi.spyOn(AuditService, 'logEvent').mockResolvedValue({} as any);
    const patch = vi.spyOn(CodeAgentService, 'generatePatchAndTest');
    return { candidate, patch };
  }
  it('mantem o candidato em acompanhamento enquanto a publicacao nao foi comprovada', async () => {
    const { patch } = setup();
    vi.spyOn(ProductionReleaseVerificationService, 'verify').mockResolvedValue({ status: 'pending', message: 'Aguardando a Vercel.' });
    expect((await SelfEvolutionOrchestrator.processCandidateLifecycle('publication-test')).state).toBe('monitoring');
    expect(patch).not.toHaveBeenCalled();
    expect(LockService.releaseLock).toHaveBeenCalled();
  });
  it('aceita a correcao depois da prova de producao sem gerar nem cobrar outro patch', async () => {
    const { patch } = setup();
    vi.spyOn(ProductionReleaseVerificationService, 'verify').mockResolvedValue({ status: 'accepted', deploymentId: 'dpl_test', message: 'Publicado e validado.' });
    expect((await SelfEvolutionOrchestrator.processCandidateLifecycle('publication-test')).state).toBe('accepted');
    expect(ImprovementPlannerService.updateCandidateMetadata).toHaveBeenCalledWith('publication-test', { productionDeploymentId: 'dpl_test' });
    expect(patch).not.toHaveBeenCalled();
  });
  it('solicita CI explicitamente uma unica vez e retoma sem regenerar o patch', async () => {
    const { candidate, patch } = setup();
    candidate.state = 'pull_request_opened'; candidate.branchName = 'froc-evolution/r1/test'; candidate.headCommitSha = 'b'.repeat(40);
    vi.stubEnv('SELF_EVOLUTION_CI_DISPATCH_REQUIRED', 'true');
    const dispatch = vi.spyOn(GithubAutomationService, 'dispatchOfficialCI').mockResolvedValue({ success: true, message: 'CI solicitado.' });
    vi.spyOn(CIGateService, 'runCIGate').mockResolvedValue({ status: 'pending', details: 'CI em execucao.' } as any);
    expect((await SelfEvolutionOrchestrator.processCandidateLifecycle('publication-test')).state).toBe('ci_pending');
    expect((await SelfEvolutionOrchestrator.processCandidateLifecycle('publication-test')).state).toBe('ci_pending');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
  });
  it('nao gera codigo se a reserva atomica de orcamento for recusada', async () => {
    const { candidate, patch } = setup(); candidate.state = 'approved_for_work';
    vi.spyOn(BudgetService, 'canExecuteAgentRun').mockResolvedValue(true);
    vi.spyOn(BudgetService, 'consumeBudget').mockResolvedValue(false);
    expect((await SelfEvolutionOrchestrator.processCandidateLifecycle('publication-test')).state).toBe('approved_for_work');
    expect(patch).not.toHaveBeenCalled();
  });

  function staleSetup() {
    const prepared = setup(); prepared.candidate.state = 'patch_created';
    const oldPatch = { status: 'success', success: true, baseSha: 'a'.repeat(40), files: [{ path: 'src/fix.ts', content: 'old' }] } as any;
    const newPatch = { ...oldPatch, baseSha: 'b'.repeat(40), files: [{ path: 'src/fix.ts', content: 'new' }] };
    vi.spyOn(CertifiedPatchCheckpointService, 'load').mockResolvedValue(oldPatch);
    const save = vi.spyOn(CertifiedPatchCheckpointService, 'save').mockResolvedValue(undefined);
    vi.spyOn(BudgetService, 'canExecuteAgentRun').mockResolvedValue(true);
    vi.spyOn(BudgetService, 'consumeBudget').mockResolvedValue(true);
    prepared.patch.mockResolvedValue(newPatch);
    const pr = vi.spyOn(GithubAutomationService, 'createBranchAndPR')
      .mockResolvedValueOnce({ status: 'failed', success: false, requiresRegeneration: true, errorMessage: 'A main mudou.' })
      .mockResolvedValue({ status: 'success', success: true, commitSha: 'c'.repeat(40), branchName: 'froc-evolution/r1/new-base', pullRequestUrl: 'https://github.com/owner/site/pull/99' });
    vi.spyOn(CIGateService, 'runCIGate').mockResolvedValue({ status: 'pending', details: 'CI real aguardando.' } as any);
    return { ...prepared, oldPatch, newPatch, pr, save };
  }

  it('regenera o checkpoint antigo na mesma execucao, com orcamento e nova certificacao antes do PR', async () => {
    const { patch, newPatch, pr, save } = staleSetup();
    expect((await SelfEvolutionOrchestrator.processCandidateLifecycle('publication-test')).state).toBe('ci_pending');
    expect(patch).toHaveBeenCalledTimes(1);
    expect(BudgetService.consumeBudget).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('publication-test', newPatch);
    expect(pr).toHaveBeenNthCalledWith(2, expect.anything(), newPatch);
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(pr.mock.invocationCallOrder[1]);
  });
  it('conserva a retomada sem gerar codigo quando falta orcamento para atualizar a base', async () => {
    const { patch, pr, save } = staleSetup();
    vi.mocked(BudgetService.canExecuteAgentRun).mockResolvedValue(false);
    const result = await SelfEvolutionOrchestrator.processCandidateLifecycle('publication-test');
    expect(result.state).toBe('approved_for_work');
    expect(patch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(pr).toHaveBeenCalledTimes(1);
  });
  it('nao publica o checkpoint antigo se a geracao nova falha', async () => {
    const { patch, pr, save } = staleSetup();
    patch.mockResolvedValue({ status: 'failed', success: false, errorMessage: 'Novo teste falhou.' } as any);
    expect(await SelfEvolutionOrchestrator.processCandidateLifecycle('publication-test')).toMatchObject({ state: 'tests_failed', message: 'Novo teste falhou.' });
    expect(save).not.toHaveBeenCalled(); expect(pr).toHaveBeenCalledTimes(1);
  });
  it('limita a uma nova geracao quando a main muda repetidamente', async () => {
    const { patch, pr } = staleSetup();
    pr.mockResolvedValue({ status: 'failed', success: false, requiresRegeneration: true });
    expect((await SelfEvolutionOrchestrator.processCandidateLifecycle('publication-test')).state).toBe('approved_for_work');
    expect(patch).toHaveBeenCalledTimes(1); expect(pr).toHaveBeenCalledTimes(2);
  });
});
