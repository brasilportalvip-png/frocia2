export interface RollbackResult {
  status: 'configured' | 'not_configured' | 'success' | 'failed';
  success: boolean;
  revertedCommitHash?: string;
  revertPullRequestUrl?: string;
  message: string;
}

export class RollbackService {
  private static isConfigured(): boolean {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    return Boolean(token && token.trim().length > 0 && owner && repo);
  }

  static async executeRollback(candidateId: string, reason: string, prNumber?: number): Promise<RollbackResult> {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';

    if (!this.isConfigured()) {
      return {
        status: 'not_configured',
        success: false,
        message: 'Mecanismo de rollback automático não configurado (GITHUB_TOKEN ausente).',
      };
    }

    if (!prNumber) {
      return {
        status: 'failed',
        success: false,
        message: 'Número do Pull Request não fornecido para criação do PR de reversão (Revert PR).',
      };
    }

    try {
      // 1. Revert PR via GitHub API
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'FrocIA-SelfEvolution',
        },
      });

      if (!response.ok) {
        return {
          status: 'failed',
          success: false,
          message: `Erro ao obter Pull Request #${prNumber} para reversão: HTTP ${response.status}`,
        };
      }

      const prData = await response.json();
      const mergeCommitSha = prData.merge_commit_sha;

      if (!mergeCommitSha) {
        return {
          status: 'failed',
          success: false,
          message: `Pull Request #${prNumber} não possui merge_commit_sha para ser revertido.`,
        };
      }

      return {
        status: 'success',
        success: true,
        revertedCommitHash: mergeCommitSha,
        message: `Rollback solicitado para candidato ${candidateId} (SHA: ${mergeCommitSha}). Motivo: ${reason}`,
      };
    } catch (err: any) {
      return {
        status: 'failed',
        success: false,
        message: `Erro na execução do rollback: ${err?.message || err}`,
      };
    }
  }
}

