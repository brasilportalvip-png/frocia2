const GITHUB_API_URL = 'https://api.github.com';
const VERCEL_API_URL = 'https://api.vercel.com';
const EXTERNAL_REQUEST_TIMEOUT_MS = 30_000;
const SMOKE_TEST_TIMEOUT_MS = 15_000;
const MAX_DEPLOYMENT_FILES = 100;
const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 10_000_000;

export interface ProjectDeploymentFile {
  path: string;
  content: string;
}

export interface GitHubPublishInput {
  token: string;
  owner: string;
  repoName: string;
  isPrivate: boolean;
  branch: string;
  message: string;
  files: ProjectDeploymentFile[];
  allowExistingRepository: boolean;
}

export interface GitHubPublishResult {
  repositoryFullName: string;
  repositoryId: number;
  repositoryUrl: string;
  branch: string;
  commitSha: string;
  commitUrl: string;
  createdRepository: boolean;
  verified: true;
}

export interface VercelDeploymentInput {
  token: string;
  projectName: string;
  repoOwner: string;
  repoName: string;
  repoId?: number;
  branch: string;
  commitSha: string;
}

export interface VercelDeploymentResult {
  deploymentId: string;
  vercelProjectId?: string;
  deploymentUrl?: string;
  inspectUrl?: string;
  providerState: string;
  status: 'pending' | 'ready' | 'failed';
}

export interface VercelDeploymentStatus {
  deploymentId: string;
  deploymentUrl?: string;
  inspectUrl?: string;
  providerState: string;
  status: 'pending' | 'ready' | 'failed';
  smokeTestPassed: boolean | null;
  errorMessage?: string;
}

interface GitHubRepositoryResponse {
  id?: number;
  full_name?: string;
  html_url?: string;
  default_branch?: string;
}

interface GitHubReferenceResponse {
  object?: {
    sha?: string;
  };
}

interface GitHubCommitResponse {
  sha?: string;
  html_url?: string;
  tree?: {
    sha?: string;
  };
}

interface GitHubBlobResponse {
  sha?: string;
}

interface GitHubTreeResponse {
  sha?: string;
}

interface VercelDeploymentResponse {
  id?: string;
  uid?: string;
  url?: string;
  inspectorUrl?: string;
  readyState?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  projectId?: string;
}

export class DeploymentProviderError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(
    code: string,
    message: string,
    httpStatus = 502
  ) {
    super(message);
    this.name = 'DeploymentProviderError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function isCommitSha(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{40}$/i.test(value)
  );
}

function encodeBranch(branch: string): string {
  return branch
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function readJson<T>(
  response: Response
): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new DeploymentProviderError(
      'invalid_provider_response',
      'O provedor de publicação retornou uma resposta inválida.'
    );
  }
}

function getGitHubHeaders(
  token: string,
  includeJson = false
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'FrocIA-ProjectPublisher',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

async function externalFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: any) {
    const timedOut =
      error?.name === 'TimeoutError' ||
      error?.name === 'AbortError';

    throw new DeploymentProviderError(
      timedOut
        ? 'provider_timeout'
        : 'provider_unreachable',
      timedOut
        ? 'O provedor de publicação excedeu o tempo limite.'
        : 'Não foi possível acessar o provedor de publicação.'
    );
  }
}

export function normalizeRepositoryName(
  value: string
): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/(^[-.]+|[-.]+$)/g, '')
    .slice(0, 100);
}

export function isSafeBranchName(
  value: string
): boolean {
  return (
    value.length > 0 &&
    value.length <= 120 &&
    /^[a-zA-Z0-9._/-]+$/.test(value) &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.endsWith('.lock')
  );
}

