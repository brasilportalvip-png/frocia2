import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService.js';
import { GithubAppService } from '../server/services/githubAppService.js';
const id = 'validation-' + 'a'.repeat(32);
describe('recibo de validação separado da manutenção', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', ''); vi.stubEnv('GITHUB_APP_TOKEN', ''); vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');
    vi.stubEnv('GITHUB_OWNER', 'brasilportalvip-png'); vi.stubEnv('GITHUB_REPO', 'frocia2'); vi.stubEnv('GITHUB_BASE_BRANCH', 'main');
    vi.spyOn(GithubAppService, 'isConfigured').mockReturnValue(true);
    vi.spyOn(GithubAppService, 'inspectRepositoryInstallation').mockResolvedValue({ installationId: 123 });
    vi.spyOn(GithubAppService, 'installationToken').mockResolvedValue({ token: 'test-private-token', expiresAt: '', permissions: { actions: 'write' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('dispara somente workflow fixo e não diz que concluiu a homologação', async () => {
    const result = await GithubAutomationService.agentValidationRun(id, true);
    expect(result).toMatchObject({ status: 'dispatch_accepted', httpStatus: 204 });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/agent-validation.yml/dispatches'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { request_id: id } }) }));
    expect(JSON.stringify(result)).not.toContain('test-private-token');
  });
  it('não dispara com Actions:read nem identificador inválido', async () => {
    vi.mocked(GithubAppService.installationToken).mockResolvedValue({ token: 'test-private-token', expiresAt: '', permissions: { actions: 'read' } });
    expect(await GithubAutomationService.agentValidationRun(id, true)).toMatchObject({ status: 'blocked' });
    expect(await GithubAutomationService.agentValidationRun('../unsafe', true)).toMatchObject({ status: 'blocked' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('não substitui 403 por sucesso', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ message: 'Resource not accessible by integration' }, { status: 403 }));
    expect(await GithubAutomationService.agentValidationRun(id, true)).toMatchObject({ status: 'blocked', message: expect.stringContaining('403') });
  });
  it('consulta a rodada pelo recibo exato e conserva falha e SHA', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ workflow_runs: [
      { id: 99, display_title: 'other', status: 'completed', conclusion: 'success' },
      { id: 42, display_title: id, status: 'completed', conclusion: 'failure', head_sha: 'b'.repeat(40), html_url: 'https://github.com/brasilportalvip-png/frocia2/actions/runs/42' },
    ] }));
    expect(await GithubAutomationService.agentValidationRun(id)).toMatchObject({ runId: 42, status: 'completed', conclusion: 'failure', commitSha: 'b'.repeat(40) });
  });
});
