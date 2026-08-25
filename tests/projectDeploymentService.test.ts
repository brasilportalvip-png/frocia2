import fs from 'node:fs';
import path from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  DeploymentProviderError,
  ProjectDeploymentService,
  validateDeploymentFiles,
} from '../server/services/projectDeploymentService.js';

const BASE_COMMIT_SHA = 'a'.repeat(40);
const BASE_TREE_SHA = 'b'.repeat(40);
const BLOB_SHA = 'c'.repeat(40);
const CREATED_TREE_SHA = 'd'.repeat(40);
const CREATED_COMMIT_SHA = 'e'.repeat(40);

function mockJsonResponse(
  body: unknown,
  status = 200
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(
      JSON.stringify(body)
    ),
    headers: new Headers({
      'content-type': 'application/json',
    }),
  } as unknown as Response;
}

function mockHtmlResponse(
  html: string,
  status = 200,
  contentType = 'text/html; charset=utf-8'
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(html),
    headers: new Headers({
      'content-type': contentType,
    }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Project deployment integrity', () => {
  it('blocks traversal, duplicate paths and secret files', () => {
    expect(() =>
      validateDeploymentFiles([
        {
          path: '../outside.txt',
          content: 'blocked',
        },
      ])
    ).toThrow(DeploymentProviderError);

    expect(() =>
      validateDeploymentFiles([
        {
          path: '.env',
          content: 'SECRET=value',
        },
      ])
    ).toThrow(/sensível/);

    expect(() =>
      validateDeploymentFiles([
        {
          path: '.env.production',
          content: 'SECRET=value',
        },
      ])
    ).toThrow(/sensível/);

    expect(() =>
      validateDeploymentFiles([
        { path: 'index.html', content: 'one' },
        { path: 'index.html', content: 'two' },
      ])
    ).toThrow(/mais de uma vez/);
  });

  it('creates and verifies a real GitHub commit before reporting success', async () => {
    const fetchMock = vi
      .fn()
      // Repository exists and is already bound by the route.
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: 123,
          full_name: 'test-owner/test-site',
          html_url:
            'https://github.com/test-owner/test-site',
          default_branch: 'main',
        })
      )
      // Requested branch.
      .mockResolvedValueOnce(
        mockJsonResponse({
          object: { sha: BASE_COMMIT_SHA },
        })
      )
      // Base commit.
      .mockResolvedValueOnce(
        mockJsonResponse({
          sha: BASE_COMMIT_SHA,
          tree: { sha: BASE_TREE_SHA },
        })
      )
      // File blob.
      .mockResolvedValueOnce(
        mockJsonResponse({ sha: BLOB_SHA }, 201)
      )
      // New tree.
      .mockResolvedValueOnce(
        mockJsonResponse(
          { sha: CREATED_TREE_SHA },
          201
        )
      )
      // New commit.
      .mockResolvedValueOnce(
        mockJsonResponse(
          {
            sha: CREATED_COMMIT_SHA,
            html_url:
              `https://github.com/test-owner/test-site/commit/${CREATED_COMMIT_SHA}`,
          },
          201
        )
      )
      // Fast-forward branch update.
      .mockResolvedValueOnce(
        mockJsonResponse(
          {
            ref: 'refs/heads/froc-publish',
            object: { sha: CREATED_COMMIT_SHA },
          },
          200
        )
      )
      // Commit verification.
      .mockResolvedValueOnce(
        mockJsonResponse({
          sha: CREATED_COMMIT_SHA,
          tree: { sha: CREATED_TREE_SHA },
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    const result =
      await ProjectDeploymentService
        .publishToGitHub({
          token: 'test-token',
          owner: 'test-owner',
          repoName: 'test-site',
          isPrivate: false,
          branch: 'froc-publish',
          message: 'feat: publish verified site',
          files: [
            {
              path: 'index.html',
              content: '<!doctype html><html></html>',
            },
          ],
          allowExistingRepository: true,
        });

    expect(result.verified).toBe(true);
    expect(result.commitSha).toBe(
      CREATED_COMMIT_SHA
    );
    expect(fetchMock).toHaveBeenCalledTimes(8);

    const commitRequest =
      fetchMock.mock.calls[5][1] as RequestInit;
    const commitBody = JSON.parse(
      String(commitRequest.body)
    );

    expect(commitBody.parents).toEqual([
      BASE_COMMIT_SHA,
    ]);
    expect(commitBody.tree).toBe(
      CREATED_TREE_SHA
    );

    const branchRequest =
      fetchMock.mock.calls[6][1] as RequestInit;
    const branchBody = JSON.parse(
      String(branchRequest.body)
    );

    expect(branchBody.sha).toBe(
      CREATED_COMMIT_SHA
    );
    expect(branchBody.force).toBe(false);
  });

  it('does not let an unbound project overwrite an existing repository', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        id: 123,
        full_name: 'test-owner/existing-site',
        html_url:
          'https://github.com/test-owner/existing-site',
        default_branch: 'main',
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      ProjectDeploymentService.publishToGitHub({
        token: 'test-token',
        owner: 'test-owner',
        repoName: 'existing-site',
        isPrivate: false,
        branch: 'froc-publish',
        message: 'feat: publish',
        files: [
          {
            path: 'index.html',
            content: '<html></html>',
          },
        ],
        allowExistingRepository: false,
      })
    ).rejects.toMatchObject({
      code: 'github_repository_not_bound',
      httpStatus: 409,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a valid Git source to Vercel and reports QUEUED as pending', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse(
        {
          id: 'dpl_test123',
          projectId: 'prj_test123',
          url: 'test-site-abc.vercel.app',
          readyState: 'QUEUED',
        },
        200
      )
    );

    vi.stubGlobal('fetch', fetchMock);

    const result =
      await ProjectDeploymentService
        .createVercelDeployment({
          token: 'vercel-test-token',
          projectName: 'test-site',
          repoOwner: 'test-owner',
          repoName: 'test-site',
          repoId: 123,
          branch: 'froc-publish',
          commitSha: CREATED_COMMIT_SHA,
        });

    expect(result.status).toBe('pending');
    expect(result.providerState).toBe('QUEUED');
    expect(result.vercelProjectId).toBe(
      'prj_test123'
    );

    const request =
      fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(
      String(request.body)
    );

    expect(body.gitSource).toEqual({
      type: 'github',
      repoId: 123,
      ref: 'froc-publish',
      sha: CREATED_COMMIT_SHA,
    });
    expect(body.target).toBe('production');
  });

  it('does not trust an immediate Vercel READY state before the smoke test', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse(
          {
            id: 'dpl_ready_without_smoke',
            url: 'site.vercel.app',
            readyState: 'READY',
          },
          201
        )
      )
    );

    const result =
      await ProjectDeploymentService
        .createVercelDeployment({
          token: 'vercel-token',
          projectName: 'site-test',
          repoOwner: 'test-owner',
          repoName: 'test-site',
          repoId: 123,
          branch: 'froc-publish',
          commitSha: CREATED_COMMIT_SHA,
        });

    expect(result.providerState).toBe('READY');
    expect(result.status).toBe('pending');
  });

  it('only marks Vercel READY after a successful HTML smoke test', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: 'dpl_ready123',
          url: 'test-site-abc.vercel.app',
          readyState: 'READY',
        })
      )
      .mockResolvedValueOnce(
        mockHtmlResponse(
          '<!doctype html><html><body>OK</body></html>'
        )
      );

    vi.stubGlobal('fetch', fetchMock);

    const status =
      await ProjectDeploymentService
        .getVercelDeploymentStatus(
          'vercel-test-token',
          'dpl_ready123'
        );

    expect(status.status).toBe('ready');
    expect(status.smokeTestPassed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects false READY when the public URL is not HTML', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: 'dpl_invalid123',
          url: 'test-site-abc.vercel.app',
          readyState: 'READY',
        })
      )
      .mockResolvedValueOnce(
        mockHtmlResponse(
          '{"status":"ok"}',
          200,
          'application/json'
        )
      );

    vi.stubGlobal('fetch', fetchMock);

    const status =
      await ProjectDeploymentService
        .getVercelDeploymentStatus(
          'vercel-test-token',
          'dpl_invalid123'
        );

    expect(status.status).toBe('failed');
    expect(status.smokeTestPassed).toBe(false);
  });

  it('uses the current Vercel rollback endpoint and requires HTTP 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({}, 201)
    );

    vi.stubGlobal('fetch', fetchMock);

    await ProjectDeploymentService
      .rollbackVercelDeployment(
        'vercel-test-token',
        'prj_test123',
        'dpl_ready123',
        'Rollback de segurança validado'
      );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/v1/projects/prj_test123/rollback/dpl_ready123?'
      ),
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('keeps fake success markers out of the production route', () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'server/routes/deployRoutes.ts'
      ),
      'utf8'
    );

    expect(source).not.toContain(
      'commitSha: `sha-${Date.now()}`'
    );
    expect(source).not.toContain(
      'Deploy na Vercel iniciado e concluído.'
    );
    expect(source).toContain(
      '/vercel/:deploymentId/status'
    );
    expect(source).toContain(
      'smokeTestPassed !== true'
    );
  });
});
