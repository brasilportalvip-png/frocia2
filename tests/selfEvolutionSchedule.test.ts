import { describe, expect, it, vi } from 'vitest';
import { planSelfEvolutionRun } from '../scripts/self-evolution-schedule.mjs';

const NOW = new Date('2026-10-23T12:47:00Z');
const context = {
  eventName: 'schedule', runId: 99,
  repo: { owner: 'brasilportalvip-png', repo: 'frocia2' },
  payload: { repository: { default_branch: 'main' } },
};

function successfulRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 18, head_branch: 'main', event: 'schedule', conclusion: 'success',
    created_at: '2026-10-23T12:17:00Z', ...overrides,
  };
}

function completedJob() {
  return { name: 'execute', conclusion: 'success',
    steps: [{ name: 'Rodada diaria finalizada', conclusion: 'success' }] };
}

function api(runs: unknown[] = [], jobs: Record<number, unknown[]> = {}) {
  const listWorkflowRuns = vi.fn();
  const listJobsForWorkflowRun = vi.fn();
  return {
    rest: { actions: { listWorkflowRuns, listJobsForWorkflowRun } },
    paginate: vi.fn(async (endpoint, params) => {
      if (endpoint === listWorkflowRuns) return runs;
      if (endpoint === listJobsForWorkflowRun) return jobs[params.run_id] || [];
      throw new Error('Unexpected API endpoint');
    }),
  };
}

describe('Recuperacao do agendamento dos agentes', () => {
  it('executa a recuperacao quando o disparo das 09h17 nao gerou rodada', async () => {
    const github = api();
    await expect(planSelfEvolutionRun({ github, context, now: NOW })).resolves.toMatchObject({
      shouldRun: true, reason: 'missing_daily_run', dateKey: '2026-10-23',
    });
  });

  it.each(['schedule', 'workflow_dispatch'])('evita repetir um ciclo concluido por %s', async (event) => {
    const github = api([successfulRun({ event })], { 18: [completedJob()] });
    await expect(planSelfEvolutionRun({ github, context, now: NOW })).resolves.toMatchObject({
      shouldRun: false, reason: 'already_completed',
      completedRunUrl: 'https://github.com/brasilportalvip-png/frocia2/actions/runs/18',
    });
  });

  it('nao considera a verificacao verde ou execute ignorado como ciclo concluido', async () => {
    const github = api([successfulRun()], { 18: [
      { name: 'check-schedule', conclusion: 'success' },
      { name: 'execute', conclusion: 'skipped' },
    ] });
    await expect(planSelfEvolutionRun({ github, context, now: NOW })).resolves.toMatchObject({
      shouldRun: true, reason: 'missing_daily_run',
    });
  });

  it('permite recuperar falhas sem usar sucesso de outra branch ou de outro evento', async () => {
    const github = api([
      successfulRun({ conclusion: 'failure' }),
      successfulRun({ id: 19, head_branch: 'feature/test' }),
      successfulRun({ id: 20, event: 'push' }),
    ], { 18: [{ name: 'execute', conclusion: 'failure' }] });
    await expect(planSelfEvolutionRun({ github, context, now: NOW })).resolves.toMatchObject({ shouldRun: true });
  });

  it('preserva a pausa explicita do automatico e nao chama APIs nesse caso', async () => {
    const github = api();
    await expect(planSelfEvolutionRun({ github, context, now: NOW, enabled: 'false' })).resolves.toMatchObject({
      shouldRun: false, reason: 'runner_disabled',
    });
    expect(github.paginate).not.toHaveBeenCalled();
  });

  it('mantem o teste manual disponivel mesmo depois de sucesso ou pausa do automatico', async () => {
    const github = api([successfulRun()]);
    await expect(planSelfEvolutionRun({
      github, context: { ...context, eventName: 'workflow_dispatch' }, now: NOW, enabled: 'false',
    })).resolves.toMatchObject({ shouldRun: true, reason: 'manual' });
    expect(github.paginate).not.toHaveBeenCalled();
  });

  it('usa o dia de Brasilia e aceita sucesso depois da meia-noite UTC', async () => {
    const github = api([successfulRun({ created_at: '2026-10-24T00:10:00Z' })], {
      18: [completedJob()],
    });
    await expect(planSelfEvolutionRun({ github, context, now: new Date('2026-10-24T02:00:00Z') }))
      .resolves.toMatchObject({ shouldRun: false, dateKey: '2026-10-23', reason: 'already_completed' });
  });

  it('nao deixa o sucesso de ontem impedir o ciclo de hoje', async () => {
    const github = api([successfulRun({ created_at: '2026-10-23T02:59:00Z' })], {
      18: [completedJob()],
    });
    await expect(planSelfEvolutionRun({ github, context, now: NOW })).resolves.toMatchObject({ shouldRun: true });
  });

  it('nao antecipa o ciclo quando um evento do dia anterior chega antes das 09h17', async () => {
    const github = api();
    await expect(planSelfEvolutionRun({ github, context, now: new Date('2026-10-23T12:16:59Z') }))
      .resolves.toMatchObject({ shouldRun: false, reason: 'before_daily_window' });
    expect(github.paginate).not.toHaveBeenCalled();
  });

  it('sinaliza falha da consulta em vez de afirmar que o ciclo ja executou', async () => {
    const github = api();
    github.paginate.mockRejectedValueOnce(new Error('GitHub 503'));
    await expect(planSelfEvolutionRun({ github, context, now: NOW })).rejects.toThrow('GitHub 503');
  });

  it('retoma um ciclo verde que ainda aguarda CI, preview ou outros candidatos', async () => {
    const github = api([successfulRun()], { 18: [{
      name: 'execute', conclusion: 'success',
      steps: [{ name: 'Rodada diaria finalizada', conclusion: 'skipped' }],
    }] });
    await expect(planSelfEvolutionRun({ github, context, now: NOW })).resolves.toMatchObject({ shouldRun: true });
  });

  it('nao confunde sucesso do workflow antigo com conclusao da nova auditoria', async () => {
    const github = api([successfulRun()], { 18: [{ name: 'execute', conclusion: 'success' }] });
    await expect(planSelfEvolutionRun({ github, context, now: NOW })).resolves.toMatchObject({ shouldRun: true });
  });
});
