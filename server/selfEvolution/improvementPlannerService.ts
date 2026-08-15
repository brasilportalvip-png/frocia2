import crypto from 'crypto';
import { adminDb } from '../lib/firebaseAdmin.js';
import { ImprovementCandidate, RiskLevel } from './selfEvolutionTypes.js';
import { SelfEvolutionPolicyEngine } from './selfEvolutionPolicyEngine.js';

export class ImprovementPlannerService {
  private static inMemoryCandidates: ImprovementCandidate[] = [];

  static async createCandidate(params: {
    title: string;
    summary: string;
    evidence: string[];
    affectedComponents: string[];
    probableFiles: string[];
    hypothesis: string;
    expectedBehavior: string;
    isSecurityComponent?: boolean;
  }): Promise<ImprovementCandidate> {
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

    if (adminDb) {
      try {
        await adminDb.collection('self_evolution_candidates').doc(candidate.id).set(candidate);
      } catch (err) {
        console.error('Erro ao salvar candidato no Firestore:', err);
      }
    }

    this.inMemoryCandidates.unshift(candidate);
    return candidate;
  }

  static async getCandidates(limit: number = 50): Promise<ImprovementCandidate[]> {
    if (adminDb) {
      try {
        const snapshot = await adminDb
          .collection('self_evolution_candidates')
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .get();

        if (!snapshot.empty) {
          return snapshot.docs.map((doc) => doc.data() as ImprovementCandidate);
        }
      } catch (err) {
        console.error('Erro ao buscar candidatos no Firestore:', err);
      }
    }

    return this.inMemoryCandidates.slice(0, limit);
  }

  static async getCandidateById(id: string): Promise<ImprovementCandidate | undefined> {
    if (adminDb) {
      try {
        const doc = await adminDb.collection('self_evolution_candidates').doc(id).get();
        if (doc.exists) {
          return doc.data() as ImprovementCandidate;
        }
      } catch (err) {
        console.error('Erro ao buscar candidato por ID no Firestore:', err);
      }
    }

    return this.inMemoryCandidates.find((c) => c.id === id);
  }

  static async updateCandidateState(id: string, newState: ImprovementCandidate['state']): Promise<boolean> {
    const updatedAt = new Date().toISOString();

    if (adminDb) {
      try {
        const docRef = adminDb.collection('self_evolution_candidates').doc(id);
        const doc = await docRef.get();
        if (doc.exists) {
          await docRef.update({ state: newState, updatedAt });
          return true;
        }
      } catch (err) {
        console.error('Erro ao atualizar estado do candidato no Firestore:', err);
      }
    }

    const candidate = this.inMemoryCandidates.find((c) => c.id === id);
    if (!candidate) return false;
    candidate.state = newState;
    candidate.updatedAt = updatedAt;
    return true;
  }
}

