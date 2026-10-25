import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { CIGateService } from './ciGateService.js';

interface RetryContext { runId: string; now: Date }
export function planCIFailureRecovery(candidate: Record<string, any>, context: RetryContext): Record<string, unknown> | null {
  if (candidate.state !== 'ci_failed' || candidate.productionMergeSha || !candidate.pullRequestUrl ||
      !/^[a-f0-9]{40}$/i.test(candidate.headCommitSha || '') ||
      !/^froc-evolution\/[A-Za-z0-9._/-]+$/.test(candidate.branchName || '') || candidate.branchName.includes('..')) return null;
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(context.now);
  const prior = candidate.ciRecovery;
  const same = prior?.headSha === candidate.headCommitSha && prior?.dateKey === dateKey;
  const count = same ? Number(prior.count || 0) : 0;
  if (!context.runId || !Number.isSafeInteger(count) || count < 0 || count >= 2 || prior?.runId === context.runId) return null;
  if (same && (!Number.isFinite(Date.parse(prior.requestedAt || '')) || context.now.getTime() - Date.parse(prior.requestedAt) < 10 * 60000)) return null;
  return { state: 'pull_request_opened', ciRetryRequired: true, updatedAt: context.now.toISOString(),
    ciRecovery: { headSha: candidate.headCommitSha, dateKey, count: count + 1, runId: context.runId, requestedAt: context.now.toISOString() } };
}

export class CIFailureRecoveryService {
  static async recover(candidateId: string, context: RetryContext): Promise<boolean> {
    if (!isFirebaseAdminConfigured()) throw new Error('Retomada do CI exige Firestore persistente.');
    const ref = adminDb.collection('self_evolution_candidates').doc(candidateId);
    const saved = await ref.get();
    const candidate = saved.data();
    if (!candidate || candidate.state !== 'ci_failed') return false;
    const ci = await CIGateService.runCIGate(candidate.headCommitSha);
    if (ci.status === 'not_configured') return false;
    return adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      const data = current.data();
      if (!data || data.state !== 'ci_failed' || data.headCommitSha !== candidate.headCommitSha) return false;
      const update = ci.status === 'success' || ci.status === 'pending'
        ? { state: 'ci_pending', ciRetryRequired: false, updatedAt: context.now.toISOString() }
        : planCIFailureRecovery(data, context);
      if (!update) return false;
      tx.update(ref, update);
      return true;
    });
  }
}
