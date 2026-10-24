import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService.js';
import { GithubAppService } from '../server/services/githubAppService.js';
import { formatSelfSiteControlReceipt } from '../server/ai/selfSiteChatControlService.js';
const now = new Date('2026-10-24T01:40:00Z');
const row = (sha = 'a'.repeat(40), date = '2026-10-23T23:30:00Z') => ({ sha,
  commit: { message: 'feat: memoria extensa\n\nDescricao', committer: { date } } });
describe('Leitura real das mudancas do proprio repositorio', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_OWNER', 'brasilportalvip-png'); vi.stubEnv('GITHUB_REPO', 'frocia2');
    vi.stubEnv('GITHUB_BASE_BRANCH', 'main'); vi.stubEnv('GITHUB_TOKEN', 'private-owner-token');
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it('consulta o dia de Brasilia via GET autenticado e devolve apenas os commits daquele intervalo', async () => {
    const f = vi.fn(async () => Response.json([row(), row('b'.repeat(40), '2026-10-23T02:59:59Z')]));
    vi.stubGlobal('fetch', f);
    const result = await GithubAutomationService.readRecentRepositoryChanges('Veja as melhorias de hoje para voce', now);
    expect(result).toMatchObject({ status: 'checked', period: '2026-10-23 (America/Sao_Paulo)', since: '2026-10-23T03:00:00.000Z',
      until: now.toISOString(), commits: [{ sha: 'a'.repeat(40), title: 'feat: memoria extensa', url: `https://github.com/brasilportalvip-png/frocia2/commit/${'a'.repeat(40)}` }] });
    const request = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(request[0])).toContain('/commits?');
    expect(new URL(String(request[0])).searchParams.get('since')).toBe('2026-10-23T03:00:00.000Z');
    expect(request[1].method).toBeUndefined();
    expect(request[1].headers).toMatchObject({ Authorization: 'Bearer private-owner-token' });
    expect(JSON.stringify(result)).not.toContain('private-owner-token');
  });
  it('usa um token temporario do App quando a Vercel esta configurada dessa forma', async () => {
    vi.stubEnv('GITHUB_TOKEN', ''); vi.stubEnv('GITHUB_APP_TOKEN', '');
    vi.spyOn(GithubAppService, 'inspectRepositoryInstallation').mockResolvedValue({ installationId: 168130604, appId: 5196868, appSlug: 'froc-ia' });
    vi.spyOn(GithubAppService, 'installationToken').mockResolvedValue({ token: 'temporary-private-token', expiresAt: '', permissions: { contents: 'write' } });
    const f = vi.fn(async (_url: unknown, _init: RequestInit) => Response.json([row()])); vi.stubGlobal('fetch', f);
    expect((await GithubAutomationService.readRecentRepositoryChanges('Veja as melhorias de hoje para voce', now)).status).toBe('checked');
    expect(f.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer temporary-private-token' });
  });
  it('declara a cobertura parcial ao atingir duas paginas, sem seguir um link para outro dominio', async () => {
    const f = vi.fn(async () => Response.json([row()], { headers: { link: '<https://evil.invalid/steal>; rel="next"' } }));
    vi.stubGlobal('fetch', f);
    const result = await GithubAutomationService.readRecentRepositoryChanges('Veja as melhorias de hoje para voce', now);
    expect(result.complete).toBe(false); expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls.every(call => String((call as any)[0]).startsWith('https://api.github.com/repos/brasilportalvip-png/frocia2/commits?'))).toBe(true);
    expect(formatSelfSiteControlReceipt({ repositoryChanges: result })).toContain('parcial');
  });
  it('retorna o motivo da falha em vez de inventar melhorias ou negar genericamente o acesso', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'Resource not accessible by integration private-owner-token' }, { status: 403 })));
    const report = await GithubAutomationService.readRecentRepositoryChanges('Veja as melhorias de hoje para voce', now);
    const text = formatSelfSiteControlReceipt({ repositoryChanges: report });
    expect(report.status).toBe('unavailable'); expect(text).toContain('HTTP 403');
    expect(text).not.toContain('private-owner-token'); expect(text).not.toContain('fontes atuais verificaveis');
  });
});