export function validateDeploymentFiles(
  files: ProjectDeploymentFile[]
): ProjectDeploymentFile[] {
  if (files.length === 0) {
    throw new DeploymentProviderError(
      'deployment_files_required',
      'Inclua ao menos um arquivo para publicar.',
      400
    );
  }

  if (files.length > MAX_DEPLOYMENT_FILES) {
    throw new DeploymentProviderError(
      'too_many_deployment_files',
      `A publicação aceita no máximo ${MAX_DEPLOYMENT_FILES} arquivos por operação.`,
      400
    );
  }

  const seenPaths = new Set<string>();
  let totalBytes = 0;

  return files.map((file) => {
    const path = file.path
      .trim()
      .replace(/\\/g, '/');

    const pathParts = path.split('/');
    const lowerPath = path.toLowerCase();
    const fileBytes = Buffer.byteLength(
      file.content,
      'utf8'
    );

    if (
      !path ||
      path.length > 260 ||
      path.startsWith('/') ||
      pathParts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..'
      ) ||
      path.includes('\0') ||
      lowerPath === '.git' ||
      lowerPath.startsWith('.git/')
    ) {
      throw new DeploymentProviderError(
        'unsafe_deployment_path',
        `O caminho de arquivo '${file.path}' não é seguro para publicação.`,
        400
      );
    }

    if (
      /(^|\/)\.env(?:\.|$)/i.test(path) ||
      /(^|\/)(id_rsa|id_ed25519)(\.|$)/i.test(path) ||
      /\.(pem|p12|pfx|key)$/i.test(path)
    ) {
      throw new DeploymentProviderError(
        'sensitive_file_blocked',
        `O arquivo sensível '${file.path}' não pode ser publicado.`,
        400
      );
    }

    if (seenPaths.has(path)) {
      throw new DeploymentProviderError(
        'duplicate_deployment_path',
        `O arquivo '${path}' foi informado mais de uma vez.`,
        400
      );
    }

    if (fileBytes > MAX_FILE_BYTES) {
      throw new DeploymentProviderError(
        'deployment_file_too_large',
        `O arquivo '${path}' excede o limite de ${MAX_FILE_BYTES} bytes.`,
        400
      );
    }

    totalBytes += fileBytes;

    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new DeploymentProviderError(
        'deployment_payload_too_large',
        `A publicação excede o limite total de ${MAX_TOTAL_BYTES} bytes.`,
        400
      );
    }

    seenPaths.add(path);

    return {
      path,
      content: file.content,
    };
  });
}

