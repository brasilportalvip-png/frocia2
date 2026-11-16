/**
 * Botão "Publicar" do estúdio: coloca o site no ar na Vercel e devolve o link público
 * (ex.: https://pizzaria-bella-ab12cd.vercel.app). Publicar de novo atualiza o MESMO link.
 *
 * Usa a conta Vercel da Froc.IA: VERCEL_TOKEN (e VERCEL_TEAM_ID, se for um time) na Vercel.
 * O site é um único index.html (código e estilos dentro), então a publicação leva segundos.
 */

type FetchLike = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}>;

export class ForjaPublishError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Nome do projeto na Vercel: nome do site + pedaço do id (não colide entre usuários). */
export function vercelProjectName(siteName: string, projectId: string) {
  const base = String(siteName || 'site')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '') || 'site';
  const suffix = String(projectId || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'froc';
  return `${base}-${suffix}`;
}

export interface PublishInput {
  projectName: string;
  html: string;
  /** Projeto Vercel já criado numa publicação anterior. */
  vercelProjectId?: string | null;
}

export interface PublishResult {
  url: string;
  vercelProjectId: string;
  deploymentId: string;
}

export function createForjaPublisher(options: {
  token?: string;
  teamId?: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
}) {
  const token = (options.token || '').trim();
  const team = (options.teamId || '').trim();
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init) as never);
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxWait = options.maxWaitMs ?? 90_000;

  const api = async (path: string, method = 'GET', body?: unknown, allow404 = false) => {
    const url = `https://api.vercel.com${path}${team ? `${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(team)}` : ''}`;
    const res = await doFetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).replace(/Bearer\s+\S+/g, 'Bearer [oculto]').slice(0, 200);
      if (res.status === 401 || res.status === 403) throw new ForjaPublishError('vercel_token_refused', 'A Vercel recusou o VERCEL_TOKEN. Gere um token novo e salve na Vercel.', 503);
      throw new ForjaPublishError(`vercel_http_${res.status}`, `A Vercel recusou a publicação (HTTP ${res.status}). ${detail}`.trim());
    }
    return res.json();
  };

  return {
    configured: Boolean(token),
    async publish(input: PublishInput): Promise<PublishResult> {
      if (!token) throw new ForjaPublishError('vercel_unconfigured', 'Publicação ainda não configurada: falta o VERCEL_TOKEN na Vercel da Froc.IA.', 503);
      if (!input.html || !/<html[\s>]/i.test(input.html)) throw new ForjaPublishError('nothing_to_publish', 'O site ainda não tem uma versão compilada para publicar.', 400);

      // 1. Projeto na Vercel (cria na 1ª vez, aberto ao público, sem tela de login da Vercel).
      let projectId = input.vercelProjectId || '';
      if (projectId) {
        const found = await api(`/v9/projects/${encodeURIComponent(projectId)}`, 'GET', undefined, true);
        if (!found) projectId = '';
      }
      if (!projectId) {
        const existing = await api(`/v9/projects/${encodeURIComponent(input.projectName)}`, 'GET', undefined, true);
        const project = existing ?? (await api('/v10/projects', 'POST', { name: input.projectName, framework: null }));
        projectId = String(project.id || '');
        if (!projectId) throw new ForjaPublishError('vercel_project_invalid', 'A Vercel não devolveu o projeto criado.');
        await api(`/v9/projects/${encodeURIComponent(projectId)}`, 'PATCH', { ssoProtection: null, passwordProtection: null });
      }

      // 2. Publica o index.html em produção.
      const deployment = await api('/v13/deployments', 'POST', {
        name: input.projectName,
        project: projectId,
        target: 'production',
        files: [{ file: 'index.html', data: input.html, encoding: 'utf-8' }],
        projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null, devCommand: null },
        meta: { frocForja: '1' },
      });
      const deploymentId = String(deployment.id || deployment.uid || '');
      if (!deploymentId) throw new ForjaPublishError('vercel_deploy_invalid', 'A Vercel não devolveu a publicação.');

      // 3. Espera ficar no ar (site estático: poucos segundos).
      let state = String(deployment.readyState || deployment.status || '');
      const started = Date.now();
      while (state !== 'READY') {
        if (['ERROR', 'CANCELED'].includes(state)) throw new ForjaPublishError('vercel_deploy_failed', 'A Vercel não conseguiu publicar o site. Tente de novo.');
        if (Date.now() - started > maxWait) throw new ForjaPublishError('vercel_deploy_slow', 'A Vercel está demorando para publicar. Tente de novo em 1 minuto.', 504);
        await sleep(2000);
        const d = await api(`/v13/deployments/${encodeURIComponent(deploymentId)}`);
        state = String(d.readyState || d.status || '');
      }

      // 4. Endereço público fixo do projeto (o mesmo a cada nova publicação).
      const domains = await api(`/v9/projects/${encodeURIComponent(projectId)}/domains`, 'GET', undefined, true);
      const list: { name?: string }[] = Array.isArray(domains?.domains) ? domains.domains : [];
      const host = list.find((d) => d.name && !d.name.endsWith('.vercel.app'))?.name || list.find((d) => d.name?.endsWith('.vercel.app'))?.name || `${input.projectName}.vercel.app`;
      return { url: `https://${host}`, vercelProjectId: projectId, deploymentId };
    },
  };
}
