const OFFICIAL_WORKFLOWS = new Set(['.github/workflows/ci.yml', '.github/workflows/capability-checks.yml']);
const SHA = /^[a-f0-9]{40}$/i;

// Only metadata from this repository can wake the privileged runner. Its checkout
// stays on github.sha (the default branch), never on the triggering PR's code.
export function continuationFromEvent(context) {
  const payload = context.payload || {};
  const repository = context.repo.owner + '/' + context.repo.repo;
  const rejected = { accepted: false, resumeOnly: true, resumeSha: '' };
  if (payload.repository?.full_name !== repository) return rejected;
  if (context.eventName === 'workflow_run') {
    const run = payload.workflow_run;
    if (!run || payload.action !== 'completed' || run.status !== 'completed' ||
        !['success', 'failure', 'timed_out', 'cancelled'].includes(run.conclusion) ||
        !OFFICIAL_WORKFLOWS.has(String(run.path || '').split('@')[0]) ||
        run.head_repository?.full_name !== repository || !SHA.test(run.head_sha || '') ||
        !['workflow_dispatch', 'pull_request', 'push'].includes(run.event) ||
        !(run.head_branch === payload.repository.default_branch || /^froc-evolution\/[A-Za-z0-9._/-]+$/.test(run.head_branch || '')) ||
        String(run.head_branch).includes('..')) return rejected;
    return { accepted: true, resumeOnly: true, resumeSha: run.head_sha, source: 'official_workflow' };
  }
  if (context.eventName === 'status') {
    if (payload.context !== 'Vercel' || !['success', 'failure', 'error'].includes(payload.state) ||
        payload.sender?.login !== 'vercel[bot]' || payload.sender?.type !== 'Bot' || !SHA.test(payload.sha || '')) return rejected;
    return { accepted: true, resumeOnly: true, resumeSha: payload.sha, source: 'vercel_status' };
  }
  return rejected;
}
