export interface PreviewDeployResult {
  status: 'ready' | 'failed' | 'not_configured' | 'pending';
  previewUrl?: string;
  deploymentId?: string;
  smokeTestsPassed?: boolean;
  errorMessage?: string;
}

export class PreviewDeploymentService {
  private static isConfigured(): boolean {
    const vercelToken = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    return Boolean(vercelToken && vercelToken.trim().length > 0 && projectId && projectId.trim().length > 0);
  }

  static async createPreviewDeployment(candidateId: string, branchName?: string): Promise<PreviewDeployResult> {
    const vercelToken = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;

    if (!this.isConfigured()) {
      return {
        status: 'not_configured',
        errorMessage: 'Integração de Preview Vercel não configurada (VERCEL_TOKEN/VERCEL_PROJECT_ID ausente).',
      };
    }

    if (!branchName) {
      return {
        status: 'pending',
        errorMessage: 'Aguardando nome da branch para localizar o deployment de preview da Vercel.',
      };
    }

    try {
      const response = await fetch(`https://api.vercel.com/v6/deployments?projectId=${projectId}&meta-githubCommitRef=${encodeURIComponent(branchName)}`, {
        headers: {
          'Authorization': `Bearer ${vercelToken}`,
        },
      });

      if (!response.ok) {
        return {
          status: 'failed',
          errorMessage: `Erro ao consultar Vercel API: HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const deployments = data.deployments || [];

      if (deployments.length === 0) {
        return {
          status: 'pending',
          errorMessage: 'Nenhum deployment Vercel encontrado para a branch fornecida ainda.',
        };
      }

      const latest = deployments[0];
      if (latest.state !== 'READY') {
        return {
          status: latest.state === 'ERROR' ? 'failed' : 'pending',
          deploymentId: latest.uid,
          previewUrl: latest.url ? `https://${latest.url}` : undefined,
          errorMessage: `Deployment na Vercel está no estado: ${latest.state}`,
        };
      }

      const previewUrl = `https://${latest.url}`;

      // Run real smoke test on preview URL
      let smokeTestsPassed = false;
      try {
        const pingRes = await fetch(`${previewUrl}/api/health`, { method: 'GET' });
        smokeTestsPassed = pingRes.ok;
      } catch {
        smokeTestsPassed = false;
      }

      return {
        status: smokeTestsPassed ? 'ready' : 'failed',
        deploymentId: latest.uid,
        previewUrl,
        smokeTestsPassed,
        errorMessage: smokeTestsPassed ? undefined : 'Smoke test falhou na URL de preview do deployment Vercel.',
      };
    } catch (err: any) {
      return {
        status: 'failed',
        errorMessage: `Erro ao gerenciar preview deployment Vercel: ${err?.message || err}`,
      };
    }
  }
}

