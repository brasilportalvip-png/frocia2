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

const BASE_COMMIT_SHA = 'a'.repeat(40);
const BASE_TREE_SHA = 'b'.repeat(40);
const BLOB_SHA = 'c'.repeat(40);
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
  baseSha: BASE_COMMIT_SHA
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
