/**
 * Transforma os arquivos de um repositório de site estático em UM documento
 * HTML autossuficiente, que o editor da Froc.IA consegue abrir, visualizar e
 * alterar. Função pura: sem rede, sem disco e sem dependências externas.
 *
 * - CSS e JS locais entram dentro do HTML.
 * - Imagens e fontes pequenas entram como data URI; as demais apontam para a CDN
 *   pública do repositório (jsDelivr), então nada fica "faltando" na tela.
 * - Tudo o que não puder ser trazido é listado no relatório, nunca omitido.
 */

export interface StaticSiteContext {
  owner: string;
  repo: string;
  branch: string;
}

export interface StaticSiteReport {
  kind: 'static' | 'build_required' | 'no_html' | 'react_bundled' | 'build_failed';
  bundle?: {
    compiledFiles: number;
    packages: string[];
    missingEnv: string[];
    notes: string[];
  };
  entry: string | null;
  totalFiles: number;
  inlined: { css: number; js: number; assetsAsDataUri: number };
  assetsViaCdn: { count: number; examples: string[] };
  otherPages: string[];
  missingReferences: string[];
  protectedFilesSkipped: number;
  htmlBytes: number;
  complete: boolean;
  needsBuildReason: string | null;
  message: string;
}

export interface StaticSiteResult {
  html: string | null;
  title: string;
  report: StaticSiteReport;
}

const INLINE_FILE_MAX_BYTES = 150_000;
const OUTPUT_BUDGETS = [2_500_000, 800_000, 0];
const MAX_OUTPUT_BYTES = 4_200_000;
const MAX_CSS_IMPORT_DEPTH = 3;

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  json: 'application/json', css: 'text/css', js: 'text/javascript', pdf: 'application/pdf',
};

const BUILD_SOURCE_EXT = /\.(?:tsx|ts|jsx|vue|svelte)(?:[?#]|$)/i;

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = lower.split('/');
  const base = segments[segments.length - 1] || '';
  return (
    segments.includes('.git') ||
    segments.includes('node_modules') ||
    /^\.env(?:\.|$)/.test(base) ||
    /^(?:id_rsa|id_ed25519)(?:\.|$)/.test(base) ||
    /\.(?:key|pem|p12|pfx|keystore|jks)$/.test(base) ||
    /(?:^|[._-])(?:credentials?|secrets?)(?:[._-]|$)/.test(base)
  );
}

function extOf(path: string): string {
  const base = path.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function dirOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index) : '';
}

