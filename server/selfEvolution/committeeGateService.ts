import crypto from 'node:crypto';
import {
  adminDb,
  isFirebaseAdminConfigured
} from '../lib/firebaseAdmin.js';
import {
  COMMITTEE_ROLES,
  CommitteeGateResult,
  CommitteeReview,
  CommitteeRole,
  CommitteeVerdict,
  ImprovementCandidate
} from './selfEvolutionTypes.js';

const IMPLEMENTER_ROLES = new Set<CommitteeRole>([
  'frontend',
  'backend',
  'data',
  'devops'
]);

export class CommitteePersistenceUnavailableError extends Error {
  constructor() {
    super(
      'Firestore Admin não está configurado; os pareceres não podem ser persistidos nem auditados.'
    );
    this.name = 'CommitteePersistenceUnavailableError';
  }
}

export class CommitteeGateService {
  static async submitReview(input: {
    candidateId: string;
    role: CommitteeRole;
    actorUid: string;
    commitSha: string;
    verdict: CommitteeVerdict;
    summary: string;
    fileRefs: string[];
    testRefs: string[];
    evidenceRefs: string[];
    risks: string[];
  }): Promise<CommitteeReview> {
    if (!isFirebaseAdminConfigured()) {
      throw new CommitteePersistenceUnavailableError();
    }

    const now = new Date().toISOString();
    const review: CommitteeReview = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now
    };

    const currentId =
      `${input.candidateId}__${input.role}`;
    const currentRef = adminDb
      .collection('self_evolution_committee_reviews')
      .doc(currentId);
    const historyRef = adminDb
      .collection('self_evolution_committee_review_history')
      .doc(review.id);

    const batch = adminDb.batch();
    batch.set(currentRef, review);
    batch.set(historyRef, review);
    await batch.commit();

    return review;
  }

  static async listReviews(
    candidateId: string
  ): Promise<CommitteeReview[]> {
    if (!isFirebaseAdminConfigured()) {
      throw new CommitteePersistenceUnavailableError();
    }

    const snapshot = await adminDb
      .collection('self_evolution_committee_reviews')
      .where('candidateId', '==', candidateId)
      .get();

    return snapshot.docs.map(
      (doc) => doc.data() as CommitteeReview
    );
  }

  static evaluateReviews(input: {
    candidateId: string;
    commitSha?: string;
    riskLevel: ImprovementCandidate['riskLevel'];
    reviews: CommitteeReview[];
    humanApproverUid?: string;
  }): CommitteeGateResult {
    const emptyResult = {
      missingRoles: [] as CommitteeRole[],
      staleRoles: [] as CommitteeRole[],
      invalidRoles: [] as CommitteeRole[],
      conflictingRoles: [] as CommitteeRole[]
    };

    if (
      !input.commitSha ||
      !/^[a-f0-9]{7,40}$/i.test(input.commitSha)
    ) {
      return {
        ...emptyResult,
        status: 'incomplete',
        approved: false,
        reason:
          'O commit exato da mudança ainda não foi registrado.'
      };
    }

    const byRole = new Map<CommitteeRole, CommitteeReview>();

    for (const review of input.reviews) {
      if (review.candidateId !== input.candidateId) {
        continue;
      }
      byRole.set(review.role, review);
    }

    const missingRoles = COMMITTEE_ROLES.filter(
      (role) => !byRole.has(role)
    );

    if (missingRoles.length > 0) {
      return {
        ...emptyResult,
        missingRoles,
        status: 'incomplete',
        approved: false,
        reason:
          `Faltam pareceres: ${missingRoles.join(', ')}.`
      };
    }

    const reviews = COMMITTEE_ROLES.map(
      (role) => byRole.get(role)!
    );
    const staleRoles = reviews
      .filter(
        (review) => review.commitSha !== input.commitSha
      )
      .map((review) => review.role);
    const invalidRoles = reviews
      .filter((review) => {
        const hasConcreteReference =
          review.fileRefs.length > 0 ||
          review.testRefs.length > 0 ||
          review.risks.length > 0;

        return (
          review.summary.trim().length < 10 ||
          review.evidenceRefs.length === 0 ||
          !hasConcreteReference
        );
      })
      .map((review) => review.role);
    const conflictingRoles = reviews
      .filter(
        (review) => review.verdict !== 'approved'
      )
      .map((review) => review.role);

    if (
      staleRoles.length > 0 ||
      invalidRoles.length > 0 ||
      conflictingRoles.length > 0
    ) {
      return {
        missingRoles: [],
        staleRoles,
        invalidRoles,
        conflictingRoles,
        status: 'blocked',
        approved: false,
        reason:
          'O comitê contém parecer desatualizado, sem evidência concreta ou contrário à liberação.'
      };
    }

    const actors = reviews.map(
      (review) => review.actorUid
    );
    const duplicateActors = actors.filter(
      (actor, index) => actors.indexOf(actor) !== index
    );

    if (duplicateActors.length > 0) {
      return {
        ...emptyResult,
        status: 'blocked',
        approved: false,
        reason:
          'Papéis diferentes do comitê não podem ser aprovados pela mesma identidade.'
      };
    }

    const implementerActors = new Set(
      reviews
        .filter((review) => IMPLEMENTER_ROLES.has(review.role))
        .map((review) => review.actorUid)
    );
    const verifier = byRole.get('independent_verifier')!;
    const qa = byRole.get('qa')!;

    if (
      implementerActors.has(verifier.actorUid) ||
      implementerActors.has(qa.actorUid)
    ) {
      return {
        ...emptyResult,
        status: 'blocked',
        approved: false,
        reason:
          'QA e verificador independente não podem usar identidade de implementador.'
      };
    }

    if (
      input.riskLevel === 'R2' ||
      input.riskLevel === 'R3'
    ) {
      if (!input.humanApproverUid) {
        return {
          ...emptyResult,
          status: 'incomplete',
          approved: false,
          reason:
            `Mudança ${input.riskLevel} exige aprovação humana separada.`
        };
      }

      if (actors.includes(input.humanApproverUid)) {
        return {
          ...emptyResult,
          status: 'blocked',
          approved: false,
          reason:
            'A aprovação humana de alto risco deve usar identidade diferente dos membros do comitê.'
        };
      }
    }

    return {
      ...emptyResult,
      status: 'approved',
      approved: true,
      reason:
        'Todos os papéis entregaram evidências do mesmo commit com identidades separadas.'
    };
  }

  static async evaluateCandidate(
    candidate: ImprovementCandidate,
    humanApproverUid?: string
  ): Promise<CommitteeGateResult> {
    let reviews: CommitteeReview[];

    try {
      reviews = await this.listReviews(candidate.id);
    } catch (error) {
      if (
        error instanceof
        CommitteePersistenceUnavailableError
      ) {
        return {
          status: 'incomplete',
          approved: false,
          reason: error.message,
          missingRoles: [...COMMITTEE_ROLES],
          staleRoles: [],
          invalidRoles: [],
          conflictingRoles: []
        };
      }
      throw error;
    }

    return this.evaluateReviews({
      candidateId: candidate.id,
      commitSha: candidate.headCommitSha,
      riskLevel: candidate.riskLevel,
      reviews,
      humanApproverUid
    });
  }
}
