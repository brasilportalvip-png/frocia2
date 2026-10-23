import { AutonomousBrowserValidationService } from './autonomousBrowserValidationService.js';

export interface ProductionReleaseVerification {
  status: 'accepted' | 'pending' | 'blocked' | 'failed';
  message: string;
  deploymentId?: string;
  url?: string;
}

/** Merge, deploy publicado e site homologado sao etapas distintas. */
export class ProductionReleaseVerificationService {
  static async verify(candidateId: string, mergeSha: string): Promise<ProductionReleaseVerification> {
    const token = process.env.VERCEL_TOKEN?.trim();
    const projectId = process.env.VERCEL_PROJECT_ID?.trim();
    const configuredTarget = process.env.SELF_EVOLUTION_TARGET_URL?.trim();
    if (!token || !projectId || !configuredTarget) return { status: 'blocked', message: 'VERCEL_TOKEN, VERCEL_PROJECT_ID ou URL do proprio site ausente para confirmar a publicacao.' };
    if (!/^[a-f0-9]{40}$/i.test(mergeSha)) return { status: 'blocked', message: 'SHA completo do merge ausente; publicacao nao comprovada.' };
    try {
      const target = new URL(configuredTarget);
      if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) return { status: 'blocked', message: 'URL de producao invalida.' };
      const params = new URLSearchParams({ withGitRepoInfo: 'true' });
      if (process.env.VERCEL_TEAM_ID) params.set('teamId', process.env.VERCEL_TEAM_ID);
      // Resolver o alias e conferir seu deployment: https://vercel.com/docs/rest-api/aliases/get-an-alias
      const aliasParams = new URLSearchParams({ projectId });
      if (process.env.VERCEL_TEAM_ID) aliasParams.set('teamId', process.env.VERCEL_TEAM_ID);
      const aliasUrl = `https://api.vercel.com/v4/aliases/${encodeURIComponent(target.hostname)}?${aliasParams}`;
      const getAlias = () => fetch(aliasUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      const aliasResponse = await getAlias();
      if (!aliasResponse.ok) return { status: 'blocked', message: `Nao foi possivel conferir o dominio publicado: Vercel HTTP ${aliasResponse.status}.` };
      const alias = await aliasResponse.json() as { alias?: string; deploymentId?: string; projectId?: string };
      if (alias.alias !== target.hostname || alias.projectId !== projectId || !alias.deploymentId) {
        return { status: 'blocked', message: 'O dominio nao esta vinculado ao projeto esperado na Vercel.' };
      }
      const response = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(alias.deploymentId)}?${params}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return { status: 'blocked', message: `Nao foi possivel conferir a versao no dominio de producao: Vercel HTTP ${response.status}.` };
      const deployment = await response.json() as {
        id?: string; projectId?: string; readyState?: string; target?: string;
        gitSource?: { sha?: string }; meta?: { githubCommitSha?: string };
      };
      if (deployment.id !== alias.deploymentId || deployment.projectId !== projectId || deployment.target !== 'production') {
        return { status: 'blocked', message: 'O dominio retornado nao comprova o projeto e o ambiente de producao esperados.' };
      }
      if ((deployment.gitSource?.sha || deployment.meta?.githubCommitSha) !== mergeSha || deployment.readyState !== 'READY') {
        return { status: 'pending', deploymentId: deployment.id, message: 'O commit do merge ainda nao esta READY no dominio de producao. Nenhuma publicacao concluida foi declarada.' };
      }
      for (const route of ['/api/live', '/api/ready', '/api/health']) {
        const health = await fetch(new URL(route, target), { signal: AbortSignal.timeout(15_000), redirect: 'error' });
        if (!health.ok) return { status: 'failed', deploymentId: deployment.id, url: target.origin,
          message: `O commit publicado falhou no smoke test ${route}: HTTP ${health.status}.` };
      }
      const browser = await AutonomousBrowserValidationService.validate({ candidateId, commitSha: mergeSha, previewUrl: target.toString() });
      if (browser.scenarios.some(s => s.status === 'external_blocker')) return { status: 'blocked', deploymentId: deployment.id,
        message: 'A versao foi publicada, mas a homologacao tem bloqueios de sessao ou cobertura. A correcao ainda nao foi aceita.' };
      if (!browser.passed) return { status: 'failed', deploymentId: deployment.id, url: target.origin,
        message: 'A versao publicada apresentou falhas comprovadas na validacao real do navegador.' };
      const aliasAfter = await getAlias();
      const confirmed = aliasAfter.ok ? await aliasAfter.json() as { deploymentId?: string } : null;
      if (confirmed?.deploymentId !== alias.deploymentId) return { status: 'pending', message: 'O dominio mudou durante a verificacao; e necessario conferir a nova versao.' };
      return { status: 'accepted', deploymentId: deployment.id, url: target.origin,
        message: 'SHA do merge confirmado na Vercel e no dominio de producao; smoke tests e navegador aprovados.' };
    } catch (error) {
      return { status: 'blocked', message: `Nao foi possivel comprovar a publicacao: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}