export function joinPath(dir: string, relative: string): string | null {
  const parts = (dir ? dir.split('/') : []).concat(relative.split('/'));
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function getAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function setAttr(tag: string, name: string, value: string): string {
  const safe = value.replace(/"/g, '&quot;');
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  return pattern.test(tag) ? tag.replace(pattern, `$1"${safe}"`) : tag;
}

function isExternalRef(ref: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref.trim());
}

function stripQuery(ref: string): string {
  return ref.split('#')[0].split('?')[0];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeFiles(input: Record<string, Uint8Array>): { files: Map<string, Uint8Array>; skipped: number } {
  const entries = Object.keys(input)
    .map((path) => path.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((path) => path && !path.endsWith('/'));
  const firstSegments = new Set(entries.map((path) => path.split('/')[0]));
  const stripPrefix = firstSegments.size === 1 && entries.every((path) => path.includes('/'));
  const files = new Map<string, Uint8Array>();
  let skipped = 0;
  for (const original of Object.keys(input)) {
    let path = original.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.endsWith('/')) continue;
    if (stripPrefix) path = path.split('/').slice(1).join('/');
    if (!path) continue;
    if (isSensitivePath(path)) {
      skipped += 1;
      continue;
    }
    files.set(path, input[original]);
  }
  return { files, skipped };
}

function findEntryCandidates(files: Map<string, Uint8Array>): string[] {
  const preferred = [
    'index.html', 'public/index.html', 'docs/index.html', 'dist/index.html', 'build/index.html',
    'src/index.html', 'site/index.html', 'www/index.html', 'app/index.html',
  ];
  const found = preferred.filter((path) => files.has(path));
  const others = [...files.keys()]
    .filter((path) => /\.html?$/i.test(path) && !found.includes(path))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return [...found, ...others];
}

function detectBuildRequired(html: string, files: Map<string, Uint8Array>, entry: string): string | null {
  const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
  for (const tag of scriptTags) {
    const src = getAttr(tag, 'src');
    if (src && BUILD_SOURCE_EXT.test(src)) {
      return `A página principal carrega código-fonte (${stripQuery(src)}) que precisa de build antes de abrir no navegador.`;
    }
  }
  const pkgBytes = files.get('package.json');
  if (pkgBytes && /<div\s+id=["'](?:root|app|__next)["']\s*>\s*<\/div>/i.test(html)) {
    try {
      const pkg = JSON.parse(decodeText(pkgBytes)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (['react', 'vue', 'svelte', 'next', 'vite', '@angular/core', 'nuxt'].some((name) => name in deps)) {
        return 'O projeto usa um framework com etapa de build (a página principal está vazia até compilar).';
      }
    } catch {
      /* package.json inválido: segue como site estático */
    }
  }
  void entry;
  return null;
}

interface Budget {
  remaining: number;
}

interface RunState {
  files: Map<string, Uint8Array>;
  ctx: StaticSiteContext;
  budget: Budget;
  inlinedCss: Set<string>;
  inlinedJs: Set<string>;
  dataUriAssets: Set<string>;
  cdnAssets: Set<string>;
  missing: Set<string>;
  otherPages: Set<string>;
}

function cdnUrl(ctx: StaticSiteContext, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}@${encodeURIComponent(ctx.branch)}/${encodedPath}`;
}

function resolveRef(ref: string, fromDir: string, baseDir: string): string | null {
  const clean = safeDecode(stripQuery(ref.trim()));
  if (!clean) return null;
  if (clean.startsWith('/')) return joinPath(baseDir, clean.slice(1));
  return joinPath(fromDir, clean);
}

function rewriteAsset(ref: string, fromDir: string, baseDir: string, state: RunState): string {
  if (!ref || isExternalRef(ref)) return ref;
  const path = resolveRef(ref, fromDir, baseDir);
  if (!path) return ref;
  const bytes = state.files.get(path);
  if (!bytes) {
    state.missing.add(path);
    return ref;
  }
  const ext = extOf(path);
  const mime = MIME[ext];
  if (mime && bytes.length <= INLINE_FILE_MAX_BYTES && bytes.length <= state.budget.remaining) {
    state.budget.remaining -= Math.ceil(bytes.length * 1.34);
    state.dataUriAssets.add(path);
    return `data:${mime};base64,${toBase64(bytes)}`;
  }
  state.cdnAssets.add(path);
  return cdnUrl(state.ctx, path);
}

function processCss(css: string, cssDir: string, baseDir: string, state: RunState, depth: number): string {
  let out = css;
  if (depth < MAX_CSS_IMPORT_DEPTH) {
    out = out.replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?\s*([^;]*);/gi, (full, _q, ref: string, media: string) => {
      if (isExternalRef(ref)) return full;
      const path = resolveRef(ref, cssDir, baseDir);
      const bytes = path ? state.files.get(path) : undefined;
      if (!path || !bytes) {
        if (path) state.missing.add(path);
        return full;
      }
      state.inlinedCss.add(path);
      const inner = processCss(decodeText(bytes), dirOf(path), baseDir, state, depth + 1);
      return media.trim() ? `@media ${media.trim()} {\n${inner}\n}` : inner;
    });
  }
  return out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _q, ref: string) => {
    const next = rewriteAsset(ref.trim(), cssDir, baseDir, state);
    return next === ref.trim() ? full : `url("${next}")`;
  });
}

function hasRelativeModuleImport(js: string): boolean {
  return /\bimport\s*(?:[\w*{}\s,]+\s*from\s*)?['"]\.{0,2}\//.test(js) || /\bimport\s*\(\s*['"]\.{0,2}\//.test(js);
}

function runBundle(entry: string, html: string, state: RunState): string {
  const baseDir = dirOf(entry);
  let out = html;

  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = (getAttr(tag, 'rel') || '').toLowerCase();
    const href = getAttr(tag, 'href');
    if (!href || isExternalRef(href)) return tag;
    if (rel.includes('stylesheet')) {
      const path = resolveRef(href, baseDir, baseDir);
      const bytes = path ? state.files.get(path) : undefined;
      if (!path || !bytes) {
        if (path) state.missing.add(path);
        return tag;
      }
      state.inlinedCss.add(path);
      const css = processCss(decodeText(bytes), dirOf(path), baseDir, state, 0);
      const media = getAttr(tag, 'media');
      return `<style data-froc-source="${path}"${media ? ` media="${media}"` : ''}>\n${css}\n</style>`;
    }
    if (/icon|preload|manifest|apple-touch/.test(rel)) {
      return setAttr(tag, 'href', rewriteAsset(href, baseDir, baseDir, state));
    }
    return tag;
  });

  out = out.replace(/<script\b[^>]*>\s*<\/script>/gi, (tag) => {
    const src = getAttr(tag, 'src');
    if (!src || isExternalRef(src)) return tag;
    const path = resolveRef(src, baseDir, baseDir);
    const bytes = path ? state.files.get(path) : undefined;
    if (!path || !bytes) {
      if (path) state.missing.add(path);
      return tag;
    }
    const js = decodeText(bytes);
    const type = getAttr(tag, 'type');
    if (hasRelativeModuleImport(js)) {
      state.cdnAssets.add(path);
      return setAttr(tag, 'src', cdnUrl(state.ctx, path));
    }
    state.inlinedJs.add(path);
    const typeAttr = type ? ` type="${type}"` : '';
    return `<script${typeAttr} data-froc-source="${path}">\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
  });

  out = out.replace(/<(img|source|video|audio|track|embed|input)\b[^>]*>/gi, (tag) => {
    let next = tag;
    const src = getAttr(next, 'src');
    if (src) next = setAttr(next, 'src', rewriteAsset(src, baseDir, baseDir, state));
    const poster = getAttr(next, 'poster');
    if (poster) next = setAttr(next, 'poster', rewriteAsset(poster, baseDir, baseDir, state));
    const srcset = getAttr(next, 'srcset');
    if (srcset) {
      const rewritten = srcset
        .split(',')
        .map((candidate) => {
          const [url, ...descriptor] = candidate.trim().split(/\s+/);
          return [rewriteAsset(url, baseDir, baseDir, state), ...descriptor].join(' ');
        })
        .join(', ');
      next = setAttr(next, 'srcset', rewritten);
    }
    return next;
  });

  out = out.replace(/(<[a-z][^>]*\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi, (full, head: string, quote: string, css: string) => {
    if (!/url\(/i.test(css)) return full;
    return `${head}${quote}${processCss(css, baseDir, baseDir, state, MAX_CSS_IMPORT_DEPTH)}${quote}`;
  });

  out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (full, attrs: string, css: string) => {
    if (attrs.includes('data-froc-source') || !/url\(|@import/i.test(css)) return full;
    return `<style${attrs}>${processCss(css, baseDir, baseDir, state, 0)}</style>`;
  });

  out = out.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = getAttr(tag, 'href');
    if (!href || isExternalRef(href)) return tag;
    const clean = stripQuery(href);
    if (/\.html?$/i.test(clean)) {
      const path = resolveRef(href, baseDir, baseDir);
      if (path && path !== entry && state.files.has(path)) state.otherPages.add(path);
    }
    return tag;
  });

  return out;
}

export function bundleStaticSite(
  rawFiles: Record<string, Uint8Array>,
  ctx: StaticSiteContext,
  options: { normalized?: { files: Map<string, Uint8Array>; skipped: number } } = {},
): StaticSiteResult {
  const { files, skipped } = options.normalized ?? normalizeFiles(rawFiles);
  const emptyReport = (kind: StaticSiteReport['kind'], message: string, reason: string | null = null, entry: string | null = null): StaticSiteReport => ({
    kind, entry, totalFiles: files.size,
    inlined: { css: 0, js: 0, assetsAsDataUri: 0 },
    assetsViaCdn: { count: 0, examples: [] },
    otherPages: [], missingReferences: [], protectedFilesSkipped: skipped,
    htmlBytes: 0, complete: false, needsBuildReason: reason, message,
  });

  const candidates = findEntryCandidates(files);
  if (candidates.length === 0) {
    return { html: null, title: ctx.repo, report: emptyReport('no_html', 'O repositório não tem nenhuma página HTML para abrir no editor.') };
  }

  let firstBuildReason: string | null = null;
  let firstBuildEntry: string | null = null;
  for (const entry of candidates) {
    const html = decodeText(files.get(entry)!);
    const reason = detectBuildRequired(html, files, entry);
    if (reason) {
      if (!firstBuildReason) {
        firstBuildReason = reason;
        firstBuildEntry = entry;
      }
      continue;
    }

    let result: { out: string; state: RunState } | null = null;
    for (const budgetBytes of OUTPUT_BUDGETS) {
      const state: RunState = {
        files, ctx, budget: { remaining: budgetBytes },
        inlinedCss: new Set(), inlinedJs: new Set(), dataUriAssets: new Set(), cdnAssets: new Set(),
        missing: new Set(), otherPages: new Set(),
      };
      const out = runBundle(entry, html, state);
      result = { out, state };
      if (new TextEncoder().encode(out).length <= MAX_OUTPUT_BYTES) break;
    }
    const { out, state } = result!;
    const htmlBytes = new TextEncoder().encode(out).length;
    const titleMatch = out.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = (titleMatch?.[1] || '').replace(/\s+/g, ' ').trim() || ctx.repo;
    const missing = [...state.missing].slice(0, 30);
    const otherPages = [...state.otherPages].slice(0, 30);
    const complete = htmlBytes <= MAX_OUTPUT_BYTES && missing.length === 0 && otherPages.length === 0;
    const parts = [
      `Página principal: ${entry}.`,
      `${state.inlinedCss.size} CSS e ${state.inlinedJs.size} JS dentro do projeto.`,
      `${state.dataUriAssets.size} imagens/fontes embutidas e ${state.cdnAssets.size} servidas pela CDN do repositório.`,
    ];
    if (otherPages.length) parts.push(`${otherPages.length} outras páginas HTML existem e NÃO foram abertas no editor: ${otherPages.slice(0, 5).join(', ')}.`);
    if (missing.length) parts.push(`${missing.length} arquivos referenciados não existem no repositório: ${missing.slice(0, 5).join(', ')}.`);
    if (htmlBytes > MAX_OUTPUT_BYTES) parts.push('O documento final ficou grande demais para o editor.');
    return {
      html: htmlBytes > MAX_OUTPUT_BYTES ? null : out,
      title,
      report: {
        kind: 'static', entry, totalFiles: files.size,
        inlined: { css: state.inlinedCss.size, js: state.inlinedJs.size, assetsAsDataUri: state.dataUriAssets.size },
        assetsViaCdn: { count: state.cdnAssets.size, examples: [...state.cdnAssets].slice(0, 12) },
        otherPages, missingReferences: missing, protectedFilesSkipped: skipped,
        htmlBytes, complete, needsBuildReason: null, message: parts.join(' '),
      },
    };
  }

  return {
    html: null,
    title: ctx.repo,
    report: emptyReport(
      'build_required',
      `${firstBuildReason} Baixe o ZIP completo e rode o build, ou peça para a Froc recriar o projeto como site pronto.`,
      firstBuildReason,
      firstBuildEntry,
    ),
  };
}

/** Reescreve CSS/JS/imagens locais de um HTML de entrada (usado também pelo bundler de projetos React). */
export function inlineEntryHtml(
  files: Map<string, Uint8Array>,
  ctx: StaticSiteContext,
  entry: string,
  html: string,
): { html: string; missing: string[]; otherPages: string[]; assetsAsDataUri: number; assetsViaCdn: number } {
  let last: { out: string; state: RunState } | null = null;
  for (const budgetBytes of OUTPUT_BUDGETS) {
    const state: RunState = {
      files, ctx, budget: { remaining: budgetBytes },
      inlinedCss: new Set(), inlinedJs: new Set(), dataUriAssets: new Set(), cdnAssets: new Set(),
      missing: new Set(), otherPages: new Set(),
    };
    const out = runBundle(entry, html, state);
    last = { out, state };
    if (new TextEncoder().encode(out).length <= MAX_OUTPUT_BYTES) break;
  }
  const { out, state } = last!;
  return {
    html: out,
    missing: [...state.missing],
    otherPages: [...state.otherPages],
    assetsAsDataUri: state.dataUriAssets.size,
    assetsViaCdn: state.cdnAssets.size,
  };
}
