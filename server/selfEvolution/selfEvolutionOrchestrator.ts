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
import { ContinuousCapabilityEvaluationService } from '../ai/continuousCapabilityEvaluationService.js';
import { GithubCapabilityEvaluationService } from '../ai/githubCapabilityEvaluationService.js';
import { RollbackService } from './rollbackService.js';
import { CandidateState } from './selfEvolutionTypes.js';
import { CommitteeGateService } from './committeeGateService.js';
import { AutonomousBrowserValidationService } from './autonomousBrowserValidationService.js';
import { SpecialistCommitteeExecutionService } from './specialistCommitteeExecutionService.js';
export class SelfEvolutionOrchestrator {
  /**
   * Executa ou retoma cada etapa persistida, sem recriar um patch ja publicado.
   * Um gatilho externo (worker/cron) ainda e necessario para retomar estados pendentes.
   */
  static async processCandidateLifecycle(
    candidateId: string,
    actor: string = 'system'
  ): Promise<{ state: CandidateState; message: string }> {
    const candidate = await ImprovementPlannerService.getCandidateById(candidateId);
    if (!candidate) {
      return { state: 'failed', message: 'Candidato não encontrado.' };
    }

    if (!(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted())) {
      return {
        state: candidate.state,
        message: 'Sistema de autoevolução desativado ou em parada emergencial.',
      };
    }

    const lock = await LockService.acquireLock(candidateId, actor);
    if (!lock) {
      return {
        state: candidate.state,
        message: 'Operação em andamento em outro processo (lock ativo).',
      };
    }

    const transition = async (state: CandidateState): Promise<void> => {
      if (!(await ImprovementPlannerService.updateCandidateState(candidateId, state))) {
        throw new Error(`Não foi possível persistir o estado ${state}.`);
      }
      candidate.state = state;
    };

    try {
      if (candidate.state === 'detected') {
        await transition('triaged');
        await AuditService.logEvent({
          actor,
          action: 'triage_candidate',
          resource: candidateId,
          riskLevel: candidate.riskLevel,
          result: 'success',
        });
      }

      // O trabalho e iniciado automaticamente. Protecoes de branch, CI e
      // revisao continuam obrigatorias antes de qualquer publicacao.
      if (
        candidate.state === 'triaged' ||
        candidate.state === 'awaiting_work_approval'
      ) {
        await transition('approved_for_work');
        await AuditService.logEvent({
          actor: 'self-evolution',
          action: 'auto_approve_work',
          resource: candidateId,
          riskLevel: candidate.riskLevel,
          result: 'success',
          reason: 'Trabalho autorizado por politica automatica; release ainda depende dos gates.',
        });
      }

      if (candidate.state === 'approved_for_work') {
        if (!(await BudgetService.canExecuteAgentRun(candidate.estimatedCostCredits))) {
          return {
            state: candidate.state,
            message: 'Orçamento de execução insuficiente. Nenhum código foi gerado.',
          };
        }

        await BudgetService.consumeBudget(candidate.estimatedCostCredits);
        await transition('agent_running');

        const patch = await CodeAgentService.generatePatchAndTest(candidate);
        if (!patch.success) {
          await transition('tests_failed');
          return {
            state: 'tests_failed',
            message: patch.errorMessage || 'O worker não conseguiu gerar e testar o patch.',
          };
        }

        await transition('tests_passed');
        await AuditService.logEvent({
          actor: 'engineering-sandbox',
          action: 'verify_isolated_patch_execution',
          resource: candidateId,
          riskLevel: candidate.riskLevel,
          result: 'success',
          commitHash: patch.baseSha,
          reason:
            `Sandbox ${patch.executionEvidence?.sandboxId || '(desconhecida)'} ` +
            `executou ${patch.executionEvidence?.commands.length || 0} comandos obrigatórios; ` +
            `diff ${patch.executionEvidence?.diffSha256 || '(sem hash)'}.`,
        });

        await transition('patch_created');
        const pr = await GithubAutomationService.createBranchAndPR(candidate, patch);
        if (!pr.success || !pr.commitSha || !pr.branchName || !pr.pullRequestUrl) {
          return {
            state: 'patch_created',
            message: pr.errorMessage || 'Não foi possível comprovar a criação do Pull Request.',
          };
        }

        candidate.branchName = pr.branchName;
        candidate.headCommitSha = pr.commitSha;
        candidate.pullRequestUrl = pr.pullRequestUrl;
        if (!(await ImprovementPlannerService.updateCandidateMetadata(candidateId, {
          branchName: pr.branchName,
          headCommitSha: pr.commitSha,
          pullRequestUrl: pr.pullRequestUrl,
        }))) {
          throw new Error('Pull Request criado, mas metadados não foram persistidos.');
        }
        await transition('pull_request_opened');
      }

      // A retomada usa o SHA registrado, nunca recria o patch ou cobra creditos.
      if (candidate.state === 'pull_request_opened' || candidate.state === 'ci_pending') {
        if (!candidate.headCommitSha) {
          return {
            state: candidate.state,
            message: 'SHA do Pull Request ausente. Não é seguro retomar o CI.',
          };
        }

        const ci = await CIGateService.runCIGate(candidate.headCommitSha);
        if (ci.status === 'not_configured') {
          return { state: candidate.state, message: `CI não configurado: ${ci.details}` };
        }
        if (ci.status === 'pending') {
          await transition('ci_pending');
          return { state: 'ci_pending', message: `CI em andamento: ${ci.details}` };
        }
        if (!ci.passed) {
          await transition('ci_failed');
          return { state: 'ci_failed', message: `CI reprovado: ${ci.details}` };
        }
        await transition('ci_passed');
      }

      if (candidate.state === 'ci_passed') {
        if (candidate.headCommitSha && !(await ContinuousCapabilityEvaluationService.hasPassingComparison(candidate.headCommitSha))) {
          const evaluation = await GithubCapabilityEvaluationService.evaluateCandidate(candidate);
          if (evaluation.status !== 'passed') {
            return { state: 'ci_passed', message: evaluation.message };
          }
        }
        if (!candidate.branchName || !candidate.headCommitSha) {
          return {
            state: 'ci_passed',
            message: 'Branch ou SHA ausente para conferir o deploy de preview.',
          };
        }

        const preview = await PreviewDeploymentService.createPreviewDeployment(
          candidateId,
          candidate.branchName
        );
        if (preview.status === 'pending' || preview.status === 'not_configured') {
          return {
            state: 'ci_passed',
            message: `Preview aguardando: ${preview.errorMessage || preview.status}`,
          };
        }
        if (preview.status !== 'ready' || !preview.previewUrl) {
          await transition('preview_failed');
          return {
            state: 'preview_failed',
            message: `Preview reprovado: ${preview.errorMessage || 'URL indisponível.'}`,
          };
        }

        candidate.previewUrl = preview.previewUrl;
        if (!(await ImprovementPlannerService.updateCandidateMetadata(candidateId, {
          previewUrl: preview.previewUrl,
        }))) {
          throw new Error('Preview pronto, mas a URL não foi persistida.');
        }
        await transition('preview_deployed');
      }

      if (candidate.state === 'preview_deployed') {
        if (!candidate.previewUrl || !candidate.headCommitSha) {
          await transition('preview_failed');
          return {
            state: 'preview_failed',
            message: 'URL ou commit ausente para homologação real do navegador.',
          };
        }

        try {
          const report = await AutonomousBrowserValidationService.validate({
            previewUrl: candidate.previewUrl,
            commitSha: candidate.headCommitSha,
            candidateId,
          });
          await AuditService.logEvent({
            actor: 'autonomous-browser',
            action: 'validate_preview_end_to_end',
            resource: candidateId,
            riskLevel: candidate.riskLevel,
            result: report.passed ? 'success' : 'failure',
            commitHash: candidate.headCommitSha,
            deployUrl: candidate.previewUrl,
            reason: `${report.scenarios.length} cenários; sandbox ${report.sandboxId}.`,
          });
          if (!report.passed) {
            await transition('preview_failed');
            return {
              state: 'preview_failed',
              message: 'Homologação do navegador encontrou falhas verificadas.',
            };
          }
        } catch (error) {
          await transition('preview_failed');
          return {
            state: 'preview_failed',
            message: `Homologação indisponível: ${error instanceof Error ? error.message : String(error)}`,
          };
        }

        let reviews;
        try {
          reviews = await SpecialistCommitteeExecutionService.execute(candidate);
        } catch (error) {
          await transition('failed');
          await AuditService.logEvent({
            actor: 'specialist-committee',
            action: 'automatic_specialist_committee',
            resource: candidateId,
            riskLevel: candidate.riskLevel,
            result: 'failure',
            commitHash: candidate.headCommitSha,
            prUrl: candidate.pullRequestUrl,
            reason: error instanceof Error ? error.message : String(error),
          });
          return {
            state: 'failed',
            message: `Comitê indisponível: ${error instanceof Error ? error.message : String(error)}`,
          };
        }

        const committeeGate = CommitteeGateService.evaluateReviews({
          candidateId,
          commitSha: candidate.headCommitSha,
          riskLevel: candidate.riskLevel,
          reviews,
        });
        await AuditService.logEvent({
          actor: 'specialist-committee',
          action: 'automatic_specialist_committee',
          resource: candidateId,
          riskLevel: candidate.riskLevel,
          result: committeeGate.status === 'blocked' ? 'rejected' :
            committeeGate.approved ? 'success' : 'failure',
          commitHash: candidate.headCommitSha,
          prUrl: candidate.pullRequestUrl,
          reason: committeeGate.reason,
        });

        if (committeeGate.status === 'blocked' ||
          (!committeeGate.approved && candidate.riskLevel !== 'R2' && candidate.riskLevel !== 'R3')) {
          await transition('failed');
          return {
            state: 'failed',
            message: `Comitê não aprovou a mudança: ${committeeGate.reason}`,
          };
        }

        // Estado duravel apos verificacao, sem repetir as dez revisoes a cada tentativa.
        await transition('awaiting_release_approval');
      }

      if (candidate.state === 'awaiting_release_approval') {
        return this.tryAutonomousRelease(candidateId);
      }

      return {
        state: candidate.state,
        message: `Estado atual do candidato: ${candidate.state}`,
      };
    } finally {
      await LockService.releaseLock(candidateId, actor);
    }
  }

