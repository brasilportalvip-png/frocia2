import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService.js';
import { GithubAppService } from '../server/services/githubAppService.js';

const SHA = 'e'.repeat(40);
const MERGE_SHA = 'f'.repeat(40);
const keys = ['GITHUB_TOKEN', 'GITHUB_APP_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'] as const;
const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]])) as
  Record<(typeof keys)[number], string | undefined>;

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function prepareGitHubApp() {
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_APP_TOKEN;
  process.env.GITHUB_OWNER = 'test-owner';
  process.env.GITHUB_REPO = 'test-repo';

  vi.spyOn(GithubAppService, 'isConfigured').mockReturnValue(true);
  const findInstallation = vi.spyOn(GithubAppService, 'findRepositoryInstallation')
    .mockResolvedValue(12345);
  const getInstallationToken = vi.spyOn(GithubAppService, 'installationToken')
    .mockResolvedValue({ token: 'temporary-installation-token' } as
      Awaited<ReturnType<typeof GithubAppService.installationToken>>);

  return { findInstallation, getInstallationToken };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of keys) {
    const value = originals[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Merge pelo GitHub App sem token estatico', () => {
  it('usa credencial temporaria, confere SHA e envia merge somente na simulacao', async () => {
    const { findInstallation, getInstallationToken } = prepareGitHubApp();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ state: 'open', draft: false, head: { sha: SHA } }))
      .mockResolvedValueOnce(response({ merged: true, sha: MERGE_SHA }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await GithubAutomationService.mergeApprovedPullRequest(
      'https://github.com/test-owner/test-repo/pull/42', SHA
    );

    expect(result).toMatchObject({ success: true, mergeCommitSha: MERGE_SHA });
    expect(findInstallation).toHaveBeenCalledWith('test-owner', 'test-repo');
    expect(getInstallationToken).toHaveBeenCalledWith(12345);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchMock.mock.calls) {
      const headers = (options as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer temporary-installation-token');
    }
    expect(String(fetchMock.mock.calls[1][0])).toContain('/pulls/42/merge');
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('PUT');
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(body.sha).toBe(SHA);
  });

  it('bloqueia merge caso o SHA do PR tenha mudado', async () => {
    prepareGitHubApp();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      response({ state: 'open', draft: false, head: { sha: '0'.repeat(40) } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await GithubAutomationService.mergeApprovedPullRequest(
      'https://github.com/test-owner/test-repo/pull/42', SHA
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('mudou depois da aprovação');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
