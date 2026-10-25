import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
import {
  GithubAutomationService
} from '../server/selfEvolution/githubAutomationService.js';
import type {
  PatchResult
} from '../server/selfEvolution/codeAgentService.js';
import type {
  ImprovementCandidate
} from '../server/selfEvolution/selfEvolutionTypes.js';
import { REQUIRED_ENGINEERING_COMMANDS } from '../server/selfEvolution/engineeringSandboxEvidenceService.js';

const BASE_COMMIT_SHA = 'a'.repeat(40);
const BASE_TREE_SHA = 'b'.repeat(40);
const BLOB_SHA = 'c'.repeat(40);
const EMPTY_GIT_BLOB_SHA = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const CREATED_TREE_SHA = 'd'.repeat(40);
const CREATED_COMMIT_SHA = 'e'.repeat(40);

const candidate: ImprovementCandidate = {
  id: 'candidate-test-123',
  title: 'Corrigir botão principal',
  summary:
    'Corrige o comportamento do botão principal.',
  evidence: [
    'O botão não responde ao clique.'
  ],
  frequency: 1,
  affectedUsersCount: 1,
  severity: 'medium',
  confidence: 0.95,
  affectedComponents: [
    'MainButton'
  ],
  probableFiles: [
    'src/components/MainButton.tsx'
  ],
  hypothesis:
    'O evento de clique não está conectado.',
  expectedBehavior:
    'O botão deve responder ao clique.',
  riskLevel: 'R1',
  estimatedCostCredits: 10,
  testPlan:
    'Executar typecheck e teste do componente.',
  rollbackStrategy:
    'Reverter o Pull Request.',
  duplicates: [],
  requiresApproval: false,
  state: 'patch_created',
  createdAt:
    '2026-08-12T00:00:00.000Z',
  updatedAt:
    '2026-08-12T00:00:00.000Z'
};

const patch: PatchResult = {
  status: 'success',
  success: true,
  filesModified: [
    'src/components/MainButton.tsx'
  ],
  files: [
    {
      path:
        'src/components/MainButton.tsx',
      content:
        'export const MainButton = () => null;'
    }
  ],
  linesAdded: 1,
  linesRemoved: 0,
  commitMessage:
    'fix: corrigir botão principal',
  baseSha: BASE_COMMIT_SHA,
  executionEvidence: {
    schemaVersion: 'engineering-sandbox-v1',
    candidateId: candidate.id,
    requestNonce: '1'.repeat(48),
    sandboxId: 'sandbox:github-test',
    baseSha: BASE_COMMIT_SHA,
    networkPolicy: 'restricted',
    workspaceBeforeSha256: '2'.repeat(64),
    workspaceAfterSha256: '3'.repeat(64),
    diffSha256: '4'.repeat(64),
    rollbackVerified: true,
    issuedAt: '2026-08-12T00:00:00.000Z',
    commands: REQUIRED_ENGINEERING_COMMANDS.map((id) => ({
      id,
      command: id === 'install' ? 'npm ci'
        : id === 'typecheck' ? 'npm run typecheck'
          : id === 'lint' ? 'npm run lint'
          : id === 'test' ? 'npm test'
            : id === 'e2e' ? 'npm run test:e2e'
              : id === 'security-audit' ? 'npm audit --omit=dev --audit-level=moderate'
            : id === 'production-integrity' ? 'npm run validate:production-integrity'
              : id === 'build' ? 'npm run build' : 'git diff --check',
      exitCode: 0,
      startedAt: '2026-08-12T00:00:00.000Z',
      completedAt: '2026-08-12T00:00:01.000Z',
      durationMs: 1000,
      stdoutSha256: '5'.repeat(64),
      stderrSha256: '6'.repeat(64),
    })),
  }
};

function mockResponse(
  body: unknown,
  status = 200
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response;
}