  /** A publicacao depende de evidencias reais e de configuracao explicita. */
  private static async tryAutonomousRelease(
    candidateId: string
  ): Promise<{ state: CandidateState; message: string }> {
    const candidate = await ImprovementPlannerService.getCandidateById(candidateId);
    if (!candidate || candidate.state !== 'awaiting_release_approval') {
      return {
        state: candidate?.state || 'failed',
        message: 'Candidato não está pronto para conferência de release.',
      };
    }

    const gate = await CommitteeGateService.evaluateCandidate(candidate);
    if (gate.status === 'blocked') {
      await ImprovementPlannerService.updateCandidateState(candidateId, 'failed');
      return { state: 'failed', message: `Comitê bloqueou o release: ${gate.reason}` };
    }
    if (!gate.approved) {
      return {
        state: 'awaiting_release_approval',
        message: `Release automático bloqueado pela política de revisão atual: ${gate.reason}`,
      };
    }

    const decision = ReleaseDecisionService.canReleaseToProduction(candidate, false, gate);
    if (!decision.canRelease) {
      return { state: 'awaiting_release_approval', message: decision.reason };
    }
    if (!candidate.headCommitSha) {
      return { state: 'awaiting_release_approval', message: 'Commit do candidato ausente.' };
    }
    if (!(await ContinuousCapabilityEvaluationService.hasPassingComparison(candidate.headCommitSha))) {
      const evaluation = await GithubCapabilityEvaluationService.evaluateCandidate(candidate);
      if (evaluation.status !== 'passed') {
        return { state: 'awaiting_release_approval', message: evaluation.message };
      }
    }
    if (!SelfEvolutionPolicyEngine.isAutonomousProductionDeployAllowed()) {
      return {
        state: 'awaiting_release_approval',
        message: 'Deploy automático desativado por configuração. Nenhum merge foi realizado.',
      };
    }

    const merge = await GithubAutomationService.mergeApprovedPullRequest(
      candidate.pullRequestUrl,
      candidate.headCommitSha
    );
    await AuditService.logEvent({
      actor: 'self-evolution',
      action: 'merge_approved_release',
      resource: candidateId,
      riskLevel: candidate.riskLevel,
      result: merge.success ? 'success' : 'failure',
      reason: merge.message,
      commitHash: merge.mergeCommitSha,
      prUrl: candidate.pullRequestUrl,
    });
    if (!merge.success) {
      return { state: 'awaiting_release_approval', message: merge.message };
    }

    if (!(await ImprovementPlannerService.updateCandidateState(candidateId, 'approved_for_release'))) {
      throw new Error('Merge confirmado, mas não foi possível persistir o estado do release.');
    }
    return {
      state: 'approved_for_release',
      message: `${merge.message} A publicação em produção ainda requer smoke test comprovado.`,
    };
  }

