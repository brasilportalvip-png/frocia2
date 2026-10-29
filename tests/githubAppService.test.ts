import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubAppService } from '../server/services/githubAppService.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('GithubAppService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_SLUG;
  });

  it('aceita o estado assinado legado e o novo estado opaco sem aceitar uma URL como estado', () => {
    process.env.GITHUB_APP_SLUG = 'frocia-app';
    const payload = Buffer.from(JSON.stringify({ uid: 'u', nonce: 'n', exp: Date.now() + 600000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', 'test-secret').update(payload).digest('base64url');
    expect(GithubAppService.installationUrl(`${payload}.${signature}`)).toContain(encodeURIComponent(`${payload}.${signature}`));
    expect(GithubAppService.installationUrl('a'.repeat(43))).toContain('state=');
    expect(() => GithubAppService.installationUrl('https://attacker.example/')).toThrow();
  });

  it('carrega repositórios depois da primeira página de cem', async () => {
    vi.spyOn(GithubAppService, 'installationToken').mockResolvedValue({ token: 'test-installation', expiresAt: '', permissions: {} });
    const rows = Array.from({ length: 100 }, (_, id) => ({ id: id + 1, owner: { login: 'owner' }, name: 'repo-' + id }));
    const mock = vi.fn().mockResolvedValueOnce(Response.json({ total_count: 101, repositories: rows }))
      .mockResolvedValueOnce(Response.json({ total_count: 101, repositories: [{ id: 101, owner: { login: 'owner' }, name: 'last-repo' }] }));
    vi.stubGlobal('fetch', mock);
    expect((await GithubAppService.listInstallationRepositories(17))).toHaveLength(101);
    expect(String(mock.mock.calls[1][0])).toContain('page=2');
  });

  it('preserva metadados quando o App não pode ler Actions', async () => {
    vi.spyOn(GithubAppService, 'installationToken').mockResolvedValue({ token: 'test-installation', expiresAt: '', permissions: { contents: 'read' } });
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => String(url).includes('/actions/')
      ? Response.json({ message: 'Resource not accessible by integration' }, { status: 403 })
      : Response.json({ name: 'repo', items: [] })));
    const result = await GithubAppService.repositoryIntelligence({ owner: 'owner', repository: 'repo', installationId: 17 } as any);
    expect(result.repository).toMatchObject({ name: 'repo' });
    expect(result.workflows).toMatchObject({ unavailable: true });
    expect(result.limitations.some(value => value.includes('Workflows'))).toBe(true);
  });

  it('lista a árvore inteira e permite abrir o backend original na versão selecionada', async () => {
    const commitSha = 'a'.repeat(40), treeSha = 'b'.repeat(40);
    vi.spyOn(GithubAppService, 'installationToken').mockResolvedValue({ token: 'test-installation', expiresAt: '', permissions: { contents: 'read' } });
    const files = Array.from({ length: 100 }, (_, id) => ({ type: 'blob', path: id === 99 ? 'server/production/router.ts' : `src/file-${id}.ts`, sha: 'c'.repeat(40), size: 100 }));
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ sha: commitSha, commit: { tree: { sha: treeSha } } }))
      .mockResolvedValueOnce(Response.json({ tree: files, truncated: false }))
      .mockResolvedValueOnce(Response.json({ type: 'file', encoding: 'base64', sha: 'c'.repeat(40), size: 20, content: Buffer.from('export const backend = true;').toString('base64') }));
    vi.stubGlobal('fetch', fetch);
    const connection = { owner: 'owner', repository: 'repo', installationId: 17 } as any;
    const snapshot = await GithubAppService.sourceTree(connection);
    expect(snapshot.files).toHaveLength(100); expect(snapshot.contentsLoaded).toBe(false);
    expect(await GithubAppService.readSourceFile(connection, 'server/production/router.ts', commitSha)).toMatchObject({ content: 'export const backend = true;', commitSha });
    expect(String(fetch.mock.calls[2][0])).toContain(`ref=${commitSha}`);
    await expect(GithubAppService.readSourceFile(connection, '../.env', commitSha)).rejects.toMatchObject({ code: 'invalid_github_file' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('gera JWT RS256 de curta duração para autenticar o aplicativo', () => {
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = pem;
    process.env.GITHUB_APP_SLUG = 'frocia-app';
    const token = GithubAppService.createAppJwt(new Date('2026-09-17T10:00:00.000Z'));
    const [header, payload, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({ alg: 'RS256' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    expect(claims.exp - claims.iat).toBe(540);
    expect(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('usa token temporário da instalação e lista somente repositórios autorizados', async () => {
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = pem;
    process.env.GITHUB_APP_SLUG = 'frocia-app';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: 'installation-token', expires_at: '2026-09-17T11:00:00Z', permissions: { contents: 'read' },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        repositories: [{ id: 7, name: 'private-repo', private: true, default_branch: 'main', owner: { login: 'owner' } }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const repositories = await GithubAppService.listInstallationRepositories(77);
    expect(repositories).toEqual([{ id: 7, owner: 'owner', name: 'private-repo', private: true, defaultBranch: 'main' }]);
    const secondHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(secondHeaders.Authorization).toBe('Bearer installation-token');
  });

   it('bloqueia criação de branch sem confirmação humana', async () => {
    await expect(GithubAppService.createBranch({
      id: 'c', userId: 'u', tenantId: 't', projectId: 'p', installationId: 1,
      owner: 'owner', repository: 'repo', repositoryId: 1, permissions: { contents: 'write' },
      createdAt: '', updatedAt: '',
    }, 'a'.repeat(40), 'feature/test', false)).rejects.toMatchObject({ code: 'human_confirmation_required' });
  });

  it('descobre automaticamente a instalação autorizada para um repositório', async () => {
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = pem;
    process.env.GITHUB_APP_SLUG = 'frocia-app';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 5196868,
          account: {
            login: 'brasilportalvip-png'
          }
        }),
        { status: 200 }
      )
    );

    vi.stubGlobal('fetch', fetchMock);

    const installationId =
      await GithubAppService.findRepositoryInstallation(
        'brasilportalvip-png',
        'frocia2'
      );

    expect(installationId).toBe(5196868);

     expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(
      String(fetchMock.mock.calls[0][0])
    ).toContain(
      '/repos/brasilportalvip-png/frocia2/installation'
    );

    const headers =
      (fetchMock.mock.calls[0][1] as RequestInit)
        .headers as Record<string, string>;

    expect(headers.Authorization).toMatch(
      /^Bearer /
    );
  });

  it('retorna a identidade confirmada pelo GitHub para diagnosticar o App em uso', async () => {
    process.env.GITHUB_APP_ID = '12345'; process.env.GITHUB_APP_PRIVATE_KEY = pem; process.env.GITHUB_APP_SLUG = 'slug-antigo';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 77, app_id: 12345, app_slug: 'froc-ia-real',
      permissions: { actions: 'read' }, access_tokens_url: 'private-unused-field' })));
    expect(await GithubAppService.inspectRepositoryInstallation('owner', 'repo')).toEqual({
      installationId: 77, appId: 12345, appSlug: 'froc-ia-real',
    });
  });

  it('preserva o motivo de recusa da API sem devolver o JWT usado na chamada', async () => {
    process.env.GITHUB_APP_ID = '12345'; process.env.GITHUB_APP_PRIVATE_KEY = pem; process.env.GITHUB_APP_SLUG = 'froc-ia';
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => Response.json({
      message: `Resource not accessible by integration ${(init.headers as Record<string, string>).Authorization}`,
    }, { status: 403, headers: { 'X-GitHub-Request-Id': '1234:ABCD' } })));
    const error = await GithubAppService.inspectRepositoryInstallation('owner', 'repo').catch(value => value);
    expect(error).toMatchObject({ code: 'github_permission_denied', status: 403, diagnostic: { requestId: '1234:ABCD' } });
    expect(error.message).toContain('Resource not accessible by integration');
    expect(error.message).not.toContain('eyJ');
    expect(JSON.stringify(error)).not.toContain('BEGIN PRIVATE KEY');
  });
});