const previousEnvironment = {
  token: process.env.GITHUB_TOKEN,
  appToken: process.env.GITHUB_APP_TOKEN,
  owner: process.env.GITHUB_OWNER,
  repo: process.env.GITHUB_REPO,
  baseBranch:
    process.env.GITHUB_BASE_BRANCH
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();

  const restore = (
    key: string,
    value: string | undefined
  ) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

  restore(
    'GITHUB_TOKEN',
    previousEnvironment.token
  );
  restore(
    'GITHUB_APP_TOKEN',
    previousEnvironment.appToken
  );
  restore(
    'GITHUB_OWNER',
    previousEnvironment.owner
  );
  restore(
    'GITHUB_REPO',
    previousEnvironment.repo
  );
  restore(
    'GITHUB_BASE_BRANCH',
    previousEnvironment.baseBranch
  );
});

describe(
  'GitHub Automation with real commit',
  () => {
    it('não cria commit ou PR quando a árvore resultante é igual à base', async () => {
      process.env.GITHUB_TOKEN = 'test-token'; process.env.GITHUB_OWNER = 'test-owner'; process.env.GITHUB_REPO = 'test-repo'; process.env.GITHUB_BASE_BRANCH = 'main';
      const fetchMock = vi.fn().mockResolvedValueOnce(mockResponse([]))
        .mockResolvedValueOnce(mockResponse({ object: { sha: BASE_COMMIT_SHA } }))
        .mockResolvedValueOnce(mockResponse({ tree: { sha: BASE_TREE_SHA } }))
        .mockResolvedValueOnce(mockResponse({ sha: BLOB_SHA }))
        .mockResolvedValueOnce(mockResponse({ sha: BASE_TREE_SHA }));
      vi.stubGlobal('fetch', fetchMock);
      expect(await GithubAutomationService.createBranchAndPR(candidate, patch)).toMatchObject({ success: false, noChanges: true });
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith('/git/commits') || String(call[0]).endsWith('/pulls') && call[1]?.method === 'POST')).toBe(false);
    });
    it('registra o motivo real do HTTP 403 ao criar PR, sem expor o token do executor', async () => {
      process.env.GITHUB_TOKEN = 'executor-private-token';
      process.env.GITHUB_OWNER = 'test-owner'; process.env.GITHUB_REPO = 'test-repo'; process.env.GITHUB_BASE_BRANCH = 'main';
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockResponse([]))
        .mockResolvedValueOnce(mockResponse({ object: { sha: BASE_COMMIT_SHA } }))
        .mockResolvedValueOnce(mockResponse({ sha: BASE_COMMIT_SHA, tree: { sha: BASE_TREE_SHA } }))
        .mockResolvedValueOnce(mockResponse({ sha: BLOB_SHA }))
        .mockResolvedValueOnce(mockResponse({ sha: CREATED_TREE_SHA }))
        .mockResolvedValueOnce(mockResponse({ sha: CREATED_COMMIT_SHA }))
        .mockResolvedValueOnce(mockResponse({}, 201))
        .mockResolvedValueOnce(Response.json({ message: 'GitHub Actions is not permitted to create or approve pull requests. executor-private-token' }, {
          status: 403, headers: { 'X-GitHub-Request-Id': 'ABCD:1234', 'X-Accepted-GitHub-Permissions': 'pull_requests=write' },
        }));
      vi.stubGlobal('fetch', fetchMock);
      const result = await GithubAutomationService.createBranchAndPR(candidate, patch);
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('GitHub Actions is not permitted to create or approve pull requests');
      expect(result.errorMessage).toContain('pull_requests=write');
      expect(result.errorMessage).toContain('ABCD:1234');
      expect(result.errorMessage).not.toContain('executor-private-token');
    });

    it('diagnostica acesso negado antes da geracao paga de um patch', async () => {
      process.env.GITHUB_TOKEN = 'test-token';
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
      const result = await GithubAutomationService.verifyRepositoryAccess();
      expect(result.success).toBe(false);
      expect(result.message).toContain('HTTP 403');
      expect(result.message).not.toContain('test-token');
    });

    it('nao confunde permissions.push falso do GITHUB_TOKEN com recusa real de escrita', async () => {
      process.env.GITHUB_TOKEN = 'test-token';
      const fetchMock = vi.fn(async (_input: unknown, _init: RequestInit) => mockResponse({ sha: EMPTY_GIT_BLOB_SHA }, 201));
      fetchMock.mockResolvedValueOnce(mockResponse({ permissions: { push: false } }));
      vi.stubGlobal('fetch', fetchMock);
      const result = await GithubAutomationService.verifyRepositoryAccess();
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/brasilportalvip-png/frocia2/git/blobs');
      expect(fetchMock.mock.calls[1][1].method).toBe('POST');
      expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({ content: '', encoding: 'utf-8' });
      expect(result.message).not.toContain('test-token');
    });

    it('prova escrita sem alterar referencias nem devolver a credencial', async () => {
      process.env.GITHUB_TOKEN = 'test-token';
      const fetchMock = vi.fn(async (_input: unknown, _init: RequestInit) => mockResponse({ sha: EMPTY_GIT_BLOB_SHA }, 201));
      fetchMock.mockResolvedValueOnce(mockResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const result = await GithubAutomationService.verifyRepositoryAccess();
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
      expect(fetchMock.mock.calls.every(([url]) => !/\/git\/refs|\/git\/commits|\/pulls|\/contents\//.test(String(url)))).toBe(true);
      expect(JSON.stringify(result)).not.toContain('test-token');
    });

    it.each([401, 403, 404, 409, 422, 503])('recusa HTTP %s de escrita mesmo com metadata.push true', async (status) => {
      process.env.GITHUB_TOKEN = 'test-token';
      const fetchMock = vi.fn(async () => mockResponse({}, status));
      fetchMock.mockResolvedValueOnce(mockResponse({ permissions: { push: true } }));
      vi.stubGlobal('fetch', fetchMock);
      const result = await GithubAutomationService.verifyRepositoryAccess();
      expect(result.success).toBe(false);
      expect(result.message).toContain(`HTTP ${status}`);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('nao aceita uma resposta de escrita sem o objeto esperado', async () => {
      process.env.GITHUB_TOKEN = 'test-token';
      const fetchMock = vi.fn(async () => mockResponse({ sha: 'a'.repeat(40) }, 201));
      fetchMock.mockResolvedValueOnce(mockResponse({ permissions: { push: true } }));
      vi.stubGlobal('fetch', fetchMock);
      const result = await GithubAutomationService.verifyRepositoryAccess();
      expect(result.success).toBe(false);
      expect(result.message).toContain('nao foi comprovada');
    });

    it(
      'rejects creation when no generated patch is supplied',
      async () => {
        process.env.GITHUB_TOKEN =
          'test-token';

        const fetchMock = vi.fn();
        vi.stubGlobal(
          'fetch',
          fetchMock
        );

        const result =
          await GithubAutomationService
            .createBranchAndPR(
              candidate
            );

        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain(
          'Nenhum patch válido'
        );
        expect(fetchMock).not
          .toHaveBeenCalled();
      }
    );

    it('rejeita patch sem atestado verificável antes de acessar o GitHub', async () => {
      process.env.GITHUB_TOKEN = 'test-token';
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await GithubAutomationService.createBranchAndPR(
        candidate,
        { ...patch, executionEvidence: undefined }
      );
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('atestado');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it(
      'creates branch from the new commit instead of the main SHA',
      async () => {
        process.env.GITHUB_TOKEN =
          'test-token';
        delete process.env
          .GITHUB_APP_TOKEN;
        process.env.GITHUB_OWNER =
          'test-owner';
        process.env.GITHUB_REPO =
          'test-repo';
        process.env.GITHUB_BASE_BRANCH =
          'main';

        const fetchMock = vi
          .fn()
          // Existing Pull Requests
          .mockResolvedValueOnce(
            mockResponse([])
          )
          // Base branch reference
          .mockResolvedValueOnce(
            mockResponse({
              object: {
                sha: BASE_COMMIT_SHA
              }
            })
          )
          // Base commit and tree
          .mockResolvedValueOnce(
            mockResponse({
              sha: BASE_COMMIT_SHA,
              tree: {
                sha: BASE_TREE_SHA
              }
            })
          )
          // File blob
          .mockResolvedValueOnce(
            mockResponse({
              sha: BLOB_SHA
            })
          )
          // New tree
          .mockResolvedValueOnce(
            mockResponse({
              sha: CREATED_TREE_SHA
            })
          )
          // New commit
          .mockResolvedValueOnce(
            mockResponse({
              sha: CREATED_COMMIT_SHA
            })
          )
          // New branch reference
          .mockResolvedValueOnce(
            mockResponse({
              ref:
                'refs/heads/froc-evolution/test'
            }, 201)
          )
          // Pull Request
          .mockResolvedValueOnce(
            mockResponse({
              html_url:
                'https://github.com/test-owner/test-repo/pull/42',
              number: 42
            }, 201)
          );

        vi.stubGlobal(
          'fetch',
          fetchMock
        );

        const result =
          await GithubAutomationService
            .createBranchAndPR(
              candidate,
              patch
            );

        expect(result.success).toBe(true);
        expect(result.branchName).toContain(BASE_COMMIT_SHA.slice(0, 12));
        expect(result.commitSha).toBe(
          CREATED_COMMIT_SHA
        );
        expect(result.pullRequestId).toBe(
          42
        );
        expect(fetchMock).toHaveBeenCalledTimes(
          8
        );

        const createBranchCall =
          fetchMock.mock.calls[6];

        const branchRequest =
          createBranchCall[1] as
            RequestInit;

        const branchBody = JSON.parse(
          String(branchRequest.body)
        );

        expect(branchBody.sha).toBe(
          CREATED_COMMIT_SHA
        );
        expect(branchBody.sha).not.toBe(
          BASE_COMMIT_SHA
        );

        const commitCall =
          fetchMock.mock.calls[5];

        const commitRequest =
          commitCall[1] as
            RequestInit;

        const commitBody = JSON.parse(
          String(commitRequest.body)
        );

        expect(commitBody.parents).toEqual([
          BASE_COMMIT_SHA
        ]);
        expect(commitBody.tree).toBe(
          CREATED_TREE_SHA
        );
      }
    );

    it('cria uma nova branch para cada correção do comitê sem sobrescrever a anterior e retoma a mesma rodada', async () => {
      process.env.GITHUB_TOKEN = 'test-token';
      delete process.env.GITHUB_APP_TOKEN;
      process.env.GITHUB_OWNER = 'test-owner';
      process.env.GITHUB_REPO = 'test-repo';
      process.env.GITHUB_BASE_BRANCH = 'main';
      const branches = new Map<string, string>();
      const commits = new Map<string, { sha: string; tree: { sha: string }; parents: { sha: string }[] }>();
      const pulls = new Map<string, { number: number; html_url: string; head: { sha: string } }>();
      let treeSequence = 0;
      let commitSequence = 0;
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const route = url.pathname.replace('/repos/test-owner/test-repo', '');
        const method = init?.method || 'GET';
        if (method === 'GET' && route === '/pulls') {
          const name = url.searchParams.get('head')?.replace('test-owner:', '') || '';
          return mockResponse(pulls.has(name) ? [pulls.get(name)] : []);
        }
        if (method === 'GET' && route.startsWith('/git/ref/heads/')) {
          const name = route.slice('/git/ref/heads/'.length);
          return mockResponse({ object: { sha: name === 'main' ? BASE_COMMIT_SHA : branches.get(name) } });
        }
        if (method === 'GET' && route.startsWith('/git/commits/')) {
          const sha = route.slice('/git/commits/'.length);
          return mockResponse(sha === BASE_COMMIT_SHA ? { sha, tree: { sha: BASE_TREE_SHA } } : commits.get(sha));
        }
        if (method === 'POST' && route === '/git/blobs') return mockResponse({ sha: BLOB_SHA });
        if (method === 'POST' && route === '/git/trees') {
          return mockResponse({ sha: (++treeSequence).toString(16).padStart(40, '0') });
        }
        if (method === 'POST' && route === '/git/commits') {
          const sha = (++commitSequence + 100).toString(16).padStart(40, '0');
          commits.set(sha, { sha, tree: { sha: body.tree }, parents: body.parents.map((parent: string) => ({ sha: parent })) });
          return mockResponse({ sha });
        }
        if (method === 'POST' && route === '/git/refs') {
          const name = body.ref.replace('refs/heads/', '');
          if (branches.has(name)) return mockResponse({ message: 'Reference already exists' }, 422);
          branches.set(name, body.sha);
          return mockResponse({ ref: body.ref }, 201);
        }
        if (method === 'POST' && route === '/pulls') {
          const number = pulls.size + 42;
          const pull = { number, html_url: `https://github.com/test-owner/test-repo/pull/${number}`, head: { sha: branches.get(body.head)! } };
          pulls.set(body.head, pull);
          return mockResponse(pull, 201);
        }
        throw new Error(`Unexpected GitHub operation: ${method} ${route}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const initial = await GithubAutomationService.createBranchAndPR(candidate, patch);
      expect(initial.success).toBe(true);
      const firstRepair = {
        ...candidate,
        committeeRepair: { dateKey: '2026-10-25', attempt: 1, previousCommitSha: initial.commitSha! },
      };
      const correctedPatch = { ...patch, files: [{ ...patch.files![0], content: 'export const MainButton = () => <button />;' }] };
      const repaired = await GithubAutomationService.createBranchAndPR(firstRepair, correctedPatch);
      expect(repaired).toMatchObject({ success: true, pullRequestId: 43 });
      expect(repaired.branchName).not.toBe(initial.branchName);
      expect(branches.get(initial.branchName!)).toBe(initial.commitSha);
      expect(await GithubAutomationService.createBranchAndPR({
        ...firstRepair, branchName: repaired.branchName, pullRequestUrl: repaired.pullRequestUrl,
      }, correctedPatch)).toMatchObject({ success: true, pullRequestId: 43, commitSha: repaired.commitSha });
      const second = await GithubAutomationService.createBranchAndPR({
        ...firstRepair, committeeRepair: { ...firstRepair.committeeRepair, attempt: 2, previousCommitSha: repaired.commitSha! },
      }, correctedPatch);
      const nextDay = await GithubAutomationService.createBranchAndPR({
        ...firstRepair, committeeRepair: { ...firstRepair.committeeRepair, dateKey: '2026-10-26', previousCommitSha: second.commitSha! },
      }, correctedPatch);
      expect(second).toMatchObject({ success: true, pullRequestId: 44 });
      expect(nextDay).toMatchObject({ success: true, pullRequestId: 45 });
      expect(branches.size).toBe(4);
      expect(commitSequence).toBe(4);
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    });

    it.each([
      { dateKey: '../../main', attempt: 1 },
      { dateKey: '2026-10-25', attempt: 0 },
    ])('recusa marcador inválido de correção antes de criar uma branch: %j', async (repair) => {
      process.env.GITHUB_TOKEN = 'test-token';
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await GithubAutomationService.createBranchAndPR({
        ...candidate, committeeRepair: { ...repair, previousCommitSha: CREATED_COMMIT_SHA },
      }, patch);
      expect(result).toMatchObject({ success: false });
      expect(result.errorMessage).toContain('marcador');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('merges only the exact commit approved by the committee', async () => {
      process.env.GITHUB_TOKEN = 'test-token';
      process.env.GITHUB_OWNER = 'test-owner';
      process.env.GITHUB_REPO = 'test-repo';
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          mockResponse({
            state: 'open',
            draft: false,
            head: { sha: CREATED_COMMIT_SHA },
          })
        )
        .mockResolvedValueOnce(
          mockResponse({
            merged: true,
            sha: 'f'.repeat(40),
            message: 'Pull Request successfully merged',
          })
        );
      vi.stubGlobal('fetch', fetchMock);

      const result = await GithubAutomationService.mergeApprovedPullRequest(
        'https://github.com/test-owner/test-repo/pull/42',
        CREATED_COMMIT_SHA
      );

      expect(result.success).toBe(true);
      expect(result.mergeCommitSha).toBe('f'.repeat(40));
      const mergeBody = JSON.parse(
        String((fetchMock.mock.calls[1][1] as RequestInit).body)
      );
      expect(mergeBody.sha).toBe(CREATED_COMMIT_SHA);
    });

    it('blocks merge when the PR head changed after approval', async () => {
      process.env.GITHUB_TOKEN = 'test-token';
      process.env.GITHUB_OWNER = 'test-owner';
      process.env.GITHUB_REPO = 'test-repo';
      const fetchMock = vi.fn().mockResolvedValueOnce(
        mockResponse({
          state: 'open',
          draft: false,
          head: { sha: '0'.repeat(40) },
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = await GithubAutomationService.mergeApprovedPullRequest(
        'https://github.com/test-owner/test-repo/pull/42',
        CREATED_COMMIT_SHA
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('mudou depois da aprovação');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }
);
