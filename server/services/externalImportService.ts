import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 900_000;
const MAX_EXTRACTED_CHARACTERS = 700_000;
const MAX_GITHUB_TREE_ITEMS = 500;

type ImportType = 'url' | 'github';

export interface ExternalImportResult {
  type: ImportType;
  sourceUrl: string;
  finalUrl: string;
  title: string;
  summary: string;
  content: string;
  mimeType: 'text/plain' | 'application/json';
  structure: string[];
  pageSignals?: ExternalPageSignals;
  fetchedAt: string;
}

export interface ExternalPageSignals {
  httpStatus: number;
  contentType: string;
  isHtml: boolean;
  language: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  metaRobots: string[];
  headings: { h1: string[]; h2: string[]; h3: string[] };
  links: string[];
  images: { total: number; missingAltAttribute: number };
  forms: { total: number; insecureActions: number };
  scripts: number;
  wordCount: number;
  likelyClientRendered: boolean;
  securityHeaders: {
    contentSecurityPolicy: string | null;
    strictTransportSecurity: string | null;
    xContentTypeOptions: string | null;
    xFrameOptions: string | null;
    referrerPolicy: string | null;
    permissionsPolicy: string | null;
  };
}

export class ExternalImportError extends Error {
  readonly code: string;
  readonly status: number;
  readonly remoteStatus?: number;

  constructor(code: string, message: string, status = 400, remoteStatus?: number) {
    super(message);
    this.name = 'ExternalImportError';
    this.code = code;
    this.status = status;
    this.remoteStatus = remoteStatus;
  }
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  const version = isIP(normalized);

  if (version === 4) return isBlockedIpv4(normalized);
  if (version !== 6) return true;

  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }

  const ipv4Mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return ipv4Mapped ? isBlockedIpv4(ipv4Mapped[1]) : false;
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');

  if (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    throw new ExternalImportError(
      'private_destination',
      'Endereços locais ou internos não podem ser importados.'
    );
  }

  if (isIP(normalized)) {
    if (isBlockedIpAddress(normalized)) {
      throw new ExternalImportError(
        'private_destination',
        'O endereço informado aponta para uma rede não permitida.'
      );
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(normalized, { all: true, verbatim: true });
  } catch {
    throw new ExternalImportError(
      'host_not_found',
      'Não foi possível localizar o domínio informado.',
      422
    );
  }

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedIpAddress(address))
  ) {
    throw new ExternalImportError(
      'private_destination',
      'O domínio informado resolve para uma rede não permitida.'
    );
  }
}

function parsePublicHttpUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ExternalImportError('invalid_url', 'Informe uma URL completa e válida.');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new ExternalImportError(
      'invalid_protocol',
      'Somente endereços HTTP ou HTTPS podem ser importados.'
    );
  }

  if (parsed.username || parsed.password) {
    throw new ExternalImportError(
      'credentials_not_allowed',
      'URLs contendo usuário ou senha não são permitidas.'
    );
  }

  const port = parsed.port;
  if (port && port !== '80' && port !== '443') {
    throw new ExternalImportError(
      'port_not_allowed',
      'A URL utiliza uma porta de rede não permitida.'
    );
  }

  parsed.hash = '';
  return parsed;
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) {
    throw new ExternalImportError('empty_response', 'O endereço retornou uma resposta vazia.', 422);
  }

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new ExternalImportError(
      'response_too_large',
      'O conteúdo excede o limite de 900 KB para importação.',
      413
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ExternalImportError(
        'response_too_large',
        'O conteúdo excede o limite de 900 KB para importação.',
        413
      );
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function safeFetch(
  initialUrl: URL,
  options: {
    headers?: Record<string, string>;
    allowedHosts?: Set<string>;
    timeoutMs?: number;
  } = {}
): Promise<{ response: Response; bytes: Uint8Array; finalUrl: URL }> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHostname(currentUrl.hostname);

    if (
      options.allowedHosts &&
      !options.allowedHosts.has(currentUrl.hostname.toLowerCase())
    ) {
      throw new ExternalImportError(
        'redirect_not_allowed',
        'O serviço tentou redirecionar para um domínio não permitido.'
      );
    }

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(
          Math.max(500, Math.min(FETCH_TIMEOUT_MS, options.timeoutMs || FETCH_TIMEOUT_MS))
        ),
        headers: {
          Accept: 'text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1',
          'User-Agent': 'FrocIA-Importer/1.0',
          ...options.headers
        }
      });
    } catch (error) {
      if (error instanceof ExternalImportError) throw error;
      throw new ExternalImportError(
        'fetch_failed',
        'Não foi possível acessar o endereço informado.',
        422
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new ExternalImportError('invalid_redirect', 'O endereço retornou um redirecionamento inválido.', 422);
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new ExternalImportError('too_many_redirects', 'O endereço excedeu o limite de redirecionamentos.', 422);
      }
      currentUrl = parsePublicHttpUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new ExternalImportError(
        'remote_error',
        `O endereço respondeu com o status HTTP ${response.status}.`,
        response.status === 404 ? 404 : 422,
        response.status
      );
    }

    return {
      response,
      bytes: await readLimitedBody(response),
      finalUrl: currentUrl
    };
  }

  throw new ExternalImportError('fetch_failed', 'Não foi possível concluir a importação.', 422);
}

function decodeHtmlEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|canvas|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/?(p|div|section|article|main|header|footer|nav|aside|h[1-6]|li|tr|br)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_CHARACTERS);
}

function extractTagText(html: string, expression: RegExp): string[] {
  return Array.from(html.matchAll(expression))
    .map((match) => stripHtml(match[1] || ''))
    .filter(Boolean);
}

function extractAttribute(tag: string, attribute: string): string | null {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(
    new RegExp(`\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  );
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim() || null;
}

function safeText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = (value || '')
    .normalize('NFKC')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return normalized || null;
}

function extractMetaContent(html: string, name: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const metaName = extractAttribute(tag, 'name')?.toLowerCase();
    const property = extractAttribute(tag, 'property')?.toLowerCase();
    if (metaName === name.toLowerCase() || property === name.toLowerCase()) {
      return safeText(extractAttribute(tag, 'content'), 500);
    }
  }
  return null;
}

function extractCanonicalUrl(html: string, baseUrl: URL): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (extractAttribute(tag, 'rel') || '').toLowerCase().split(/\s+/);
    if (!rel.includes('canonical')) continue;
    const href = extractAttribute(tag, 'href');
    if (!href) return null;
    try {
      const url = new URL(href, baseUrl);
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

function extractPublicLinks(html: string, baseUrl: URL): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = extractAttribute(match[0], 'href');
    if (!href) continue;
    try {
      const url = new URL(href, baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      url.hash = '';
      if (url.toString().length > 500) continue;
      links.add(url.toString());
      if (links.size >= 100) break;
    } catch {
      // Links inválidos não são usados como destino nem evidência.
    }
  }
  return [...links];
}

function securityHeaders(response: Response): ExternalPageSignals['securityHeaders'] {
  return {
    contentSecurityPolicy: safeText(response.headers.get('content-security-policy'), 1000),
    strictTransportSecurity: safeText(response.headers.get('strict-transport-security'), 500),
    xContentTypeOptions: safeText(response.headers.get('x-content-type-options'), 100),
    xFrameOptions: safeText(response.headers.get('x-frame-options'), 100),
    referrerPolicy: safeText(response.headers.get('referrer-policy'), 200),
    permissionsPolicy: safeText(response.headers.get('permissions-policy'), 1000)
  };
}

function buildPageSignals(input: {
  response: Response;
  html: string;
  content: string;
  finalUrl: URL;
  contentType: string;
}): ExternalPageSignals {
  const htmlTag = input.html.match(/<html\b[^>]*>/i)?.[0] || '';
  const images = Array.from(input.html.matchAll(/<img\b[^>]*>/gi));
  const forms = Array.from(input.html.matchAll(/<form\b[^>]*>/gi));
  const scripts = Array.from(input.html.matchAll(/<script\b[^>]*>/gi)).length;
  const wordCount = (input.content.match(/[\p{L}\p{N}]+/gu) || []).length;
  return {
    httpStatus: input.response.status,
    contentType: input.contentType.split(';')[0].trim(),
    isHtml: true,
    language: safeText(extractAttribute(htmlTag, 'lang'), 40),
    metaDescription: extractMetaContent(input.html, 'description'),
    canonicalUrl: extractCanonicalUrl(input.html, input.finalUrl),
    metaRobots: (extractMetaContent(input.html, 'robots') || '')
      .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
    headings: {
      h1: extractTagText(input.html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).slice(0, 20),
      h2: extractTagText(input.html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).slice(0, 30),
      h3: extractTagText(input.html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi).slice(0, 30)
    },
    links: extractPublicLinks(input.html, input.finalUrl),
    images: {
      total: images.length,
      missingAltAttribute: images.filter((match) => extractAttribute(match[0], 'alt') === null).length
    },
    forms: {
      total: forms.length,
      insecureActions: forms.filter((match) => {
        const action = extractAttribute(match[0], 'action');
        if (!action) return false;
        try { return new URL(action, input.finalUrl).protocol !== 'https:'; } catch { return true; }
      }).length
    },
    scripts,
    wordCount,
    likelyClientRendered: wordCount < 80 && scripts >= 3,
    securityHeaders: securityHeaders(input.response)
  };
}

async function importWebPage(sourceUrl: string, timeoutMs?: number): Promise<ExternalImportResult> {
  const parsed = parsePublicHttpUrl(sourceUrl);
  const { response, bytes, finalUrl } = await safeFetch(parsed, { timeoutMs });
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  if (!/(text\/|application\/(json|xml|xhtml\+xml))/.test(contentType)) {
    throw new ExternalImportError(
      'unsupported_content',
      'A URL não retornou uma página ou documento textual compatível.',
      415
    );
  }

  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const isHtml = contentType.includes('html') || /<html[\s>]/i.test(decoded);
  const title = isHtml
    ? extractTagText(decoded, /<title[^>]*>([\s\S]*?)<\/title>/gi)[0] || finalUrl.hostname
    : finalUrl.pathname.split('/').filter(Boolean).at(-1) || finalUrl.hostname;
  const headings = isHtml
    ? extractTagText(decoded, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi).slice(0, 30)
    : [];
  const content = isHtml ? stripHtml(decoded) : decoded.slice(0, MAX_EXTRACTED_CHARACTERS).trim();

  if (content.length < 20) {
    throw new ExternalImportError(
      'insufficient_content',
      'A página não apresentou conteúdo textual suficiente para análise.',
      422
    );
  }

  return {
    type: 'url',
    sourceUrl: parsed.toString(),
    finalUrl: finalUrl.toString(),
    title: title.slice(0, 200),
    summary: `Página pública importada com ${content.length.toLocaleString('pt-BR')} caracteres de texto.`,
    content: [`Fonte: ${finalUrl.toString()}`, `Título: ${title}`, '', content].join('\n'),
    mimeType: 'text/plain',
    structure: [...new Set(headings)].slice(0, 20),
    pageSignals: isHtml
      ? buildPageSignals({ response, html: decoded, content, finalUrl, contentType })
      : {
          httpStatus: response.status,
          contentType: contentType.split(';')[0].trim(),
          isHtml: false,
          language: null,
          metaDescription: null,
          canonicalUrl: null,
          metaRobots: [],
          headings: { h1: [], h2: [], h3: [] },
          links: [],
          images: { total: 0, missingAltAttribute: 0 },
          forms: { total: 0, insecureActions: 0 },
          scripts: 0,
          wordCount: (content.match(/[\p{L}\p{N}]+/gu) || []).length,
          likelyClientRendered: false,
          securityHeaders: securityHeaders(response)
        },
    fetchedAt: new Date().toISOString()
  };
}

function parseGithubRepositoryUrl(sourceUrl: string): { owner: string; repository: string; normalizedUrl: string } {
  const parsed = parsePublicHttpUrl(sourceUrl);
  if (!['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) {
    throw new ExternalImportError(
      'invalid_github_host',
      'Informe uma URL pública do domínio github.com.'
    );
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new ExternalImportError(
      'invalid_repository_url',
      'Informe a URL completa de um repositório público do GitHub.'
    );
  }

  const owner = segments[0];
  const repository = segments[1].replace(/\.git$/i, '');
  const safeSegment = /^[A-Za-z0-9_.-]{1,100}$/;
  if (!safeSegment.test(owner) || !safeSegment.test(repository)) {
    throw new ExternalImportError('invalid_repository_url', 'A URL do repositório é inválida.');
  }

  return {
    owner,
    repository,
    normalizedUrl: `https://github.com/${owner}/${repository}`
  };
}

async function githubApiJson<T>(path: string): Promise<T> {
  const apiUrl = parsePublicHttpUrl(`https://api.github.com${path}`);
  const token = process.env.GITHUB_TOKEN?.trim();
  const { bytes } = await safeFetch(apiUrl, {
    allowedHosts: new Set(['api.github.com']),
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new ExternalImportError(
      'invalid_github_response',
      'O GitHub retornou uma resposta inválida.',
      502
    );
  }
}

async function importGithubRepository(sourceUrl: string): Promise<ExternalImportResult> {
  const { owner, repository, normalizedUrl } = parseGithubRepositoryUrl(sourceUrl);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const metadata = await githubApiJson<{
    full_name: string;
    description: string | null;
    default_branch: string;
    language: string | null;
    stargazers_count: number;
    forks_count: number;
    topics?: string[];
    html_url: string;
    private: boolean;
    archived: boolean;
    license?: { spdx_id?: string } | null;
  }>(repoPath);

  if (metadata.private) {
    throw new ExternalImportError(
      'private_repository',
      'Somente repositórios públicos podem ser importados.',
      403
    );
  }

  const tree = await githubApiJson<{
    tree?: Array<{ path?: string; type?: string; size?: number }>;
    truncated?: boolean;
  }>(`${repoPath}/git/trees/${encodeURIComponent(metadata.default_branch)}?recursive=1`);

  let readmeText = '';
  try {
    const readme = await githubApiJson<{ content?: string; encoding?: string }>(`${repoPath}/readme`);
    if (readme.encoding === 'base64' && readme.content) {
      readmeText = Buffer.from(readme.content.replace(/\s/g, ''), 'base64')
        .toString('utf8')
        .slice(0, 180_000);
    }
  } catch (error) {
    if (!(error instanceof ExternalImportError) || error.status !== 404) throw error;
  }

  const files = (tree.tree || [])
    .filter((item) => item.type === 'blob' && item.path)
    .slice(0, MAX_GITHUB_TREE_ITEMS)
    .map((item) => ({ path: item.path!, size: item.size ?? null }));

  const document = {
    repository: metadata.full_name,
    url: metadata.html_url || normalizedUrl,
    description: metadata.description,
    defaultBranch: metadata.default_branch,
    primaryLanguage: metadata.language,
    topics: metadata.topics || [],
    stars: metadata.stargazers_count,
    forks: metadata.forks_count,
    license: metadata.license?.spdx_id || null,
    archived: metadata.archived,
    treeTruncatedByGithub: Boolean(tree.truncated),
    filesReturned: files.length,
    files,
    readme: readmeText || null
  };
  const content = JSON.stringify(document, null, 2).slice(0, MAX_EXTRACTED_CHARACTERS);

  return {
    type: 'github',
    sourceUrl: normalizedUrl,
    finalUrl: metadata.html_url || normalizedUrl,
    title: metadata.full_name,
    summary: `Repositório público importado com ${files.length} arquivos listados${
      tree.truncated ? ' (árvore parcial)' : ''
    }.`,
    content,
    mimeType: 'application/json',
    structure: files.slice(0, 30).map((file) => file.path),
    fetchedAt: new Date().toISOString()
  };
}

export class ExternalImportService {
  static async import(input: { type: ImportType; url: string; timeoutMs?: number }): Promise<ExternalImportResult> {
    return input.type === 'github'
      ? importGithubRepository(input.url)
      : importWebPage(input.url, input.timeoutMs);
  }
}