  static async approveRelease(candidateId: string, adminUid: string): Promise<{ success: boolean; message: string }> {
    const candidate = await ImprovementPlannerService.getCandidateById(candidateId);
    if (!candidate) return { success: false, message: 'Candidato não encontrado.' };

    if (!candidate.headCommitSha) {
      return { success: false, message: 'Release bloqueada: commit do candidato ausente.' };
    }
    if (!(await ContinuousCapabilityEvaluationService.hasPassingComparison(candidate.headCommitSha))) {
      const evaluation = await GithubCapabilityEvaluationService.evaluateCandidate(candidate);
      if (evaluation.status !== 'passed') {
        return { success: false, message: evaluation.message };
      }
    }

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

    if (
      SelfEvolutionPolicyEngine.isAutonomousProductionDeployAllowed()
    ) {
      const merge = await GithubAutomationService.mergeApprovedPullRequest(
        candidate.pullRequestUrl,
        candidate.headCommitSha
      );
      await AuditService.logEvent({
        actor: adminUid,
        action: 'merge_approved_release',
        resource: candidateId,
        riskLevel: candidate.riskLevel,
        result: merge.success ? 'success' : 'failure',
        reason: merge.message,
        commitHash: merge.mergeCommitSha,
        prUrl: candidate.pullRequestUrl,
      });
      if (!merge.success) return merge;
      return { success: true, message: merge.message };
    }

    return {
      success: true,
      message:
        'Release aprovada. O merge continua manual porque AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED está desativado.',
    };
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
