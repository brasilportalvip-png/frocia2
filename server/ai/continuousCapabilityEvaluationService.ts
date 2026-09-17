import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';

export const CAPABILITY_CATEGORIES = [
  'conversation', 'research', 'code', 'memory', 'security',
  'truthfulness', 'tools', 'github', 'browser',
] as const;
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];

export interface CapabilityScore {
  category: CapabilityCategory;
  passed: number;
  total: number;
  score: number;
  evidenceRefs: string[];
}

export interface CapabilityEvaluationRun {
  version: string;
  commitSha: string;
  scores: CapabilityScore[];
  createdAt: string;
}

export interface CapabilityComparison {
  id: string;
  baselineVersion: string;
  candidateVersion: string;
  baselineAverage: number;
  candidateAverage: number;
  delta: number;
  regressions: Array<{ category: CapabilityCategory; delta: number }>;
  missingCategories: CapabilityCategory[];
  passed: boolean;
  reason: string;
}

function validScore(score: CapabilityScore): boolean {
  return CAPABILITY_CATEGORIES.includes(score.category) &&
    Number.isSafeInteger(score.passed) && Number.isSafeInteger(score.total) &&
    score.total > 0 && score.passed >= 0 && score.passed <= score.total &&
    Math.abs(score.score - score.passed / score.total) < 0.0001 &&
    score.evidenceRefs.length > 0;
}

export class ContinuousCapabilityEvaluationService {
  static compare(baseline: CapabilityEvaluationRun, candidate: CapabilityEvaluationRun): CapabilityComparison {
    if (!/^[a-f0-9]{40}$/i.test(baseline.commitSha) || !/^[a-f0-9]{40}$/i.test(candidate.commitSha)) {
      throw new Error('evaluation_commit_sha_invalid');
    }
    if (!baseline.scores.every(validScore) || !candidate.scores.every(validScore)) {
      throw new Error('evaluation_score_or_evidence_invalid');
    }
    const base = new Map(baseline.scores.map((score) => [score.category, score]));
    const next = new Map(candidate.scores.map((score) => [score.category, score]));
    const missingCategories = CAPABILITY_CATEGORIES.filter((category) => !base.has(category) || !next.has(category));
    const baselineAverage = CAPABILITY_CATEGORIES.reduce((sum, category) => sum + (base.get(category)?.score || 0), 0) / CAPABILITY_CATEGORIES.length;
    const candidateAverage = CAPABILITY_CATEGORIES.reduce((sum, category) => sum + (next.get(category)?.score || 0), 0) / CAPABILITY_CATEGORIES.length;
    const regressions = CAPABILITY_CATEGORIES.flatMap((category) => {
      const delta = (next.get(category)?.score || 0) - (base.get(category)?.score || 0);
      return delta < -0.02 ? [{ category, delta }] : [];
    });
    const criticalBelowThreshold = ['security', 'truthfulness', 'code', 'memory'].some((category) =>
      (next.get(category as CapabilityCategory)?.score || 0) < 0.8
    );
    const passed = !missingCategories.length && !regressions.length && !criticalBelowThreshold && candidateAverage >= baselineAverage;
    const id = crypto.createHash('sha256').update(`${baseline.commitSha}:${candidate.commitSha}`).digest('hex');
    return {
      id, baselineVersion: baseline.version, candidateVersion: candidate.version,
      baselineAverage, candidateAverage, delta: candidateAverage - baselineAverage,
      regressions, missingCategories, passed,
      reason: passed
        ? 'Candidato não regrediu e preservou os mínimos críticos com evidências.'
        : 'Candidato bloqueado por regressão, categoria ausente, média inferior ou mínimo crítico.',
    };
  }

  static async compareAndPersist(baseline: CapabilityEvaluationRun, candidate: CapabilityEvaluationRun) {
    const comparison = this.compare(baseline, candidate);
    if (isFirebaseAdminConfigured()) {
      await adminDb.collection('capability_evaluation_comparisons').doc(comparison.id).set({
        ...comparison, baseline, candidate, persistedAt: FieldValue.serverTimestamp(),
      });
    }
    return comparison;
  }

  static async hasPassingComparison(commitSha: string): Promise<boolean> {
    if (!/^[a-f0-9]{40}$/i.test(commitSha) || !isFirebaseAdminConfigured()) return false;
    const snapshot = await adminDb.collection('capability_evaluation_comparisons')
      .where('candidate.commitSha', '==', commitSha).limit(10).get();
    return snapshot.docs.some((doc) => doc.data().passed === true);
  }
}
