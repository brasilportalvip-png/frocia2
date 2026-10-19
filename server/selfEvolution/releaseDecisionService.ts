import {
  CommitteeGateResult,
  ImprovementCandidate
} from './selfEvolutionTypes.js';

/**
 * O trabalho pode seguir sem aprovacao humana por mudanca.
 * A publicacao so e autorizada depois dos gates automaticos comprovados.
 * A verificacao da execucao de CI, preview, comite e capacidades permanece
 * sob responsabilidade do orquestrador e dos respectivos servicos.
 */
export class ReleaseDecisionService {
  static canReleaseToProduction(
    candidate: ImprovementCandidate,
    _isHumanApproved: boolean,
    committeeGate: CommitteeGateResult
  ): {
    canRelease: boolean;
    reason: string;
  } {
    if (!committeeGate.approved || committeeGate.status !== 'approved') {
      return {
        canRelease: false,
        reason: `Comite independente nao aprovou: ${committeeGate.reason}`
      };
    }

    if (
      candidate.state !== 'ci_passed' &&
      candidate.state !== 'preview_deployed' &&
      candidate.state !== 'awaiting_release_approval'
    ) {
      return {
        canRelease: false,
        reason: `Candidato no estado '${candidate.state}' nao concluiu validacoes previas.`
      };
    }

    return {
      canRelease: true,
      reason: 'Candidato apto para liberacao automatica condicionada aos gates de seguranca.'
    };
  }
}
