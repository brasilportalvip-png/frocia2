import { afterEach, describe, expect, it, vi } from 'vitest';
import { CIGateService } from '../server/selfEvolution/ciGateService.js';
import { GithubAppService } from '../server/services/githubAppService.js';
describe('CI Gate', () => {
   afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_APP_TOKEN;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_SLUG;
  });

  it('aceita o job agregado oficial somente quando o GitHub Actions o concluiu', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      check_runs: [{
        name: 'Build & Verify', status: 'completed', conclusion: 'success',
        app: { slug: 'github-actions', name: 'GitHub Actions' },
      }],
    }), { status: 200 })));

    const result = await CIGateService.runCIGate('a'.repeat(40));
    expect(result).toMatchObject({
      status: 'success', passed: true, typecheckPassed: true,
      unitTestsPassed: true, securityAuditPassed: true,
    });
  });

  it('não confia em check de aplicativo desconhecido com o mesmo nome', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      check_runs: [{
        name: 'Build & Verify', status: 'completed', conclusion: 'success',
        app: { slug: 'untrusted-app', name: 'Untrusted' },
      }],
    }), { status: 200 })));

    const result = await CIGateService.runCIGate('b'.repeat(40));
    expect(result.passed).toBe(false);
  });

    it('rejeita branch mutável e exige SHA', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await CIGateService.runCIGate('main');
    expect(result.status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('usa token temporário do GitHub App quando não existe token fixo', async () => {
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = 'configured';
    process.env.GITHUB_APP_SLUG = 'froc-ia';

    vi.spyOn(
      GithubAppService,
      'findRepositoryInstallation'
    ).mockResolvedValue(77);

    vi.spyOn(
      GithubAppService,
      'installationToken'
    ).mockResolvedValue({
      token: 'temporary-installation-token',
      expiresAt: '2026-10-05T12:00:00Z',
      permissions: {
        actions: 'read',
        contents: 'write',
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          check_runs: [{
            name: 'Build & Verify',
            status: 'completed',
            conclusion: 'success',
            app: {
              slug: 'github-actions',
              name: 'GitHub Actions',
            },
          }],
        }),
        { status: 200 }
      )
    );

    vi.stubGlobal('fetch', fetchMock);

    const result =
      await CIGateService.runCIGate(
        'c'.repeat(40)
      );

    expect(result.passed).toBe(true);

    expect(
      GithubAppService.findRepositoryInstallation
    ).toHaveBeenCalledWith(
      'brasilportalvip-png',
      'frocia2'
    );

    const headers =
      (fetchMock.mock.calls[0][1] as RequestInit)
        .headers as Record<string, string>;

    expect(headers.Authorization).toBe(
      'Bearer temporary-installation-token'
    );
  });
});
