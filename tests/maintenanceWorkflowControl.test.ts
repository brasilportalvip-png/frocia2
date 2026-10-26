import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService.js';

describe('Liga/desliga o workflow real da autoevolução', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', 'private-test-token'); vi.stubEnv('GITHUB_OWNER', 'test-owner'); vi.stubEnv('GITHUB_REPO', 'test-repo');
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('habilita e confirma sem dispatch, PR ou mudança de código', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ state: 'active' }));
    vi.stubGlobal('fetch', fetch);
    expect(await GithubAutomationService.setMaintenanceWorkflowEnabled(true)).toMatchObject({ success: true, workflowState: 'active', enabled: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/test-owner/test-repo/actions/workflows/self-evolution-runner.yml/enable');
    expect(fetch.mock.calls[0][1].method).toBe('PUT');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('dispatch'))).toBe(false);
  });
  it('desabilita o agendamento e solicita cancelamento apenas das execuções desse workflow', async () => {
    const fetch = vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      if (init.method === 'PUT') return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/self-evolution-runner.yml')) return Response.json({ state: 'disabled_manually' });
      if (url.pathname.endsWith('/runs')) return Response.json({ total_count: 1,
        workflow_runs: [{ id: 72, status: 'in_progress' }] });
      if (url.pathname.endsWith('/actions/runs/72/cancel')) return new Response(null, { status: 202 });
      throw new Error('Unexpected operation');
    });
    vi.stubGlobal('fetch', fetch);
    const result = await GithubAutomationService.setMaintenanceWorkflowEnabled(false);
    expect(result).toMatchObject({ success: true, enabled: false, workflowState: 'disabled_manually', cancellationRequested: [72], cancellationIncomplete: false });
    const cancels = fetch.mock.calls.filter(([, init]) => init.method === 'POST');
    expect(cancels).toHaveLength(1);
    expect(cancels[0][0]).toContain('/actions/runs/72/cancel');
    expect(fetch.mock.calls.every(([url]) => !url.includes('ci.yml') && !url.includes('professional-factory'))).toBe(true);
  });
  it('não confirma quando API recusa e remove a credencial da mensagem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: 'denied private-test-token' }, { status: 403 })));
    const result = await GithubAutomationService.setMaintenanceWorkflowEnabled(true);
    expect(result.success).toBe(false); expect(result.message).toContain('403');
    expect(JSON.stringify(result)).not.toContain('private-test-token');
  });
  it('não interpreta pedido aceito sem estado confirmado como habilitação concluída', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ state: 'disabled_manually' })));
    expect(await GithubAutomationService.setMaintenanceWorkflowEnabled(true)).toMatchObject({ success: false });
  });
  it('informa cancelamento incompleto sem afirmar que execuções em andamento terminaram', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
      if (init.method === 'PUT') return new Response(null, { status: 204 });
      if (input.endsWith('/self-evolution-runner.yml')) return Response.json({ state: 'disabled_manually' });
      if (input.includes('/runs?')) return Response.json({ total_count: 1, workflow_runs: [{ id: 72, status: 'in_progress' }] });
      return Response.json({ message: 'unavailable' }, { status: 503 });
    }));
    const result = await GithubAutomationService.setMaintenanceWorkflowEnabled(false);
    expect(result).toMatchObject({ success: true, cancellationIncomplete: true, cancellationRequested: [] });
    expect(result.message).toContain('Não foi possível confirmar o cancelamento');
  });
});
