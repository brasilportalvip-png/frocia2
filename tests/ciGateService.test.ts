import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CIGateService } from '../server/selfEvolution/ciGateService.js';
import { GithubAppService } from '../server/services/githubAppService.js';
const sha = 'a'.repeat(40);
const run = (extra = {}) => ({ id: 10, path: '.github/workflows/ci.yml', head_sha: sha, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', ...extra });
function api(runs = [run()], jobs = [{ name: 'Build & Verify', status: 'completed', conclusion: 'success' }], count = jobs.length) {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => url.includes('/jobs?') ? Response.json({ jobs, total_count: count }) : Response.json({ workflow_runs: runs }));
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
describe('CI Gate do workflow oficial e SHA imutável', () => {
  beforeEach(() => { vi.stubEnv('GITHUB_TOKEN', 'test-token'); vi.stubEnv('GITHUB_APP_TOKEN', ''); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('aprova apenas a execução oficial com o job obrigatório aprovado', async () => {
    const f = api(); expect(await CIGateService.runCIGate(sha)).toMatchObject({ status: 'success', passed: true });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('ignora um workflow diferente com o mesmo nome de job', async () => {
    api([run({ path: '.github/workflows/untrusted.yml' })]);
    expect((await CIGateService.runCIGate(sha)).passed).toBe(false);
  });
  it('não aceita sucesso antigo quando a execução oficial mais recente falhou', async () => {
    api([run(), run({ id: 11, conclusion: 'failure' })]);
    expect(await CIGateService.runCIGate(sha)).toMatchObject({ status: 'failed', passed: false });
  });
  it('rejeita jobs contraditórios na execução oficial em vez de deixar sucesso ocultar falha', async () => {
    api([run()], [{ name: 'Build & Verify', status: 'completed', conclusion: 'success' }, { name: 'Build & Verify', status: 'completed', conclusion: 'failure' }]);
    expect(await CIGateService.runCIGate(sha)).toMatchObject({ status: 'failed', passed: false });
  });
  it('mantém espera quando a execução nova está pendente', async () => {
    api([run(), run({ id: 11, status: 'in_progress', conclusion: null })]);
    expect((await CIGateService.runCIGate(sha)).status).toBe('pending');
  });
  it('dispatch oficial aprovado resolve a execução do bot sem fingir aprovação do PR', async () => {
    api([run({ id: 11, event: 'pull_request', conclusion: 'action_required' }), run()]);
    expect((await CIGateService.runCIGate(sha)).passed).toBe(true);
    api([run({ conclusion: 'action_required' })]);
    expect(await CIGateService.runCIGate(sha)).toMatchObject({ status: 'pending', details: expect.stringContaining('aprovação') });
  });
  it('recusa outro SHA e paginação de jobs incompleta', async () => {
    api([run({ head_sha: 'b'.repeat(40) })]); expect((await CIGateService.runCIGate(sha)).passed).toBe(false);
    api([run()], [{ name: 'Build & Verify', status: 'completed', conclusion: 'success' }], 2);
    expect((await CIGateService.runCIGate(sha)).status).toBe('pending');
  });
  it('recusa branch mutável sem consultar rede', async () => {
    const f = api(); expect((await CIGateService.runCIGate('main')).passed).toBe(false); expect(f).not.toHaveBeenCalled();
  });
  it('usa token temporário do GitHub App quando não existe token fixo', async () => {
    vi.stubEnv('GITHUB_TOKEN', ''); vi.spyOn(GithubAppService, 'isConfigured').mockReturnValue(true);
    vi.spyOn(GithubAppService, 'findRepositoryInstallation').mockResolvedValue(77);
    vi.spyOn(GithubAppService, 'installationToken').mockResolvedValue({ token: 'temporary-installation-token', expiresAt: '', permissions: { actions: 'read' } });
    const f = api(); expect((await CIGateService.runCIGate(sha)).passed).toBe(true);
    expect(f.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer temporary-installation-token' } });
  });
});
