import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubAppService } from '../server/services/githubAppService.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('GithubAppService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_SLUG;
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
});
