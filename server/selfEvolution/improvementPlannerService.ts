import crypto from 'crypto';
import { ImprovementCandidate, RiskLevel } from './selfEvolutionTypes.js';
import { SelfEvolutionPolicyEngine } from './selfEvolutionPolicyEngine.js';

export class ImprovementPlannerService {
  private static candidates: ImprovementCandidate[] = [];

  static createCandidate(params: {
    title: string;
    summary: string;
    evidence: string[];
    affectedComponents: string[];
    probableFiles: string[];
    hypothesis: string;
    expectedBehavior: string;
    isSecurityComponent?: boolean;
  }): ImprovementCandidate {
    const riskLevel: RiskLevel = SelfEvolutionPolicyEngine.classifyRisk(
      params.probableFiles,
      params.isSecurityComponent
    );

    const requiresApproval = riskLevel === 'R2' || riskLevel === 'R3';

    const candidate: ImprovementCandidate = {
      id: `cand-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      title: params.title,
      summary: params.summary,
      evidence: params.evidence,
      frequency: 1,
      affectedUsersCount: 1,
      severity: riskLevel === 'R3' ? 'critical' : riskLevel === 'R2' ? 'high' : 'medium',
      confidence: 0.9,
      affectedComponents: params.affectedComponents,
      probableFiles: params.probableFiles,
      hypothesis: params.hypothesis,
      expectedBehavior: params.expectedBehavior,
      riskLevel,
      estimatedCostCredits: 10,
      testPlan: 'Executar testes HTTP e unitários automatizados.',
      rollbackStrategy: 'Reverter commit e redeploy da versão estável anterior.',
      duplicates: [],
      requiresApproval,
      state: 'detected',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.candidates.unshift(candidate);
    return candidate;
  }

  static getCandidates(limit: number = 50): ImprovementCandidate[] {
    return this.candidates.slice(0, limit);
  }

  static getCandidateById(id: string): ImprovementCandidate | undefined {
    return this.candidates.find((c) => c.id === id);
  }

  static updateCandidateState(id: string, newState: ImprovementCandidate['state']): boolean {
    const candidate = this.getCandidateById(id);
    if (!candidate) return false;
    candidate.state = newState;
    candidate.updatedAt = new Date().toISOString();
    return true;
  }
}
