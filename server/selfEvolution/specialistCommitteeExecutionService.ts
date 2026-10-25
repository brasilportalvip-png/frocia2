import { requiredCommitteeRoles } from './committeeReviewPolicy.js';
import { GeminiProvider } from '../ai/providers/geminiProvider.js';
import { buildSpecialistSystemInstruction } from './specialistCapabilityCatalog.js';
import { fetchSpecialistCommitEvidence, type SpecialistCommitEvidence } from './specialistReviewEvidence.js';
import { CommitteeGateService } from './committeeGateService.js';
import { env } from '../config/env.js';
import {
  COMMITTEE_ROLES, CommitteeReview, CommitteeRole, CommitteeVerdict, ImprovementCandidate,
} from './selfEvolutionTypes.js';

interface SpecialistReviewPayload {
  verdict: CommitteeVerdict;
  summary: string;
  fileRefs: string[];
  testRefs: string[];
  evidenceRefs: string[];
  risks: string[];
}

export interface SpecialistReviewAdapter {
  review(role: CommitteeRole, candidate: ImprovementCandidate, evidence?: SpecialistCommitEvidence): Promise<SpecialistReviewPayload>;
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 500)).filter(Boolean).slice(0, 100)
    : [];
}

function normalizedPreview(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

class GeminiSpecialistReviewAdapter implements SpecialistReviewAdapter {
  async review(role: CommitteeRole, candidate: ImprovementCandidate, evidence?: SpecialistCommitEvidence): Promise<SpecialistReviewPayload> {
    const response = await GeminiProvider.generate({
      model:
  role === 'independent_verifier'
    ? env.INDEPENDENT_VERIFIER_MODEL
    : env.SPECIALIST_REVIEW_MODEL,
      responseFormat: 'json', temperature: 0.1, timeoutMs: 45_000, maxRetries: 1,
      systemInstruction: buildSpecialistSystemInstruction(role),
      userMessage: JSON.stringify({
        id: candidate.id, title: candidate.title, summary: candidate.summary,
        evidence: candidate.evidence, expectedBehavior: candidate.expectedBehavior,
        probableFiles: candidate.probableFiles, testPlan: candidate.testPlan,
        rollbackStrategy: candidate.rollbackStrategy, riskLevel: candidate.riskLevel,
        commitSha: candidate.headCommitSha,
        commitEvidence: evidence || { status: 'unavailable', reason: 'not_requested' },
      }),
    });
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(response.text.replace(/^```json\s*|\s*```$/g, '')); }
    catch { throw new Error(`specialist_invalid_json:${role}`); }
    const verdict = parsed.verdict;
    if (!['approved', 'changes_required', 'blocked'].includes(String(verdict))) {
      throw new Error(`specialist_invalid_verdict:${role}`);
    }
    const payload = {
      verdict: verdict as CommitteeVerdict,
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 2000) : '',
      fileRefs: cleanList(parsed.fileRefs), testRefs: cleanList(parsed.testRefs),
      evidenceRefs: cleanList(parsed.evidenceRefs), risks: cleanList(parsed.risks),
    };
    if (payload.verdict === 'approved' && evidence?.status !== 'verified') {
      payload.verdict = 'changes_required';
      payload.risks.push('O diff integral do commit exato não foi comprovado pela API do GitHub.');
    }
    if (payload.summary.length < 10 || !payload.evidenceRefs.length || (!payload.fileRefs.length && !payload.testRefs.length && !payload.risks.length)) {
      throw new Error(`specialist_insufficient_evidence:${role}`);
    }
    return payload;
  }
}

function actorEnv(role: CommitteeRole): string {
  return `SPECIALIST_${role.toUpperCase()}_ACTOR_UID`;
}

function defaultActorUid(
  role: CommitteeRole
): string {
  return `froc-specialist-${role}`;
}

export class SpecialistCommitteeExecutionService {
  private static adapter: SpecialistReviewAdapter = new GeminiSpecialistReviewAdapter();

  static setAdapter(adapter: SpecialistReviewAdapter) { this.adapter = adapter; }

    static configuredActors(): Record<
    CommitteeRole,
    string
  > {
    const actors =
      {} as Record<
        CommitteeRole,
        string
      >;

    for (const role of COMMITTEE_ROLES) {
      const configured =
        process.env[
          actorEnv(role)
        ]?.trim();

      actors[role] =
        configured ||
        defaultActorUid(role);
    }

    if (
      new Set(
        Object.values(actors)
      ).size !==
      COMMITTEE_ROLES.length
    ) {
      throw new Error(
        'specialist_actor_identities_not_unique'
      );
    }

    return actors;
  }

  static async execute(candidate: ImprovementCandidate, validation?: SpecialistCommitEvidence['validation']): Promise<CommitteeReview[]> {
    if (!candidate.headCommitSha || !/^[a-f0-9]{40}$/i.test(candidate.headCommitSha)) {
      throw new Error('specialist_commit_sha_required');
    }
    const actors = this.configuredActors();
    const commitEvidence = this.adapter instanceof GeminiSpecialistReviewAdapter
      ? await fetchSpecialistCommitEvidence(candidate.headCommitSha) : undefined;
    if (validation && (validation.commitSha !== candidate.headCommitSha || validation.browser.commitSha !== candidate.headCommitSha ||
        validation.ci.status !== 'success' || !validation.ci.passed || !validation.browser.passed ||
        !normalizedPreview(validation.browser.previewUrl) ||
        normalizedPreview(validation.browser.previewUrl) !== normalizedPreview(candidate.previewUrl) || !validation.capabilityComparisonPassed)) {
      throw new Error('specialist_validation_evidence_mismatch');
    }
    const evidence = commitEvidence ? { ...commitEvidence, ...(validation ? { validation } : {}) } : undefined;
    const results = await Promise.allSettled(COMMITTEE_ROLES.map(async (role) => {
      const payload = await this.adapter.review(role, candidate, evidence);
      return CommitteeGateService.submitReview({
        candidateId: candidate.id, role, actorUid: actors[role],
        commitSha: candidate.headCommitSha!, ...payload,
      });
    }));
    const required = new Set(requiredCommitteeRoles(candidate.riskLevel));
    const reviews: CommitteeReview[] = [];
    for (const [index, result] of results.entries()) {
      const role = COMMITTEE_ROLES[index];
      if (result.status === 'fulfilled') reviews.push(result.value);
      else if (required.has(role)) throw new Error('specialist_required_review_unavailable:' + role);
      else console.warn('[specialist-committee] Parecer consultivo indisponível:', role);
    }
    return reviews;
  }
}
