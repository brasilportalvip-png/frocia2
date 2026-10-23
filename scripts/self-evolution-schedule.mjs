const TIME_ZONE = 'America/Sao_Paulo';
const WORKFLOW_FILE = 'self-evolution-runner.yml';
const localClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function localParts(date) {
  const parts = Object.fromEntries(localClock.formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Consulta apenas metadados do Actions; nao acessa Firebase, modelos ou worker. */
export async function planSelfEvolutionRun({ github, context, enabled = '', now = new Date() }) {
  const { dateKey, minutes } = localParts(now);
  const result = (shouldRun, reason, completedRunUrl = null) =>
    ({ shouldRun, reason, dateKey, completedRunUrl });

  // Preserva a possibilidade de testar manualmente, mesmo com o automatico pausado.
  if (context.eventName === 'workflow_dispatch') return result(true, 'manual');
  if (enabled === 'false') return result(false, 'runner_disabled');
  if (context.eventName !== 'schedule') throw new Error('Gatilho de autoevolucao nao reconhecido.');
  if (minutes < 9 * 60 + 17) return result(false, 'before_daily_window');

  const branch = context.payload.repository.default_branch;
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...context.repo,
    workflow_id: WORKFLOW_FILE,
    branch,
    status: 'success',
    // Janela ampla; a decisao final usa o dia de Brasilia, inclusive perto da meia-noite UTC.
    created: `>=${new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()}`,
    per_page: 100,
    request: { timeout: 15_000 },
  });

  for (const run of runs) {
    if (run.id === context.runId || run.head_branch !== branch || run.conclusion !== 'success' ||
        !['schedule', 'workflow_dispatch'].includes(run.event)) continue;
    const startedAt = new Date(run.created_at);
    if (!Number.isFinite(startedAt.getTime()) || localParts(startedAt).dateKey !== dateKey) continue;

    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
      ...context.repo, run_id: run.id, filter: 'latest', per_page: 100,
      request: { timeout: 15_000 },
    });
    // Um workflow verde somente com a verificacao, ou com execute ignorado,
    // nao comprova que o ciclo dos agentes executou.
    if (jobs.some((job) => job.name === 'execute' && job.conclusion === 'success' &&
      job.steps?.some((step) => step.name === 'Rodada diaria finalizada' && step.conclusion === 'success'))) {
      const url = `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${run.id}`;
      return result(false, 'already_completed', url);
    }
  }

  return result(true, 'missing_daily_run');
}
