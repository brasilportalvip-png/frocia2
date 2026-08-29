export interface RollbackResult {
  status: 'configured' | 'not_configured' | 'revert_pr_created' | 'success' | 'failed';
  success: boolean;
  revertedCommitHash?: string;
  revertPullRequestUrl?: string;
  message: string;
}

interface PullRequestData {
  node_id?: string;
  merge_commit_sha?: string;
  merged_at?: string | null;
}

interface RevertMutationData {
  data?: {
    revertPullRequest?: {
      revertPullRequest?: { url?: string; number?: number; headRefOid?: string };
    };
  };
  errors?: Array<{ message?: string }>;
}

export class RollbackService {
  private static isConfigured(): boolean {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    return Boolean(token?.trim() && owner.trim() && repo.trim());
  }

  private static headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'FrocIA-SelfEvolution',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  static async executeRollback(
    candidateId: string,
    reason: string,
    prNumber?: number
  ): Promise<RollbackResult> {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';

    if (!this.isConfigured() || !token) {
      return {
        status: 'not_configured',
        success: false,
        message: 'Mecanismo de rollback automático não configurado (GITHUB_TOKEN ausente).',
      };
    }
    if (!prNumber || !Number.isSafeInteger(prNumber) || prNumber < 1) {
      return {
        status: 'failed',
        success: false,
        message: 'Número do Pull Request não fornecido para criação do PR de reversão.',
      };
    }

    const repositoryUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    try {
      const prResponse = await fetch(`${repositoryUrl}/pulls/${prNumber}`, {
        headers: this.headers(token),
        signal: AbortSignal.timeout(30_000),
      });
      if (!prResponse.ok) {
        return {
          status: 'failed',
          success: false,
          message: `Erro ao obter Pull Request #${prNumber}: HTTP ${prResponse.status}`,
        };
      }

      const pr = (await prResponse.json()) as PullRequestData;
      if (!pr.node_id || !pr.merge_commit_sha || !pr.merged_at) {
        return {
          status: 'failed',
          success: false,
          revertedCommitHash: pr.merge_commit_sha,
          message: `Pull Request #${prNumber} não está mergeado ou não possui identificador de reversão.`,
        };
      }

      const mutation = `mutation RevertPullRequest($input: RevertPullRequestInput!) {
        revertPullRequest(input: $input) {
          revertPullRequest { url number headRefOid }
        }
      }`;
      const revertResponse = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: this.headers(token),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          query: mutation,
          variables: {
            input: {
              pullRequestId: pr.node_id,
              title: `revert: PR #${prNumber} por rollback de emergência`,
              body: `Rollback do candidato ${candidateId}.\n\nMotivo: ${reason.slice(0, 500)}`,
              draft: false,
            },
          },
        }),
      });
      const mutationData = (await revertResponse.json()) as RevertMutationData;
      const revertPr = mutationData.data?.revertPullRequest?.revertPullRequest;
      if (!revertResponse.ok || !revertPr?.url || !revertPr.number) {
        return {
          status: 'failed',
          success: false,
          revertedCommitHash: pr.merge_commit_sha,
          message: mutationData.errors?.[0]?.message ||
            `GitHub não criou o Pull Request de reversão (HTTP ${revertResponse.status}).`,
        };
      }

      if (process.env.AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED !== 'true') {
        return {
          status: 'revert_pr_created',
          success: false,
          revertedCommitHash: pr.merge_commit_sha,
          revertPullRequestUrl: revertPr.url,
          message: `PR de reversão criado e aguardando aprovação humana: ${revertPr.url}`,
        };
      }

      const mergeResponse = await fetch(`${repositoryUrl}/pulls/${revertPr.number}/merge`, {
        method: 'PUT',
        headers: this.headers(token),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          sha: revertPr.headRefOid,
          merge_method: 'merge',
          commit_title: `Revert PR #${prNumber}: rollback de emergência`,
        }),
      });
      const mergeData = (await mergeResponse.json()) as { merged?: boolean; message?: string };
      if (!mergeResponse.ok || mergeData.merged !== true) {
        return {
          status: 'revert_pr_created',
          success: false,
          revertedCommitHash: pr.merge_commit_sha,
          revertPullRequestUrl: revertPr.url,
          message: `PR de reversão criado, mas ainda não mergeado: ${mergeData.message || `HTTP ${mergeResponse.status}`}`,
        };
      }

      return {
        status: 'success',
        success: true,
        revertedCommitHash: pr.merge_commit_sha,
        revertPullRequestUrl: revertPr.url,
        message: `Rollback mergeado com sucesso pelo PR ${revertPr.url}.`,
      };
    } catch (error) {
      return {
        status: 'failed',
        success: false,
        message: `Erro na execução do rollback: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
