import { describe, expect, it, vi } from 'vitest';
import { continuationFromEvent } from '../scripts/self-evolution-events.mjs';
import { selectRunnerCandidate } from '../server/selfEvolution/runnerContinuationPolicy.js';
import { planCIFailureRecovery } from '../server/selfEvolution/ciFailureRecoveryService.js';
import { planSelfEvolutionRun } from '../scripts/self-evolution-schedule.mjs';
import { runnerOutcomePolicy } from '../server/selfEvolution/runnerOutcomePolicy.js';

const sha = 'a'.repeat(40), other = 'b'.repeat(40);
const repo = { owner: 'brasilportalvip-png', repo: 'frocia2' };
function event() {
  return { eventName: 'workflow_run', repo, payload: { action: 'completed',
    repository: { full_name: 'brasilportalvip-png/frocia2', default_branch: 'main' },
    workflow_run: { status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml', event: 'workflow_dispatch',
      head_repository: { full_name: 'brasilportalvip-png/frocia2' }, head_branch: 'froc-evolution/r2/task', head_sha: sha } } };
}

describe('Continuidade automatica por evidencias do GitHub', () => {
  it('retoma o SHA do CI e das capacidades, inclusive fora do horario diario', async () => {
    const context = event();
    const github = { paginate: vi.fn() };
    for (const path of ['.github/workflows/ci.yml', '.github/workflows/capability-checks.yml']) {
      context.payload.workflow_run.path = path;
      expect(await planSelfEvolutionRun({ github, context, now: new Date('2026-10-25T03:00:00Z') }))
        .toMatchObject({ shouldRun: true, reason: 'automatic_continuation', resumeOnly: true, resumeSha: sha });
    }
    expect(github.paginate).not.toHaveBeenCalled();
  });
  it('rejeita fork, workflow diferente, branch arbitraria, SHA invalido e aprovacao ainda pendente', () => {
    const mutations = [
      (c: ReturnType<typeof event>) => { c.payload.workflow_run.head_repository.full_name = 'fork/frocia2'; },
      (c: ReturnType<typeof event>) => { c.payload.workflow_run.path = '.github/workflows/other.yml'; },
      (c: ReturnType<typeof event>) => { c.payload.workflow_run.head_branch = 'untrusted/branch'; },
      (c: ReturnType<typeof event>) => { c.payload.workflow_run.head_sha = 'main'; },
      (c: ReturnType<typeof event>) => { c.payload.workflow_run.conclusion = 'action_required'; },
    ];
    for (const mutate of mutations) { const c = event(); mutate(c); expect(continuationFromEvent(c).accepted).toBe(false); }
  });
  it('aceita somente o status da Vercel emitido pelo bot oficial', () => {
    const c = { eventName: 'status', repo, payload: { repository: event().payload.repository,
      context: 'Vercel', state: 'success', sha, sender: { login: 'vercel[bot]', type: 'Bot' } } };
    expect(continuationFromEvent(c)).toMatchObject({ accepted: true, resumeSha: sha });
    c.payload.sender.login = 'another-user'; expect(continuationFromEvent(c).accepted).toBe(false);
    c.payload.sender.login = 'vercel[bot]'; c.payload.state = 'pending'; expect(continuationFromEvent(c).accepted).toBe(false);
  });
  it('preserva a pausa explicita tambem nos eventos automaticos', async () => {
    expect(await planSelfEvolutionRun({ github: {}, context: event(), enabled: 'false' })).toMatchObject({ shouldRun: false, reason: 'runner_disabled' });
  });
  it('retoma a tarefa do evento em vez da tarefa antiga da fila', () => {
    const tasks = [{ id: 'old', state: 'ci_pending', headCommitSha: other, createdAt: '2026-10-01' },
      { id: 'current', state: 'ci_pending', headCommitSha: sha, createdAt: '2026-10-25' }];
    expect(selectRunnerCandidate(tasks, { resumeOnly: true, resumeSha: sha })?.id).toBe('current');
    expect(selectRunnerCandidate(tasks, { resumeOnly: true, resumeSha: 'c'.repeat(40) })).toBeUndefined();
  });
  it('evento nao gera patch e a publicacao usa o SHA do merge', () => {
    const tasks = [{ id: 'new', state: 'detected', headCommitSha: sha },
      { id: 'published', state: 'monitoring', headCommitSha: other, productionMergeSha: sha }];
    expect(selectRunnerCandidate(tasks, { resumeOnly: true, resumeSha: sha })?.id).toBe('published');
    expect(selectRunnerCandidate(tasks.slice(0, 1), { resumeOnly: true, resumeSha: sha })).toBeUndefined();
  });
  it('agendamento alterna tarefas para que um bloqueio antigo nao monopolize a fila', () => {
    const tasks = [{ id: 'old', state: 'ci_pending', createdAt: '2026-10-01', lastLifecycleAttemptAt: '2026-10-25T14:00:00Z' },
      { id: 'new', state: 'ci_pending', createdAt: '2026-10-25T13:00:00Z' }];
    expect(selectRunnerCandidate(tasks)?.id).toBe('new');
    expect(selectRunnerCandidate(tasks, { requestedId: 'old' })?.id).toBe('old');
  });
});

describe('Retentativa real e limitada de CI reprovado', () => {
  const now = new Date('2026-10-25T14:00:00Z');
  const candidate = { state: 'ci_failed', headCommitSha: sha, branchName: 'froc-evolution/r2/task', pullRequestUrl: 'https://github.com/brasilportalvip-png/frocia2/pull/98' };
  it('solicita novo dispatch em vez de consultar eternamente o CI antigo', () => {
    expect(planCIFailureRecovery(candidate, { runId: '52:1', now })).toMatchObject({ state: 'pull_request_opened', ciRetryRequired: true, ciRecovery: { count: 1, headSha: sha } });
  });
  it('respeita intervalo, idempotencia e limite por commit e dia', () => {
    const update = planCIFailureRecovery(candidate, { runId: '52:1', now })!;
    const retried = { ...candidate, ...update, state: 'ci_failed' };
    expect(planCIFailureRecovery(retried, { runId: '52:1', now: new Date(now.getTime() + 20 * 60000) })).toBeNull();
    expect(planCIFailureRecovery(retried, { runId: '53:1', now: new Date(now.getTime() + 60000) })).toBeNull();
    const second = planCIFailureRecovery(retried, { runId: '53:1', now: new Date(now.getTime() + 11 * 60000) })!;
    expect(second).toMatchObject({ ciRecovery: { count: 2 } });
    expect(planCIFailureRecovery({ ...retried, ...second, state: 'ci_failed' }, { runId: '54:1', now: new Date(now.getTime() + 30 * 60000) })).toBeNull();
    expect(planCIFailureRecovery({ ...retried, headCommitSha: other }, { runId: '54:1', now })).not.toBeNull();
    expect(runnerOutcomePolicy({ status: 'ci_retry_blocked' }, true)).toMatchObject({ failed: true, dailyComplete: false });
  });
});
