import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService.js';
import { GithubAppService } from '../server/services/githubAppService.js';
import { PreviewDeploymentService } from '../server/selfEvolution/previewDeploymentService.js';
import { RollbackService } from '../server/selfEvolution/rollbackService.js';

describe('Acessos e retomada da manutencao autonoma', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token'); vi.stubEnv('GITHUB_OWNER', 'owner'); vi.stubEnv('GITHUB_REPO', 'site');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('aciona explicitamente o CI oficial na branch quando usa o token do Actions', async () => {
    const f = vi.fn(async (_url: unknown, _init: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);
    expect((await GithubAutomationService.dispatchOfficialCI('froc-evolution/r1/candidate')).success).toBe(true);
    expect(String(f.mock.calls[0][0])).toContain('/actions/workflows/ci.yml/dispatches');
    expect(JSON.parse(String(f.mock.calls[0][1].body))).toEqual({ ref: 'froc-evolution/r1/candidate' });
  });
  it('nao solicita CI de manutencao para uma branch arbitraria', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect((await GithubAutomationService.dispatchOfficialCI('main')).success).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('retoma um merge confirmado sem executar outro merge', async () => {
    const sha = 'a'.repeat(40); const merged = 'b'.repeat(40);
    const f = vi.fn(async () => Response.json({ state: 'closed', merged: true, head: { sha }, merge_commit_sha: merged }));
    vi.stubGlobal('fetch', f);
    expect(await GithubAutomationService.mergeApprovedPullRequest('https://github.com/owner/site/pull/1', sha))
      .toMatchObject({ success: true, mergeCommitSha: merged });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('um site com deployment em erro continua elegivel para ser reparado', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'test-vercel'); vi.stubEnv('VERCEL_PROJECT_ID', 'prj_site');
    const f = vi.fn(async () => Response.json({ deployments: [{ state: 'ERROR' }] }));
    vi.stubGlobal('fetch', f);
    expect((await PreviewDeploymentService.verifyProjectAccess()).status).toBe('ready');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('usa o GitHub App tambem para reversao, sem exigir um token estatico adicional', async () => {
    vi.stubEnv('GITHUB_TOKEN', ''); vi.stubEnv('GITHUB_APP_TOKEN', '');
    vi.stubEnv('AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED', 'true');
    vi.spyOn(GithubAppService, 'isConfigured').mockReturnValue(true);
    vi.spyOn(GithubAppService, 'findRepositoryInstallation').mockResolvedValue(123);
    vi.spyOn(GithubAppService, 'installationToken').mockResolvedValue({ token: 'test-installation-token' } as any);
    const f = vi.fn(async (_url: unknown, _options: RequestInit) => Response.json({}));
    f.mockResolvedValueOnce(Response.json({ node_id: 'PR_1', merge_commit_sha: 'a'.repeat(40), merged_at: '2026-10-23T12:00:00Z' }))
      .mockResolvedValueOnce(Response.json({ data: { revertPullRequest: { revertPullRequest: { url: 'https://github.com/owner/site/pull/2', number: 2, headRefOid: 'b'.repeat(40) } } } }))
      .mockResolvedValueOnce(Response.json({ merged: true }));
    vi.stubGlobal('fetch', f);
    expect((await RollbackService.executeRollback('candidate', 'Regressao comprovada', 1)).success).toBe(true);
    for (const [, options] of f.mock.calls) expect((options.headers as Record<string, string>).Authorization).toBe('Bearer test-installation-token');
  });
});
