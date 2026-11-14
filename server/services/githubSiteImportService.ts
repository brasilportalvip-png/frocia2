import { buildSourceDigest } from './projectSourceDigest.js';
import { unzipSync } from 'fflate';
import { ExternalImportError, parseGithubRepositoryUrl } from './externalImportService.js';
import { bundleStaticSite, normalizeFiles, type StaticSiteResult } from './staticSiteBundler.js';
import { bundleReactProject } from './reactProjectBundler.js';
import { NpmInstaller, parseLock } from './npmInstaller.js';

const ZIP_TIMEOUT_MS = 40_000;
const META_TIMEOUT_MS = 12_000;
const MAX_ZIP_BYTES = 40_000_000;
const MAX_UNZIPPED_TOTAL_BYTES = 120_000_000;
const MAX_SINGLE_FILE_BYTES = 8_000_000;

function githubHeaders(accept: string): Record<string, string> {
  const token = (process.env.GITHUB_TOKEN || process.env.GITHUB_READ_TOKEN || '').trim();
  return {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'froc-ia-import',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchWithTimeout(url: string, accept: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: githubHeaders(accept), redirect: 'follow', signal: controller.signal });
  } catch {
    throw new ExternalImportError('github_unreachable', 'Não foi possível falar com o GitHub agora. Tente novamente em instantes.', 503);
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ExternalImportError('github_zip_too_large', 'O repositório é grande demais para abrir no editor (limite de 40 MB). Baixe o ZIP e use a importação de arquivos.', 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export interface GithubSiteImportResult extends StaticSiteResult {
  /** Resumo do código para a conversa saber do que se trata (sem arquivos .env). */
  sourceDigest: string;
  repository: string;
  sourceUrl: string;
  branch: string;
  fullDownloadUrl: string;
}

export interface LoadedGithubRepo {
  files: Record<string, Uint8Array>;
  ctx: { owner: string; repo: string; branch: string };
  repository: string;
  sourceUrl: string;
  branch: string;
  fullDownloadUrl: string;
}

export async function loadGithubRepo(sourceUrl: string): Promise<LoadedGithubRepo> {
  const { owner, repository, normalizedUrl } = parseGithubRepositoryUrl(sourceUrl);
  const repoPath = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;

  const metaResponse = await fetchWithTimeout(repoPath, 'application/vnd.github+json', META_TIMEOUT_MS);
  if (metaResponse.status === 404) {
    throw new ExternalImportError('github_repository_not_found', 'Repositório não encontrado. Confirme o endereço e se ele é público.', 404, 404);
  }
  if (!metaResponse.ok) {
    throw new ExternalImportError('github_api_unavailable', 'O GitHub recusou a leitura agora (possível limite da API). Tente novamente em alguns minutos.', 503, metaResponse.status);
  }
  const meta = (await metaResponse.json()) as { default_branch?: string; private?: boolean; full_name?: string };
  if (meta.private) {
    throw new ExternalImportError('private_repository', 'Somente repositórios públicos podem ser importados.', 403);
  }
  const branch = meta.default_branch || 'main';

  const zipResponse = await fetchWithTimeout(`${repoPath}/zipball/${encodeURIComponent(branch)}`, 'application/vnd.github+json', ZIP_TIMEOUT_MS);
  if (!zipResponse.ok) {
    throw new ExternalImportError('github_zip_failed', 'Não foi possível baixar o repositório completo agora.', 502, zipResponse.status);
  }
  const zipBytes = await readCapped(zipResponse, MAX_ZIP_BYTES);

  let unzippedTotal = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes, {
      filter: (file) => {
        if (file.name.endsWith('/')) return false;
        if (/(^|\/)(?:node_modules|\.git)\//.test(file.name)) return false;
        if (file.originalSize > MAX_SINGLE_FILE_BYTES) return false;
        unzippedTotal += file.originalSize;
        if (unzippedTotal > MAX_UNZIPPED_TOTAL_BYTES) {
          throw new ExternalImportError('github_zip_too_large', 'O repositório é grande demais para abrir no editor.', 413);
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ExternalImportError) throw error;
    throw new ExternalImportError('github_zip_invalid', 'O arquivo baixado do GitHub não pôde ser lido.', 502);
  }

  return {
    files,
    ctx: { owner, repo: repository, branch },
    repository: meta.full_name || `${owner}/${repository}`,
    sourceUrl: normalizedUrl,
    branch,
    fullDownloadUrl: `${normalizedUrl}/archive/refs/heads/${encodeURIComponent(branch)}.zip`,
  };
}

/** Abre o projeto: site estático é montado direto; React/Vite/TS é compilado no servidor. */
export async function compileRepoFiles(
  files: Record<string, Uint8Array>,
  ctx: { owner: string; repo: string; branch: string },
  normalized: ReturnType<typeof normalizeFiles>,
): Promise<StaticSiteResult> {
  let result = bundleStaticSite(files, ctx, { normalized });
  // Projeto React/Vite/TypeScript: compila no servidor e abre pronto no editor.
  if (result.report.kind === 'build_required' && result.report.entry) {
    const entryDir = result.report.entry.includes('/') ? result.report.entry.slice(0, result.report.entry.lastIndexOf('/')) : '';
    const lockBytes = normalized.files.get(entryDir ? `${entryDir}/package-lock.json` : 'package-lock.json') || normalized.files.get('package-lock.json');
    const lock = lockBytes ? parseLock(new TextDecoder().decode(lockBytes)) : null;
    // Com package-lock.json: instala os pacotes de verdade (como um build normal). Sem ele: esm.sh.
    const installer = lock ? new NpmInstaller(lock) : undefined;
    let compiled: Awaited<ReturnType<typeof bundleReactProject>>;
    try {
      compiled = await bundleReactProject(normalized.files, ctx, result.report.entry, { installer });
    } finally {
      await installer?.cleanup();
    }
    result = compiled.html
      ? { ...compiled, report: { ...compiled.report, protectedFilesSkipped: normalized.skipped } }
      : { ...result, report: { ...result.report, kind: 'build_failed', message: `${compiled.report.message} Baixe o ZIP completo para usar o projeto.` } };
  }
  return result;
}

export async function importGithubSite(sourceUrl: string): Promise<GithubSiteImportResult> {
  const loaded = await loadGithubRepo(sourceUrl);
  const normalized = normalizeFiles(loaded.files);
  const result = await compileRepoFiles(loaded.files, loaded.ctx, normalized);
  return {
    ...result,
    sourceDigest: buildSourceDigest(normalized.files),
    repository: loaded.repository,
    sourceUrl: loaded.sourceUrl,
    branch: loaded.branch,
    fullDownloadUrl: loaded.fullDownloadUrl,
  };
}

/** Limite do ZIP enviado pelo navegador (o corpo da requisição na Vercel vai até ~4,5 MB). */
export const MAX_UPLOADED_ZIP_BYTES = 3_300_000;

/**
 * Abre no editor um projeto enviado em ZIP: mesmo caminho do GitHub (site estático é
 * montado direto; React/Vite/TypeScript é compilado no servidor).
 */
export async function importZipSite(fileName: string, zipBytes: Uint8Array): Promise<GithubSiteImportResult> {
  if (zipBytes.byteLength > MAX_UPLOADED_ZIP_BYTES) {
    throw new ExternalImportError('zip_too_large', 'O ZIP passa de 3,3 MB. Tire as pastas node_modules, dist e imagens grandes, ou publique no GitHub e importe pelo link.', 413);
  }
  let unzippedTotal = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes, {
      filter: (file) => {
        if (file.name.endsWith('/')) return false;
        if (/(^|\/)(?:node_modules|\.git|dist|build)\//.test(file.name)) return false;
        if (/(^|\/)\.env(?:\.|$)/i.test(file.name) && !/\.example$/i.test(file.name)) return false;
        if (file.originalSize > MAX_SINGLE_FILE_BYTES) return false;
        unzippedTotal += file.originalSize;
        if (unzippedTotal > MAX_UNZIPPED_TOTAL_BYTES) {
          throw new ExternalImportError('zip_too_large', 'O ZIP é grande demais para abrir no editor.', 413);
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ExternalImportError) throw error;
    throw new ExternalImportError('zip_invalid', 'Não consegui ler este ZIP. Confira se o arquivo não está corrompido.', 400);
  }
  if (!Object.keys(files).length) {
    throw new ExternalImportError('zip_empty', 'O ZIP não tem arquivos de site.', 400);
  }
  const name = (fileName || 'projeto.zip').replace(/\.zip$/i, '').replace(/[^\w .-]+/g, '').slice(0, 80) || 'projeto';
  const ctx = { owner: 'zip', repo: name, branch: 'local' };
  const normalized = normalizeFiles(files);
  const result = await compileRepoFiles(files, ctx, normalized);
  return {
    ...result,
    sourceDigest: buildSourceDigest(normalized.files),
    repository: name,
    sourceUrl: '',
    branch: 'local',
    fullDownloadUrl: '',
  };
}
