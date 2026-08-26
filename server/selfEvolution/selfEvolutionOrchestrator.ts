import { ImprovementPlannerService } from './improvementPlannerService.js';
import { SelfEvolutionPolicyEngine } from './selfEvolutionPolicyEngine.js';
import { BudgetService } from './budgetService.js';
import { LockService } from './lockService.js';
import { AuditService } from './auditService.js';
import { CodeAgentService } from './codeAgentService.js';
import { GithubAutomationService } from './githubAutomationService.js';
import { CIGateService } from './ciGateService.js';
import { PreviewDeploymentService } from './previewDeploymentService.js';
import { ReleaseDecisionService } from './releaseDecisionService.js';
import { RollbackService } from './rollbackService.js';
import { CandidateState } from './selfEvolutionTypes.js';
import { CommitteeGateService } from './committeeGateService.js';

export class SelfEvolutionOrchestrator {
  static async processCandidateLifecycle(candidateId: string, actor: string = 'system'): Promise<{
    state: CandidateState;
    message: string;
  }> {
    const candidate = await ImprovementPlannerService.getCandidateById(candidateId);
    if (!candidate) {
      return { state: 'failed', message: 'Candidato não encontrado.' };
    }

        const selfEvolutionEnabled =
      await SelfEvolutionPolicyEngine
        .isSelfEvolutionEnabledPersisted();

    if (!selfEvolutionEnabled) {
      return {
        state: candidate.state,
        message:
          'Sistema de autoevolução está desativado por configuração ou parada emergencial persistente.'
      };
    }

    const lock = await LockService.acquireLock(candidateId, actor);
    if (!lock) {
      return { state: candidate.state, message: 'Operação em andamento em outro processo (Lock ativo).' };
    }

    try {
      // Stage 1: Triage & Approval Check
      if (candidate.state === 'detected') {
        await ImprovementPlannerService.updateCandidateState(candidateId, 'triaged');
        candidate.state = 'triaged';
        await AuditService.logEvent({
          actor,
          action: 'triage_candidate',
          resource: candidateId,
          riskLevel: candidate.riskLevel,
          result: 'success',
        });
      }

      if (candidate.requiresApproval && candidate.state === 'triaged') {
        await ImprovementPlannerService.updateCandidateState(candidateId, 'awaiting_work_approval');
        candidate.state = 'awaiting_work_approval';
        return {
          state: 'awaiting_work_approval',
          message: `Aprovação humana necessária para candidato de risco ${candidate.riskLevel}.`,
        };
      }

      // Stage 2: Budget Check & Code Generation
      if (candidate.state === 'approved_for_work' || candidate.state === 'triaged') {
        const canExecute = await BudgetService.canExecuteAgentRun(candidate.estimatedCostCredits);
        if (!canExecute) {
          return {
            state: candidate.state,
            message: 'Limite de orçamento diário ou mensal atingido.',
          };
        }

        await BudgetService.consumeBudget(candidate.estimatedCostCredits);
        await ImprovementPlannerService.updateCandidateState(candidateId, 'agent_running');

        const patch = await CodeAgentService.generatePatchAndTest(candidate);
        if (!patch.success) {
          await ImprovementPlannerService.updateCandidateState(candidateId, 'tests_failed');
          return {
            state: 'tests_failed',
            message: patch.errorMessage || 'Falha na geração de patch do agente (Worker não configurado ou erro).',
          };
        }

        await ImprovementPlannerService.updateCandidateState(candidateId, 'patch_created');

        // GitHub PR
        const pr =
          await GithubAutomationService
            .createBranchAndPR(
              candidate,
              patch
            );
        if (!pr.success) {
          return {
            state: candidate.state,
            message: pr.errorMessage || 'Falha ao criar branch e Pull Request no GitHub.',
          };
        }

        candidate.branchName = pr.branchName;
        candidate.headCommitSha = pr.commitSha;
        candidate.pullRequestUrl = pr.pullRequestUrl;
        await ImprovementPlannerService.updateCandidateMetadata(
          candidateId,
          {
            branchName: pr.branchName,
            headCommitSha: pr.commitSha,
            pullRequestUrl: pr.pullRequestUrl
          }
        );
        await ImprovementPlannerService.updateCandidateState(candidateId, 'pull_request_opened');

        // CI Check
        const ci = await CIGateService.runCIGate(candidate.branchName);
        if (ci.status === 'not_configured' || ci.status === 'pending') {
          return {
            state: candidate.state,
            message: `CI Gate em estado: ${ci.status}. ${ci.details}`,
          };
        }

        if (!ci.passed) {
          await ImprovementPlannerService.updateCandidateState(candidateId, 'ci_failed');
          return { state: 'ci_failed', message: `CI Gate reprovado: ${ci.details}` };
        }

        await ImprovementPlannerService.updateCandidateState(candidateId, 'ci_passed');

        // Preview Deployment
        const preview = await PreviewDeploymentService.createPreviewDeployment(candidateId, candidate.branchName);
        if (preview.status === 'not_configured' || preview.status === 'pending') {
          return {
            state: candidate.state,
            message: `Preview Deployment em estado: ${preview.status}. ${preview.errorMessage || ''}`,
          };
        }

        candidate.previewUrl = preview.previewUrl;
        await ImprovementPlannerService.updateCandidateMetadata(
          candidateId,
          {
            previewUrl: preview.previewUrl
          }
        );
        await ImprovementPlannerService.updateCandidateState(candidateId, 'preview_deployed');

        if (candidate.riskLevel === 'R2' || candidate.riskLevel === 'R3') {
          await ImprovementPlannerService.updateCandidateState(candidateId, 'awaiting_release_approval');
          return {
            state: 'awaiting_release_approval',
            message: 'Preview implantada. Aguardando aprovação humana final de release.',
          };
        }
      }

      return {
        state: candidate.state,
        message: `Estado atual do candidato: ${candidate.state}`,
      };
    } finally {
      await LockService.releaseLock(candidateId, actor);
    }
  }

