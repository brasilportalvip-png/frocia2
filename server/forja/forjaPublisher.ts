/**
 * Botão "Publicar" do estúdio: coloca o site no ar na Vercel e devolve o link público
 * (ex.: https://pizzaria-bella-ab12cd.vercel.app). Publicar de novo atualiza o MESMO link.
 *
 * Cada pessoa publica na conta Vercel DELA (conecta uma vez com um token pessoal).
 * O site é um único index.html (código e estilos dentro), então a publicação leva segundos.
 */

import { createHash } from 'node:crypto';

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

/** Recusa (403) ao achar/criar o projeto: sinal de que o token aponta para o lugar errado da Vercel. */
class ScopeForbiddenError extends ForjaPublishError {
  constructor(message: string) {
    super('vercel_forbidden', message, 403);
  }
}

export interface PublishInput {
  projectName: string;
  html: string;
  /** Projeto Vercel já criado numa publicação anterior. */
  vercelProjectId?: string | null;
  /** Páginas do site (forja/site.json) para o sitemap.xml. */
  routes?: string[];
}

export interface PublishResult {
  url: string;
  vercelProjectId: string;
  deploymentId: string;
  /** Time da Vercel onde o site ficou (descoberto na hora se a conexão antiga não tinha). */
  teamId: string | null;
  /** Bing e outros buscadores foram avisados (IndexNow). */
  searchEnginesNotified: boolean;
}

/** Chave IndexNow fixa por projeto (o arquivo com ela vai junto na publicação). */
export function indexNowKey(projectName: string): string {
  return createHash('sha256').update('forja-indexnow:' + projectName).digest('hex').slice(0, 32);
}

/** Arquivos publicados: site + SEO (robots, sitemap, rotas com endereço próprio, chave IndexNow). */
export function buildDeployFiles(params: { html: string; host: string; projectName: string; routes?: string[] }) {
  const origin = `https://${params.host}`;
  const html = params.html.split('__SITE_URL__').join(origin);
  const routes = [...new Set(['/', ...(params.routes || [])].filter((r) => /^\/[a-z0-9\-/]*$/.test(r)))];
  const today = new Date().toISOString().slice(0, 10);
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    routes
      .map((r) => {
        const legal = /^\/(privacidade|termos)/.test(r);
        return `  <url><loc>${origin}${r === '/' ? '/' : r}</loc><lastmod>${today}</lastmod><changefreq>${legal ? 'yearly' : 'weekly'}</changefreq><priority>${r === '/' ? '1.0' : legal ? '0.3' : '0.8'}</priority></url>`;
      })
      .join('\n') +
    '\n</urlset>\n';
  const key = indexNowKey(params.projectName);
  const files = [
    { file: 'index.html', data: html },
    { file: 'robots.txt', data: `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n` },
    { file: 'sitemap.xml', data: sitemap },
    { file: `${key}.txt`, data: key },
    // Páginas com endereço próprio (/sobre, /privacidade): a Vercel entrega o site e ele abre a página certa.
    { file: 'vercel.json', data: JSON.stringify({ cleanUrls: true, rewrites: [{ source: '/((?!.*\\.).*)', destination: '/index.html' }] }, null, 2) },
  ];
  return { files: files.map((f) => ({ ...f, encoding: 'utf-8' })), urls: routes.map((r) => origin + (r === '/' ? '/' : r)), key, origin };
}

