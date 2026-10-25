import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
interface Context { preferredCandidateId?: string; sourceSha: string; runId: string; now: Date }
export function planPreviewRecovery(candidate: Record<string, any>, baseSha: unknown, context: Context) {
  if (candidate.state !== 'preview_failed' || !candidate.pullRequestUrl || !candidate.branchName ||
      !/^[a-f0-9]{40}$/i.test(candidate.headCommitSha || '') || candidate.productionMergeSha)
    return { allowed: false, reason: 'missing_or_ineligible_metadata' } as const;
  if (!/^[a-f0-9]{40}$/i.test(context.sourceSha) || baseSha !== context.sourceSha)
    return { allowed: false, reason: 'stale_or_unverified_base' } as const;
  const prior = candidate.previewRecovery || {};
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(context.now);
  const count = prior.dateKey === day && Number.isSafeInteger(prior.count) ? Math.max(0, prior.count) : 0;
  if (prior.runId === context.runId || count >= 2) return { allowed: false, reason: 'retry_limit' } as const;
  if (Date.parse(prior.attemptedAt || '') > context.now.getTime() - 15 * 60_000) return { allowed: false, reason: 'cooldown' } as const;
  return { allowed: true, reason: 'recheck_existing_patch', update: { state: 'ci_pending', updatedAt: context.now.toISOString(),
    previewRecovery: { dateKey: day, count: count + 1, runId: context.runId, attemptedAt: context.now.toISOString(), headCommitSha: candidate.headCommitSha } } } as const;
}

/** Retry validation of the same certified patch, never invoke generation or spend model credits. */
export class PreviewFailureRecoveryService {
  static async recoverNext(context: Context) {
    if (!isFirebaseAdminConfigured()) throw new Error('Retomada de preview exige Firestore persistente.');
    const snapshot = await adminDb.collection('self_evolution_candidates').where('state', '==', 'preview_failed').get();
    const blocked: Array<{ candidateId: string; reason: string }> = [];
    for (const doc of snapshot.docs) {
      if (context.preferredCandidateId && doc.id !== context.preferredCandidateId) continue;
      const result = await adminDb.runTransaction(async tx => {
        const current = await tx.get(doc.ref);
        const checkpoint = await tx.get(adminDb.collection('self_evolution_patch_checkpoints').doc(doc.id));
        const plan = planPreviewRecovery(current.data() || {}, checkpoint.data()?.baseSha, context);
        if (plan.allowed) tx.update(doc.ref, plan.update);
        return plan;
      });
      if (result.allowed) return { candidateId: doc.id, unresolved: true, blocked };
      blocked.push({ candidateId: doc.id, reason: result.reason });
    }
    return { candidateId: undefined as string | undefined, unresolved: blocked.length > 0, blocked };
  }
}