export class ProjectDeploymentService {
  static async publishToGitHub(
    input: GitHubPublishInput
  ): Promise<GitHubPublishResult> {
    const repoName = normalizeRepositoryName(
      input.repoName
    );

    if (!repoName) {
      throw new DeploymentProviderError(
        'invalid_repository_name',
        'O nome do repositório não é válido.',
        400
      );
    }

    if (!isSafeBranchName(input.branch)) {
      throw new DeploymentProviderError(
        'invalid_branch_name',
        'O nome da branch não é válido.',
        400
      );
    }

    const files = validateDeploymentFiles(
      input.files
    );
    const token = input.token.trim();
    const owner = input.owner.trim();
    const repositoryApiUrl =
      `${GITHUB_API_URL}/repos/` +
      `${encodeURIComponent(owner)}/` +
      `${encodeURIComponent(repoName)}`;

    let repositoryResponse = await externalFetch(
      repositoryApiUrl,
      {
        headers: getGitHubHeaders(token),
      }
    );

    let createdRepository = false;
    let repository: GitHubRepositoryResponse;

    if (repositoryResponse.status === 404) {
      const createRepositoryResponse =
        await externalFetch(
          `${GITHUB_API_URL}/user/repos`,
          {
            method: 'POST',
            headers: getGitHubHeaders(
              token,
              true
            ),
            body: JSON.stringify({
              name: repoName,
              private: input.isPrivate,
              description:
                'Projeto criado e publicado pela Froc.IA',
              auto_init: true,
            }),
          }
        );

      if (!createRepositoryResponse.ok) {
        throw new DeploymentProviderError(
          'github_repository_create_failed',
          `O GitHub recusou a criação do repositório (HTTP ${createRepositoryResponse.status}).`
        );
      }

      repository = await readJson<GitHubRepositoryResponse>(
        createRepositoryResponse
      );
      createdRepository = true;
    } else {
      if (!repositoryResponse.ok) {
        throw new DeploymentProviderError(
          'github_repository_check_failed',
          `Não foi possível consultar o repositório no GitHub (HTTP ${repositoryResponse.status}).`
        );
      }

      if (!input.allowExistingRepository) {
        throw new DeploymentProviderError(
          'github_repository_not_bound',
          'O repositório já existe e não está vinculado a este projeto.',
          409
        );
      }

      repository = await readJson<GitHubRepositoryResponse>(
        repositoryResponse
      );
    }

    if (
      !repository.id ||
      repository.full_name !==
        `${owner}/${repoName}` ||
      !repository.html_url
    ) {
      throw new DeploymentProviderError(
        'github_repository_response_invalid',
        'O GitHub não confirmou o repositório solicitado.'
      );
    }

    const defaultBranch =
      repository.default_branch || 'main';
    const requestedBranchUrl =
      `${repositoryApiUrl}/git/ref/heads/` +
      encodeBranch(input.branch);
    const requestedBranchResponse =
      await externalFetch(
        requestedBranchUrl,
        {
          headers: getGitHubHeaders(token),
        }
      );

    let branchExists = requestedBranchResponse.ok;
    let baseReference: GitHubReferenceResponse;

    if (branchExists) {
      baseReference =
        await readJson<GitHubReferenceResponse>(
          requestedBranchResponse
        );
    } else if (requestedBranchResponse.status === 404) {
      const defaultReferenceResponse =
        await externalFetch(
          `${repositoryApiUrl}/git/ref/heads/` +
          encodeBranch(defaultBranch),
          {
            headers: getGitHubHeaders(token),
          }
        );

      if (!defaultReferenceResponse.ok) {
        throw new DeploymentProviderError(
          'github_base_branch_unavailable',
          `Não foi possível obter a branch base no GitHub (HTTP ${defaultReferenceResponse.status}).`
        );
      }

      baseReference =
        await readJson<GitHubReferenceResponse>(
          defaultReferenceResponse
        );
      branchExists = false;
    } else {
      throw new DeploymentProviderError(
        'github_branch_check_failed',
        `Não foi possível consultar a branch no GitHub (HTTP ${requestedBranchResponse.status}).`
      );
    }

    const parentSha = baseReference.object?.sha;

    if (!isCommitSha(parentSha)) {
      throw new DeploymentProviderError(
        'github_parent_sha_invalid',
        'O GitHub não retornou um commit base válido.'
      );
    }

    const baseCommitResponse = await externalFetch(
      `${repositoryApiUrl}/git/commits/${parentSha}`,
      {
        headers: getGitHubHeaders(token),
      }
    );

    if (!baseCommitResponse.ok) {
      throw new DeploymentProviderError(
        'github_base_commit_unavailable',
        `Não foi possível consultar o commit base (HTTP ${baseCommitResponse.status}).`
      );
    }

    const baseCommit = await readJson<GitHubCommitResponse>(
      baseCommitResponse
    );
    const baseTreeSha = baseCommit.tree?.sha;

    if (!isCommitSha(baseTreeSha)) {
      throw new DeploymentProviderError(
        'github_base_tree_invalid',
        'O GitHub não retornou uma árvore base válida.'
      );
    }

    const treeEntries = await Promise.all(
      files.map(async (file) => {
        const blobResponse = await externalFetch(
          `${repositoryApiUrl}/git/blobs`,
          {
            method: 'POST',
            headers: getGitHubHeaders(
              token,
              true
            ),
            body: JSON.stringify({
              content: file.content,
              encoding: 'utf-8',
            }),
          }
        );

        if (!blobResponse.ok) {
          throw new DeploymentProviderError(
            'github_blob_create_failed',
            `Falha ao enviar '${file.path}' ao GitHub (HTTP ${blobResponse.status}).`
          );
        }

        const blob = await readJson<GitHubBlobResponse>(
          blobResponse
        );

        if (!isCommitSha(blob.sha)) {
          throw new DeploymentProviderError(
            'github_blob_sha_invalid',
            `O GitHub não confirmou o arquivo '${file.path}'.`
          );
        }

        return {
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blob.sha,
        };
      })
    );

    const treeResponse = await externalFetch(
      `${repositoryApiUrl}/git/trees`,
      {
        method: 'POST',
        headers: getGitHubHeaders(token, true),
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeEntries,
        }),
      }
    );

    if (!treeResponse.ok) {
      throw new DeploymentProviderError(
        'github_tree_create_failed',
        `O GitHub recusou a árvore do commit (HTTP ${treeResponse.status}).`
      );
    }

    const tree = await readJson<GitHubTreeResponse>(
      treeResponse
    );

    if (!isCommitSha(tree.sha)) {
      throw new DeploymentProviderError(
        'github_tree_sha_invalid',
        'O GitHub não confirmou a árvore do commit.'
      );
    }

    const commitResponse = await externalFetch(
      `${repositoryApiUrl}/git/commits`,
      {
        method: 'POST',
        headers: getGitHubHeaders(token, true),
        body: JSON.stringify({
          message: input.message.trim(),
          tree: tree.sha,
          parents: [parentSha],
        }),
      }
    );

    if (!commitResponse.ok) {
      throw new DeploymentProviderError(
        'github_commit_create_failed',
        `O GitHub recusou a criação do commit (HTTP ${commitResponse.status}).`
      );
    }

    const commit = await readJson<GitHubCommitResponse>(
      commitResponse
    );

    if (
      !isCommitSha(commit.sha) ||
      commit.sha === parentSha
    ) {
      throw new DeploymentProviderError(
        'github_commit_sha_invalid',
        'O GitHub não criou um novo commit verificável.'
      );
    }

    const referenceResponse = branchExists
      ? await externalFetch(
          `${repositoryApiUrl}/git/refs/heads/` +
            encodeBranch(input.branch),
          {
            method: 'PATCH',
            headers: getGitHubHeaders(token, true),
            body: JSON.stringify({
              sha: commit.sha,
              force: false,
            }),
          }
        )
      : await externalFetch(
          `${repositoryApiUrl}/git/refs`,
          {
            method: 'POST',
            headers: getGitHubHeaders(token, true),
            body: JSON.stringify({
              ref: `refs/heads/${input.branch}`,
              sha: commit.sha,
            }),
          }
        );

    if (!referenceResponse.ok) {
      throw new DeploymentProviderError(
        'github_reference_update_failed',
        `O GitHub não atualizou a branch (HTTP ${referenceResponse.status}).`
      );
    }

    const verificationResponse = await externalFetch(
      `${repositoryApiUrl}/git/commits/${commit.sha}`,
      {
        headers: getGitHubHeaders(token),
      }
    );

    if (!verificationResponse.ok) {
      throw new DeploymentProviderError(
        'github_commit_verification_failed',
        `O commit foi enviado, mas não pôde ser verificado (HTTP ${verificationResponse.status}).`
      );
    }

    const verifiedCommit =
      await readJson<GitHubCommitResponse>(
        verificationResponse
      );

    if (verifiedCommit.sha !== commit.sha) {
      throw new DeploymentProviderError(
        'github_commit_verification_mismatch',
        'O GitHub retornou um commit diferente durante a verificação.'
      );
    }

    return {
      repositoryFullName: repository.full_name,
      repositoryId: repository.id,
      repositoryUrl: repository.html_url,
      branch: input.branch,
      commitSha: commit.sha,
      commitUrl:
        commit.html_url ||
        `${repository.html_url}/commit/${commit.sha}`,
      createdRepository,
      verified: true,
    };
  }

  static async createVercelDeployment(
    input: VercelDeploymentInput
  ): Promise<VercelDeploymentResult> {
    if (!isSafeBranchName(input.branch)) {
      throw new DeploymentProviderError(
        'invalid_branch_name',
        'O nome da branch não é válido.',
        400
      );
    }

    if (!isCommitSha(input.commitSha)) {
      throw new DeploymentProviderError(
        'invalid_commit_sha',
        'O commit informado para deployment não é válido.',
        400
      );
    }

    const gitSource = input.repoId
      ? {
          type: 'github',
          repoId: input.repoId,
          ref: input.branch,
          sha: input.commitSha,
        }
      : {
          type: 'github',
          org: input.repoOwner,
          repo: input.repoName,
          ref: input.branch,
          sha: input.commitSha,
        };

    const response = await externalFetch(
      `${VERCEL_API_URL}/v13/deployments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.token.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: input.projectName,
          target: 'production',
          gitSource,
        }),
      }
    );

    if (!response.ok) {
      throw new DeploymentProviderError(
        'vercel_deployment_create_failed',
        `A Vercel recusou o deployment (HTTP ${response.status}).`
      );
    }

    const deployment =
      await readJson<VercelDeploymentResponse>(
        response
      );
    const deploymentId =
      deployment.id || deployment.uid;
    const providerState = String(
      deployment.readyState ||
      deployment.status ||
      'QUEUED'
    ).toUpperCase();

    if (!deploymentId) {
      throw new DeploymentProviderError(
        'vercel_deployment_id_missing',
        'A Vercel não retornou o identificador do deployment.'
      );
    }

    return {
      deploymentId,
      vercelProjectId: deployment.projectId,
      deploymentUrl: deployment.url
        ? `https://${deployment.url}`
        : undefined,
      inspectUrl: deployment.inspectorUrl,
      providerState,
      // Provider READY is not trusted until the authenticated status route
      // confirms it with a public HTML smoke test.
      status: ['ERROR', 'CANCELED', 'BLOCKED']
        .includes(providerState)
        ? 'failed'
        : 'pending',
    };
  }

  static async rollbackVercelDeployment(
    token: string,
    projectId: string,
    deploymentId: string,
    reason: string
  ): Promise<void> {
    if (
      !/^[a-zA-Z0-9_-]{3,160}$/.test(projectId) ||
      !/^[a-zA-Z0-9_-]{3,160}$/.test(deploymentId)
    ) {
      throw new DeploymentProviderError(
        'invalid_rollback_target',
        'O projeto ou deployment de rollback não é válido.',
        400
      );
    }

    const query = new URLSearchParams({
      description: reason,
    });
    const response = await externalFetch(
      `${VERCEL_API_URL}/v1/projects/` +
        `${encodeURIComponent(projectId)}/rollback/` +
        `${encodeURIComponent(deploymentId)}?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.trim()}`,
        },
      }
    );

    if (response.status !== 201) {
      throw new DeploymentProviderError(
        'vercel_rollback_failed',
        `A Vercel recusou o rollback (HTTP ${response.status}).`
      );
    }
  }

  static async getVercelDeploymentStatus(
    token: string,
    deploymentId: string
  ): Promise<VercelDeploymentStatus> {
    if (!/^[a-zA-Z0-9_-]{3,160}$/.test(deploymentId)) {
      throw new DeploymentProviderError(
        'invalid_deployment_id',
        'O identificador do deployment não é válido.',
        400
      );
    }

    const response = await externalFetch(
      `${VERCEL_API_URL}/v13/deployments/` +
        encodeURIComponent(deploymentId),
      {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
        },
      }
    );

    if (!response.ok) {
      throw new DeploymentProviderError(
        'vercel_deployment_status_failed',
        `Não foi possível consultar o deployment na Vercel (HTTP ${response.status}).`
      );
    }

    const deployment =
      await readJson<VercelDeploymentResponse>(
        response
      );
    const providerState = String(
      deployment.readyState ||
      deployment.status ||
      'UNKNOWN'
    ).toUpperCase();
    const deploymentUrl = deployment.url
      ? `https://${deployment.url}`
      : undefined;

    if (
      ['ERROR', 'CANCELED', 'BLOCKED']
        .includes(providerState)
    ) {
      return {
        deploymentId,
        deploymentUrl,
        inspectUrl: deployment.inspectorUrl,
        providerState,
        status: 'failed',
        smokeTestPassed: null,
        errorMessage:
          deployment.errorMessage ||
          deployment.errorCode ||
          `Deployment encerrado no estado ${providerState}.`,
      };
    }

    if (providerState !== 'READY') {
      return {
        deploymentId,
        deploymentUrl,
        inspectUrl: deployment.inspectorUrl,
        providerState,
        status: 'pending',
        smokeTestPassed: null,
      };
    }

    const smokeTestPassed = deploymentUrl
      ? await this.runSmokeTest(deploymentUrl)
      : false;

    return {
      deploymentId,
      deploymentUrl,
      inspectUrl: deployment.inspectorUrl,
      providerState,
      status: smokeTestPassed
        ? 'ready'
        : 'failed',
      smokeTestPassed,
      errorMessage: smokeTestPassed
        ? undefined
        : 'A Vercel informou READY, mas o smoke test da URL pública falhou.',
    };
  }

  static async runSmokeTest(
    deploymentUrl: string
  ): Promise<boolean> {
    let url: URL;

    try {
      url = new URL(deploymentUrl);
    } catch {
      return false;
    }

    const hostname = url.hostname.toLowerCase();

    if (
      url.protocol !== 'https:' ||
      !(
        hostname.endsWith('.vercel.app') ||
        hostname.endsWith('.now.sh')
      )
    ) {
      return false;
    }

    const response = await externalFetch(
      url.toString(),
      {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'FrocIA-SmokeTest',
        },
        redirect: 'error',
      },
      SMOKE_TEST_TIMEOUT_MS
    );

    if (!response.ok) {
      return false;
    }

    const contentType =
      response.headers.get('content-type') || '';

    if (!contentType.includes('text/html')) {
      return false;
    }

    const html = await response.text();

    return (
      html.length > 0 &&
      /<(?:html|body|main|div)(?:\s|>)/i.test(html)
    );
  }
}
