import {
  CommitteeGateResult,
  ImprovementCandidate
} from './selfEvolutionTypes.js';

export class ReleaseDecisionService {
  static canReleaseToProduction(
    candidate: ImprovementCandidate,
    isHumanApproved: boolean,
    committeeGate: CommitteeGateResult
  ): {
    canRelease: boolean;
    reason: string;
  } {
    if (!committeeGate.approved) {
      return {
        canRelease: false,
        reason:
          `Comitê independente não aprovou: ${committeeGate.reason}`
      };
    }

    if (candidate.riskLevel === 'R3' || candidate.riskLevel === 'R2') {
      if (!isHumanApproved) {
        return {
          canRelease: false,
          reason: `Mudança de risco ${candidate.riskLevel} exige aprovação humana prévia obrigatória.`,
        };
      }
    }

    if (candidate.state !== 'ci_passed' && candidate.state !== 'preview_deployed') {
      return {
        canRelease: false,
        reason: `Candidato no estado '${candidate.state}' não concluiu validações prévias.`,
      };
    }

    return {
      canRelease: true,
      reason: 'Candidato apto para release controlada.',
    };
  }
}