export function createForjaPublisher(options: {
  token?: string;
  teamId?: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
}) {
  const token = (options.token || '').trim();
  let team = (options.teamId || '').trim();
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
      if (res.status === 401) throw new ForjaPublishError('vercel_token_refused', 'A Vercel recusou o token da sua conta (ele pode ter vencido ou sido apagado). Conecte de novo.', 409);
      if (res.status === 403) {
        let reason = '';
        try {
          const parsed = JSON.parse(detail);
          reason = String(parsed?.error?.message || parsed?.message || '');
        } catch {
          reason = detail;
        }
        throw new ForjaPublishError('vercel_forbidden', `A Vercel não permitiu esta etapa da publicação${reason ? `: ${reason}` : '.'}`.trim(), 403);
      }
      throw new ForjaPublishError(`vercel_http_${res.status}`, `A Vercel recusou a publicação (HTTP ${res.status}). ${detail}`.trim());
    }
    return res.json();
  };

  // Em qual conta/time da Vercel o token pode CRIAR projetos? Listar projetos (o que a conexão
  // confere) não garante criar: token com escopo de outro time, conta pessoal antiga ou papel
  // "Viewer" recebem 403 "You don't have permission to create the project". Por isso, quando a
  // criação é recusada, tentamos os outros lugares a que o token tem acesso, um por um.
  // Resumo (sem segredos) do que a Vercel respondeu, para o suporte saber por que nenhum time apareceu.
  const scopeDiagnostics: string[] = [];
  const listScopes = async (): Promise<{ id: string; label: string }[]> => {
    const read = async (path: string, label: string) => {
      const res = await doFetch(`https://api.vercel.com${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
      scopeDiagnostics.push(`${label} ${res.status}`);
      return res.ok ? res.json().catch(() => ({})) : {};
    };
    const meta = (await read('/v5/user/tokens/current', 'token')) as { token?: { scopes?: { type?: string; teamId?: string }[]; teamId?: string } };
    const me = (await read('/v2/user', 'usuário')) as { user?: { defaultTeamId?: string; username?: string } };
    const teams = ((await read('/v2/teams?limit=50', 'times')) as { teams?: { id?: string; slug?: string; name?: string }[] }).teams || [];
    const ids: string[] = [];
    for (const scope of meta.token?.scopes || []) if (scope.type === 'team' && scope.teamId) ids.push(scope.teamId);
    if (meta.token?.teamId) ids.push(meta.token.teamId);
    if (me.user?.defaultTeamId) ids.push(me.user.defaultTeamId);
    for (const t of teams) if (t.id) ids.push(String(t.id));
    // Último recurso: os projetos que o token enxerga dizem de qual time eles são (accountId "team_...").
    const visible = ((await read('/v9/projects?limit=20', 'projetos')) as { projects?: { accountId?: string }[] }).projects || [];
    for (const project of visible) if (project.accountId && project.accountId.startsWith('team_')) ids.push(project.accountId);
    const out = [...new Set(ids)].map((id) => {
      const t = teams.find((x) => x.id === id);
      return { id, label: String(t?.slug || t?.name || id) };
    });
    scopeDiagnostics.push(`${teams.length} time(s) visível(is)`);
    out.push({ id: '', label: me.user?.username ? `${me.user.username} (conta pessoal)` : 'conta pessoal' });
    return out;
  };

  const publishOnce = async (input: PublishInput): Promise<PublishResult> => {
      if (!token) throw new ForjaPublishError('vercel_not_connected', 'Conecte a sua conta da Vercel para publicar.', 409);
      if (!input.html || !/<html[\s>]/i.test(input.html)) throw new ForjaPublishError('nothing_to_publish', 'O site ainda não tem uma versão compilada para publicar.', 400);

      // 1. Projeto na Vercel (cria na 1ª vez, aberto ao público, sem tela de login da Vercel).
      let projectId = input.vercelProjectId || '';
      if (projectId) {
        try {
          const found = await api(`/v9/projects/${encodeURIComponent(projectId)}`, 'GET', undefined, true);
          if (!found) projectId = '';
        } catch (findError) {
          if (findError instanceof ForjaPublishError && findError.code === 'vercel_forbidden') throw new ScopeForbiddenError(findError.message);
          throw findError;
        }
      }
      if (!projectId) {
        let project: any;
        try {
          const existing = await api(`/v9/projects/${encodeURIComponent(input.projectName)}`, 'GET', undefined, true);
          project = existing ?? (await api('/v10/projects', 'POST', { name: input.projectName, framework: null }));
        } catch (createError) {
          if (createError instanceof ForjaPublishError && createError.code === 'vercel_forbidden') throw new ScopeForbiddenError(createError.message);
          throw createError;
        }
        projectId = String(project.id || '');
        if (!projectId) throw new ForjaPublishError('vercel_project_invalid', 'A Vercel não devolveu o projeto criado.');
        // Deixa o site aberto ao público. Planos que não permitem mexer nisso não devem travar a publicação.
        try {
          await api(`/v9/projects/${encodeURIComponent(projectId)}`, 'PATCH', { ssoProtection: null });
        } catch (patchError) {
          if (patchError instanceof ForjaPublishError && patchError.code === 'vercel_token_refused') throw patchError;
          console.warn('[forja] Não foi possível desligar a proteção do projeto na Vercel; seguindo com a publicação.', patchError instanceof Error ? patchError.message : patchError);
        }
      }

      // 2. Endereço público do projeto (o mesmo a cada nova publicação).
      const readHost = async () => {
        const domains = await api(`/v9/projects/${encodeURIComponent(projectId)}/domains`, 'GET', undefined, true);
        const list: { name?: string }[] = Array.isArray(domains?.domains) ? domains.domains : [];
        return list.find((d) => d.name && !d.name.endsWith('.vercel.app'))?.name || list.find((d) => d.name?.endsWith('.vercel.app'))?.name || `${input.projectName}.vercel.app`;
      };

      // 3. Publica site + robots + sitemap e espera ficar no ar (site estático: poucos segundos).
      const deploy = async (host: string) => {
        const pack = buildDeployFiles({ html: input.html, host, projectName: input.projectName, routes: input.routes });
        const deployment = await api('/v13/deployments', 'POST', {
          name: input.projectName,
          project: projectId,
          target: 'production',
          files: pack.files,
          projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null, devCommand: null },
          meta: { frocForja: '1' },
        });
        const deploymentId = String(deployment.id || deployment.uid || '');
        if (!deploymentId) throw new ForjaPublishError('vercel_deploy_invalid', 'A Vercel não devolveu a publicação.');
        let state = String(deployment.readyState || deployment.status || '');
        const started = Date.now();
        while (state !== 'READY') {
          if (['ERROR', 'CANCELED'].includes(state)) throw new ForjaPublishError('vercel_deploy_failed', 'A Vercel não conseguiu publicar o site. Tente de novo.');
          if (Date.now() - started > maxWait) throw new ForjaPublishError('vercel_deploy_slow', 'A Vercel está demorando para publicar. Tente de novo em 1 minuto.', 504);
          await sleep(2000);
          const d = await api(`/v13/deployments/${encodeURIComponent(deploymentId)}`);
          state = String(d.readyState || d.status || '');
        }
        return { deploymentId, pack };
      };

      let host = await readHost();
      let result = await deploy(host);
      // Projeto novo: a Vercel só confirma o endereço depois da 1ª publicação. Se mudou, publica de novo com o certo (SEO).
      const confirmed = await readHost();
      if (confirmed !== host) {
        host = confirmed;
        result = await deploy(host);
      }

      // 4. Avisa Bing e outros buscadores (IndexNow). O Google descobre pelo sitemap.xml do robots.txt.
      let searchEnginesNotified = false;
      try {
        const ping = await doFetch('https://api.indexnow.org/indexnow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host, key: result.pack.key, keyLocation: `${result.pack.origin}/${result.pack.key}.txt`, urlList: result.pack.urls }),
          signal: AbortSignal.timeout(8_000),
        });
        searchEnginesNotified = ping.ok || ping.status === 202;
      } catch (pingError) {
        console.warn('[forja] IndexNow indisponível agora; o site foi publicado mesmo assim.', pingError instanceof Error ? pingError.message : pingError);
      }
      return { url: `https://${host}`, vercelProjectId: projectId, deploymentId: result.deploymentId, teamId: team || null, searchEnginesNotified };
  };

  return {
    configured: Boolean(token),
    async publish(input: PublishInput): Promise<PublishResult> {
      const firstTeam = team;
      try {
        return await publishOnce(input);
      } catch (error) {
        if (!(error instanceof ScopeForbiddenError)) throw error;
        const tried: string[] = [];
        const all = await listScopes();
        tried.push(all.find((x) => x.id === firstTeam)?.label || firstTeam || 'conta pessoal');
        const scopes = all.filter((scope) => scope.id !== firstTeam);
        for (const scope of scopes) {
          team = scope.id;
          try {
            // O projeto salvo (se havia) era do outro lugar; aqui ele é criado de novo.
            return await publishOnce({ ...input, vercelProjectId: null });
          } catch (retryError) {
            if (!(retryError instanceof ScopeForbiddenError)) throw retryError;
            tried.push(scope.label);
          }
        }
        team = firstTeam;
        throw new ForjaPublishError(
          'vercel_cannot_create_project',
          `A Vercel não deixa esse token criar projetos (tentei: ${[...new Set(tried)].join(', ')}). Crie um token novo em vercel.com/account/tokens: em "Scope" escolha o seu time (o que termina em "-projects"), sem restrição de projeto, e conecte de novo aqui. [diagnóstico: ${scopeDiagnostics.join(', ')}]`,
          403,
        );
      }
    },
  };
}

/**
 * Confere o token que a pessoa colou e descobre a conta (e o time, se o token for de um time).
 * Nunca devolve o token: só o nome da conta.
 */
export async function verifyVercelToken(token: string, fetchImpl?: FetchLike): Promise<{ username: string; teamId: string | null }> {
  const clean = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(clean)) throw new ForjaPublishError('vercel_token_invalid', 'Esse não parece um token da Vercel. Copie o token inteiro, sem espaços.', 400);
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init) as never);
  const get = (path: string) =>
    doFetch(`https://api.vercel.com${path}`, { headers: { Authorization: `Bearer ${clean}` }, signal: AbortSignal.timeout(20_000) });
  const json = async (res: { ok: boolean; json(): Promise<any> }) => (res.ok ? res.json().catch(() => ({})) : {});
  const refused = (status: number) => status === 401 || status === 403;

  // Contas novas da Vercel são "times" (ex.: fulano-1234s-projects). Token de time devolve
  // 404 "User not found" em /v2/user — isso NÃO quer dizer token inválido.
  const me = await get('/v2/user');
  if (me.status === 401) throw new ForjaPublishError('vercel_token_refused', 'A Vercel recusou esse token. Gere um novo e cole de novo.', 400);
  const user = ((await json(me)) as { user?: { username?: string; name?: string; email?: string; defaultTeamId?: string } }).user || {};

  // De quais times o token pode cuidar (metadados do próprio token e lista de times).
  const candidates: string[] = [];
  const meta = (await json(await get('/v5/user/tokens/current'))) as { token?: { scopes?: { type?: string; teamId?: string }[]; teamId?: string } };
  for (const scope of meta.token?.scopes || []) if (scope.type === 'team' && scope.teamId) candidates.push(scope.teamId);
  if (meta.token?.teamId) candidates.push(meta.token.teamId);
  if (user.defaultTeamId) candidates.push(user.defaultTeamId);
  const teamsRes = await get('/v2/teams?limit=20');
  const teams = (((await json(teamsRes)) as { teams?: { id?: string; slug?: string; name?: string }[] }).teams || []).filter((t) => t.id);
  for (const t of teams) candidates.push(String(t.id));

  // Onde ele consegue criar projetos. Contas novas da Vercel guardam os projetos no time padrão
  // (a conta "pessoal" pode listar, mas recusar criar com 403), então o time do token vem primeiro.
  const preferred = [...new Set(candidates)].filter((id) =>
    (meta.token?.scopes || []).some((scope) => scope.teamId === id) || meta.token?.teamId === id || user.defaultTeamId === id,
  );
  const others = [...new Set(candidates)].filter((id) => !preferred.includes(id));
  let teamId: string | null = null;
  let lastStatus = 0;
  let personalOk = false;
  for (const id of preferred) {
    const probe = await get(`/v9/projects?limit=1&teamId=${encodeURIComponent(id)}`);
    lastStatus = probe.status;
    if (probe.ok) {
      teamId = id;
      break;
    }
  }
  if (!teamId) {
    const personal = await get('/v9/projects?limit=1');
    lastStatus = personal.status;
    personalOk = personal.ok;
  }
  if (!teamId && !personalOk) {
    for (const id of others) {
      const probe = await get(`/v9/projects?limit=1&teamId=${encodeURIComponent(id)}`);
      lastStatus = probe.status;
      if (probe.ok) {
        teamId = id;
        break;
      }
    }
    if (!teamId) {
      if (refused(lastStatus) || refused(me.status)) {
        throw new ForjaPublishError('vercel_token_scope', 'Esse token não tem permissão para criar projetos. Ao criar o token, em "Scope" escolha a sua conta (ou o seu time "...-projects") e tente de novo.', 400);
      }
      throw new ForjaPublishError('vercel_unavailable', `A Vercel não confirmou o token agora (HTTP ${lastStatus}). Confira se copiou o token inteiro e tente de novo.`, 502);
    }
  }
  const team = teams.find((t) => t.id === teamId);
  return { username: String(user.username || user.name || team?.slug || team?.name || teams[0]?.slug || user.email || 'sua conta'), teamId };
}
