export interface CommitteeReviewView {
  id: string;
  role: string;
  actorUid: string;
  commitSha: string;
  verdict: string;
  summary: string;
  fileRefs: string[];
  testRefs: string[];
  evidenceRefs: string[];
  risks: string[];
}
export interface CommitteeInspection {
  simulation?: boolean;
  candidateId?: string;
  commitSha: string | null;
  reviews: CommitteeReviewView[];
  gate: { status: string; approved: boolean; reason: string };
  verifierControl?: { status: string; reason: string };
  sideEffects?: { credits: number; aiCalls: number; pullRequests: number; deployments: number };
}

export function parseCommitteeInspection(payload: unknown): CommitteeInspection {
  const data = payload as CommitteeInspection | null;
  if (!data || !Array.isArray(data.reviews) || !data.gate ||
      typeof data.gate.status !== 'string' || typeof data.gate.reason !== 'string' ||
      typeof data.gate.approved !== 'boolean') {
    throw new Error('O servidor retornou um comitê inválido. Tente novamente.');
  }
  const list = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  return {
    ...data,
    commitSha: typeof data.commitSha === 'string' ? data.commitSha : null,
    reviews: data.reviews.map(review => {
      if (!review || typeof review.role !== 'string' || typeof review.summary !== 'string' ||
          !['approved', 'changes_required', 'blocked'].includes(review.verdict)) {
        throw new Error('O servidor retornou um parecer incompleto. Tente novamente.');
      }
      return { ...review, fileRefs: list(review.fileRefs), testRefs: list(review.testRefs),
        evidenceRefs: list(review.evidenceRefs), risks: list(review.risks) };
    }),
  };
}
