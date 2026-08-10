import { ImprovementCandidate } from './selfEvolutionTypes.js';

export interface PullRequestResult {
  status: 'configured' | 'not_configured' | 'failed' | 'success';
  success: boolean;
  branchName?: string;
  pullRequestUrl?: string;
  pullRequestId?: number;
  errorMessage?: string;
}

export class GithubAutomationService {
  private static isConfigured(): boolean {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    return Boolean(token && token.trim().length > 0 && owner && repo);
  }

  static async createBranchAndPR(candidate: ImprovementCandidate, baseSha?: string): Promise<PullRequestResult> {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    const targetBaseBranch = process.env.GITHUB_BASE_BRANCH || 'main';

    if (!this.isConfigured()) {
      return {
        status: 'not_configured',
        success: false,
        errorMessage: 'Integração GitHub não configurada (GITHUB_TOKEN/GITHUB_APP_TOKEN ausente).',
      };
    }

    // Safety check: Never push directly to main
    const slug = candidate.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const branchName = `froc-evolution/${candidate.riskLevel.toLowerCase()}/${candidate.id}-${slug}`;

    if (branchName === targetBaseBranch || branchName === 'main') {
      return {
        status: 'failed',
        success: false,
        errorMessage: 'Operação de push direto na branch principal (main) é estritamente proibida.',
      };
    }

    try {
      // 1. Get exact base SHA from main
      let currentSha = baseSha;
      if (!currentSha) {
        const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${targetBaseBranch}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'FrocIA-SelfEvolution',
          },
        });
        if (!refRes.ok) {
          return {
            status: 'failed',
            success: false,
            errorMessage: `Erro ao obter SHA da branch ${targetBaseBranch}: HTTP ${refRes.status}`,
          };
        }
        const refData = await refRes.json();
        currentSha = refData.object.sha;
      }

      // 2. Check idempotency: Check if PR or Ref already exists
      const checkPrRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branchName}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'FrocIA-SelfEvolution',
        },
      });
      if (checkPrRes.ok) {
        const existingPrs = await checkPrRes.json();
        if (Array.isArray(existingPrs) && existingPrs.length > 0) {
          return {
            status: 'success',
            success: true,
            branchName,
            pullRequestUrl: existingPrs[0].html_url,
            pullRequestId: existingPrs[0].number,
          };
        }
      }

      // 3. Create branch ref
      const createRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'FrocIA-SelfEvolution',
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: currentSha,
        }),
      });

      if (!createRefRes.ok && createRefRes.status !== 422) {
        return {
          status: 'failed',
          success: false,
          errorMessage: `Falha ao criar branch no GitHub: HTTP ${createRefRes.status}`,
        };
      }

      // 4. Create Pull Request
      const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'FrocIA-SelfEvolution',
        },
        body: JSON.stringify({
          title: `[Autoevolução ${candidate.riskLevel}] ${candidate.title}`,
          head: branchName,
          base: targetBaseBranch,
          body: `## Candidato de Autoevolução: ${candidate.title}\n\n**ID:** \`${candidate.id}\`\n**Nível de Risco:** \`${candidate.riskLevel}\`\n**Resumo:** ${candidate.summary}\n\n*Este PR foi gerado pelo Sistema de Autoevolução Supervisionada Froc.IA 2 e requer revisão humana antes do merge.*`,
        }),
      });

      if (!prRes.ok) {
        return {
          status: 'failed',
          success: false,
          errorMessage: `Falha ao criar Pull Request no GitHub: HTTP ${prRes.status}`,
        };
      }

      const prData = await prRes.json();
      return {
        status: 'success',
        success: true,
        branchName,
        pullRequestUrl: prData.html_url,
        pullRequestId: prData.number,
      };
    } catch (err: any) {
      return {
        status: 'failed',
        success: false,
        errorMessage: `Erro na automação do GitHub: ${err?.message || err}`,
      };
    }
  }
}