  static async approveRelease(candidateId: string, adminUid: string): Promise<{ success: boolean; message: string }> {
    const candidate = await ImprovementPlannerService.getCandidateById(candidateId);
    if (!candidate) return { success: false, message: 'Candidato não encontrado.' };

    const committeeGate =
      await CommitteeGateService.evaluateCandidate(
        candidate,
        adminUid
      );

    const decision = ReleaseDecisionService.canReleaseToProduction(
      candidate,
      true,
      committeeGate
    );
    if (!decision.canRelease) {
      return { success: false, message: decision.reason };
    }

    await ImprovementPlannerService.updateCandidateState(candidateId, 'approved_for_release');
    await AuditService.logEvent({
      actor: adminUid,
      action: 'approve_release',
      resource: candidateId,
      riskLevel: candidate.riskLevel,
      result: 'success',
      prUrl: candidate.pullRequestUrl,
    });

    return { success: true, message: 'Release aprovada pelo administrador com sucesso.' };
  }

   static async executeEmergencyRollback(
    candidateId: string,
    adminUid: string,
    reason: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const candidate =
      await ImprovementPlannerService.getCandidateById(
        candidateId
      );

    if (!candidate) {
      return {
        success: false,
        message: 'Candidato não encontrado.'
      };
    }

    const pullRequestMatch =
      candidate.pullRequestUrl?.match(
        /\/pull\/(\d+)(?:\/|$)/
      );

    const pullRequestNumber = pullRequestMatch
      ? Number(pullRequestMatch[1])
      : undefined;

    const result =
      await RollbackService.executeRollback(
        candidateId,
        reason,
        pullRequestNumber
      );

    if (result.success) {
      await ImprovementPlannerService.updateCandidateState(
        candidateId,
        'rolled_back'
      );
    }

    await AuditService.logEvent({
      actor: adminUid,
      action: 'emergency_rollback',
      resource: candidateId,
      riskLevel: 'R3',
      result: result.success ? 'success' : 'failure',
      reason: result.success
        ? reason
        : `${reason} | Falha: ${result.message}`,
      prUrl: candidate.pullRequestUrl
    });

    return {
      success: result.success,
      message: result.message
    };
  }
}
