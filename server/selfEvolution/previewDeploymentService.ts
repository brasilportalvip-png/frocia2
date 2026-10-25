import { RedactionService } from './redactionService.js';
export interface PreviewDeployResult {
  status: 'ready' | 'failed' | 'not_configured' | 'pending';
  previewUrl?: string;
  deploymentId?: string;
  smokeTestsPassed?: boolean;
  diagnostic?: { phase: 'smoke'; httpStatus?: number; failureKind: string; dependencies?: Record<string, boolean>; bypassConfigured?: boolean };
  errorMessage?: string;
}

export class PreviewDeploymentService {
  static async verifyProjectAccess(): Promise<{ status: 'ready' | 'failed' | 'not_configured'; errorMessage?: string }> {
    if (!this.isConfigured()) return { status: 'not_configured', errorMessage: 'VERCEL_TOKEN/VERCEL_PROJECT_ID ausente no executor.' };
    try {
      const params = new URLSearchParams({ projectId: process.env.VERCEL_PROJECT_ID!, limit: '1' });
      if (process.env.VERCEL_TEAM_ID) params.set('teamId', process.env.VERCEL_TEAM_ID);
      const response = await fetch(`https://api.vercel.com/v6/deployments?${params}`, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(30_000),
      });
      return response.ok ? { status: 'ready' } : { status: 'failed', errorMessage: `Vercel recusou a leitura dos deployments: HTTP ${response.status}.` };
    } catch (error) { return { status: 'failed', errorMessage: error instanceof Error ? error.message : 'Falha de acesso a Vercel.' }; }
  }

  private static isConfigured(): boolean {
    const vercelToken = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    return Boolean(vercelToken && vercelToken.trim().length > 0 && projectId && projectId.trim().length > 0);
  }

  static async createPreviewDeployment(candidateId: string, branchName?: string, expectedSha?: string): Promise<PreviewDeployResult> {
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
    if (!expectedSha || !/^[a-f0-9]{40}$/i.test(expectedSha)) {
      return { status: 'pending', errorMessage: 'SHA completo ausente para conferir o preview da correcao.' };
    }

    try {
      const params = new URLSearchParams({ projectId: projectId!, 'meta-githubCommitRef': branchName, 'meta-githubCommitSha': expectedSha, limit: '20' });
      if (process.env.VERCEL_TEAM_ID) params.set('teamId', process.env.VERCEL_TEAM_ID);
      const response = await fetch(`https://api.vercel.com/v6/deployments?${params}`, {
        headers: {
          'Authorization': `Bearer ${vercelToken}`,
        },
        signal: AbortSignal.timeout(30_000),
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

      const latest = deployments.find((item: any) => item.meta?.githubCommitSha === expectedSha) ||
        deployments.find((item: any) => !item.meta?.githubCommitSha);
      if (!latest?.uid) return { status: 'pending', errorMessage: 'Aguardando deployment do SHA exato da correcao.' };
      if (latest.state !== 'READY') {
        return {
          status: latest.state === 'ERROR' ? 'failed' : 'pending',
          deploymentId: latest.uid,
          previewUrl: latest.url ? `https://${latest.url}` : undefined,
          errorMessage: `Deployment na Vercel está no estado: ${latest.state}`,
        };
      }

      const detailsParams = new URLSearchParams();
      if (process.env.VERCEL_TEAM_ID) detailsParams.set('teamId', process.env.VERCEL_TEAM_ID);
      const detailsResponse = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(latest.uid)}?${detailsParams}`, {
        headers: { Authorization: `Bearer ${vercelToken}` }, signal: AbortSignal.timeout(30_000),
      });
      if (!detailsResponse.ok) return { status: 'pending', errorMessage: `Nao foi possivel conferir o SHA do preview: HTTP ${detailsResponse.status}.` };
      const details = await detailsResponse.json();
      if (details.projectId !== projectId || details.target === 'production') {
        return { status: 'failed', errorMessage: 'Preview nao pertence ao projeto/ambiente esperado.' };
      }
      if ((details.gitSource?.sha || details.meta?.githubCommitSha) !== expectedSha || details.readyState !== 'READY') {
        return { status: 'pending', errorMessage: 'O preview do SHA exato ainda nao esta READY.' };
      }
      const preview = new URL(`https://${details.url}`);
      if (!details.url || preview.username || preview.password || preview.pathname !== '/' || preview.search || preview.hash) {
        return { status: 'failed', errorMessage: 'URL de preview invalida.' };
      }
      const previewUrl = preview.origin;

      // Keep health as a release gate; preserve only safe diagnostic fields.
      let diagnostic: PreviewDeployResult['diagnostic'];
      try {
        const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
        const pingRes = await fetch(`${previewUrl}/api/health`, { method: 'GET', signal: AbortSignal.timeout(15_000), redirect: 'manual',
          ...(bypass ? { headers: { 'x-vercel-protection-bypass': bypass } } : {}) });
        if (!pingRes.ok) {
          const dependencies: Record<string, boolean> = {};
          // Never return arbitrary response bodies (tokens, headers or private HTML).
          if (pingRes.status === 503 && pingRes.headers.get('content-type')?.includes('application/json')) {
            try {
              const body = await pingRes.json();
              for (const key of ['firebaseConfigured', 'mercadoPagoConfigured', 'geminiConfigured'])
                if (typeof body?.[key] === 'boolean') dependencies[key] = body[key];
            } catch { console.warn('Preview: resposta de health sem JSON valido.'); }
          }
          diagnostic = { phase: 'smoke', httpStatus: pingRes.status,
            bypassConfigured: Boolean(bypass),
            failureKind: pingRes.status >= 300 && pingRes.status < 400 ? 'redirect_or_deployment_protection' : [401, 403].includes(pingRes.status) ? 'access_denied' : pingRes.status === 503 ? 'dependencies_not_ready' : 'http_error',
            ...(Object.keys(dependencies).length ? { dependencies } : {}) };
        }
      } catch (error) {
        diagnostic = { phase: 'smoke', failureKind: error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network_or_redirect_error' };
      }
      const smokeTestsPassed = !diagnostic;
      const accessHint = diagnostic && ['redirect_or_deployment_protection', 'access_denied'].includes(diagnostic.failureKind)
        ? ` Credencial de automacao do preview: ${diagnostic.bypassConfigured ? 'configurada, mas acesso nao confirmado; verifique validade e redeploy' : 'ausente; configure VERCEL_AUTOMATION_BYPASS_SECRET do projeto no GitHub Actions'}.` : '';
      const dependencySummary = diagnostic?.dependencies ? ' Dependencias: ' + JSON.stringify(diagnostic.dependencies) + '.' : '';
      return {
        status: smokeTestsPassed ? 'ready' : 'failed', deploymentId: latest.uid, previewUrl, smokeTestsPassed,
        ...(diagnostic ? { diagnostic } : {}),
        errorMessage: diagnostic ? `Smoke test do preview reprovado: ${diagnostic.failureKind}${diagnostic.httpStatus ? `; HTTP ${diagnostic.httpStatus}` : ''}.${dependencySummary}${accessHint}` : undefined,
      };
    } catch (err: any) {
      return {
        status: 'failed',
        errorMessage: `Erro ao gerenciar preview deployment Vercel: ${RedactionService.redactSensitiveData(String(err?.message || err)).slice(0, 500)}`,
      };
    }
  }
}

