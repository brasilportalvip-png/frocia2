import { DevelopmentError, LIMITS } from './archive.js';

export function publicRepository(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new DevelopmentError('invalid_repository', 'Informe a URL completa do GitHub.'); }
  const match = parsed.pathname.match(/^\/([\w.-]{1,100})\/([\w.-]{1,100})(?:\.git)?\/?$/);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || !match) {
    throw new DevelopmentError('invalid_repository', 'Use https://github.com/conta/repositorio, sem parâmetros nem credenciais.');
  }
  return { owner: match[1], repository: match[2].replace(/\.git$/, '') };
}
export async function fixedDownload(url: URL, allowedHosts: Set<string>, maxBytes: number, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  for (let i = 0; i < 4; i++) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowedHosts.has(url.hostname)) throw new DevelopmentError('download_host_denied', 'Destino de download não autorizado.');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      headers: { 'User-Agent': 'FrocIA-Development/1', Accept: 'application/vnd.github+json' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new DevelopmentError('download_redirect_invalid', 'Redirecionamento sem endereço.');
      url = new URL(location, url); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new DevelopmentError('public_repository_unavailable', `Download recusado (HTTP ${response.status}). Repositórios privados exigem autorização separada.`, response.status === 404 ? 404 : 502); }
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new DevelopmentError('download_size_limit', 'Download excede a quota.', 413); }
    const reader = response.body?.getReader(); if (!reader) throw new DevelopmentError('empty_download', 'Download sem conteúdo.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length;
        if (size > maxBytes || Date.now() > deadline) throw new DevelopmentError('download_limit', 'Download excedeu o tamanho ou tempo autorizado.', 413);
        chunks.push(next.value); }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks);
  }
  throw new DevelopmentError('download_redirect_limit', 'Excesso de redirecionamentos.');
}
export async function publicGithubArchive(sourceUrl: string) {
  const { owner, repository } = publicRepository(sourceUrl), hosts = new Set(['api.github.com']);
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const metadata = JSON.parse((await fixedDownload(new URL(api), hosts, 256_000)).toString());
  if (metadata.private !== false || typeof metadata.default_branch !== 'string') throw new DevelopmentError('repository_not_public', 'A importação sem conexão aceita apenas repositório público.');
  const ref = JSON.parse((await fixedDownload(new URL(`${api}/git/ref/heads/${encodeURIComponent(metadata.default_branch)}`), hosts, 32_000)).toString());
  const commitSha = ref.object?.sha;
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new DevelopmentError('repository_commit_invalid', 'O GitHub não confirmou a versão de origem.');
  const archive = await fixedDownload(new URL(`${api}/zipball/${commitSha}`), new Set(['api.github.com', 'codeload.github.com']), LIMITS.archive);
  return { archive, source: { kind: 'github' as const, url: `https://github.com/${owner}/${repository}`, owner, repository, commitSha, branch: metadata.default_branch } };
}
