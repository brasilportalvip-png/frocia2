export const RESUMABLE_STATES = new Set([
  'detected', 'triaged', 'awaiting_work_approval', 'approved_for_work', 'agent_running',
  'tests_passed', 'patch_created', 'pull_request_opened', 'ci_pending', 'ci_passed',
  'preview_deployed', 'awaiting_release_approval', 'approved_for_release', 'monitoring', 'ci_failed',
]);
const DELIVERY_STATES = new Set([
  'pull_request_opened', 'ci_pending', 'ci_passed', 'preview_deployed',
  'awaiting_release_approval', 'approved_for_release', 'monitoring', 'ci_failed',
]);

export interface RunnerCandidate {
  id: string;
  state?: string;
  headCommitSha?: string;
  productionMergeSha?: string;
  createdAt?: string;
  lastLifecycleAttemptAt?: string;
  [key: string]: unknown;
}

export function selectRunnerCandidate<T extends RunnerCandidate>(candidates: T[], options: {
  requestedId?: string; resumeSha?: string; resumeOnly?: boolean;
} = {}): T | undefined {
  return candidates.filter(item => {
    if (!RESUMABLE_STATES.has(String(item.state)) || (options.requestedId && item.id !== options.requestedId)) return false;
    if (options.resumeOnly && !DELIVERY_STATES.has(String(item.state))) return false;
    if (options.resumeSha) {
      const sha = ['approved_for_release', 'monitoring'].includes(String(item.state)) ? item.productionMergeSha : item.headCommitSha;
      if (sha !== options.resumeSha) return false;
    }
    return true;
  }).sort((a, b) => String(a.lastLifecycleAttemptAt || a.createdAt || '').localeCompare(String(b.lastLifecycleAttemptAt || b.createdAt || '')) || a.id.localeCompare(b.id))[0];
}
