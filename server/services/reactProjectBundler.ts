import type { Plugin } from 'esbuild';
import {
  decodeText,
  dirOf,
  getAttr,
  inlineEntryHtml,
  joinPath,
  type StaticSiteContext,
  type StaticSiteResult,
} from './staticSiteBundler.js';

/**
 * Compila no servidor um projeto React/Vite/TypeScript (sem etapa de build do
 * usuário) e devolve UM HTML pronto para o editor. Código do projeto é
 * compilado com o esbuild; pacotes npm vêm do esm.sh (único host permitido) e
 * entram DENTRO do arquivo final, então o navegador não carrega nada de fora
 * e a política de segurança do site não precisa mudar.
 */

const ESM_HOST = 'esm.sh';
const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];
const ASSET_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|ogg|wav|pdf)$/i;
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
};
const INLINE_ASSET_MAX = 120_000;
const INLINE_ASSET_BUDGET = 1_500_000;
const MAX_MODULE_BYTES = 4_000_000;
const MAX_REMOTE_TOTAL_BYTES = 20_000_000;
const MAX_HTML_BYTES = 4_200_000;
const FETCH_TIMEOUT_MS = 20_000;

export interface ReactBundleOptions {
  /** Injetável para testes. Padrão: fetch real, restrito ao esm.sh. */
  fetchText?: (url: string) => Promise<string>;
  /** Injetável para testes. Padrão: import('esbuild'). */
  esbuild?: typeof import('esbuild');
}

function extOf(path: string): string {
  const base = path.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function cleanVersion(range: string | undefined): string {
  if (!range) return '';
  const trimmed = range.trim();
  if (/^[\^~]?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/.test(trimmed)) return trimmed.replace(/^[\^~]/, '');
  return '';
}

function splitPackage(spec: string): { name: string; subpath: string } {
  const parts = spec.split('/');
  const nameLength = spec.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, nameLength).join('/'), subpath: parts.slice(nameLength).join('/') };
}

async function defaultFetchText(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== ESM_HOST) {
    throw new Error(`Host não permitido para pacotes: ${parsed.hostname}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'froc-ia-bundler' } });
    if (!response.ok) throw new Error(`esm.sh respondeu ${response.status} para ${url}`);
    const finalHost = new URL(response.url || url).hostname;
    if (finalHost !== ESM_HOST) throw new Error(`Redirecionamento bloqueado para ${finalHost}`);
    const text = await response.text();
    if (text.length > MAX_MODULE_BYTES) throw new Error(`Módulo grande demais: ${url}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function bundleReactProject(
  files: Map<string, Uint8Array>,
  ctx: StaticSiteContext,
  entryHtmlPath: string,
  options: ReactBundleOptions = {},
): Promise<StaticSiteResult> {
  const fail = (message: string): StaticSiteResult => ({
    html: null,
    title: ctx.repo,
    report: {
      kind: 'build_failed', entry: entryHtmlPath, totalFiles: files.size,
      inlined: { css: 0, js: 0, assetsAsDataUri: 0 }, assetsViaCdn: { count: 0, examples: [] },
      otherPages: [], missingReferences: [], protectedFilesSkipped: 0, htmlBytes: 0,
      complete: false, needsBuildReason: null, message,
    },
  });

  const baseDir = dirOf(entryHtmlPath);
  const html = decodeText(files.get(entryHtmlPath)!);

  // 1. Script de entrada do HTML.
  let entryScriptTag: string | null = null;
  let entryPath: string | null = null;
  for (const tag of html.match(/<script\b[^>]*>\s*<\/script>/gi) || []) {
    const src = getAttr(tag, 'src');
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue;
    if (!/\.(?:tsx|ts|jsx|js|mjs)(?:[?#]|$)/i.test(src)) continue;
    const clean = decodeURIComponent(src.split('#')[0].split('?')[0]);
    const resolved = clean.startsWith('/') ? joinPath(baseDir, clean.slice(1)) : joinPath(baseDir, clean);
    if (resolved && files.has(resolved)) {
      entryScriptTag = tag;
      entryPath = resolved;
      break;
    }
  }
  if (!entryScriptTag || !entryPath) {
    return fail('Não encontrei o arquivo de entrada do projeto (o <script> principal do index.html).');
  }

  // 2. Dependências declaradas.
  const versions = new Map<string, string>();
  const pkgBytes = files.get(baseDir ? `${baseDir}/package.json` : 'package.json') || files.get('package.json');
  if (pkgBytes) {
    try {
      const pkg = JSON.parse(decodeText(pkgBytes)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      for (const [name, range] of Object.entries({ ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) })) {
        versions.set(name, cleanVersion(range));
      }
    } catch {
      /* package.json inválido: segue sem versões */
    }
  }
  const usesTailwind = versions.has('tailwindcss') || [...files.keys()].some((p) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(p));

  // 3. Resolução de arquivos do projeto.
  const resolveProjectFile = (candidate: string | null): string | null => {
    if (!candidate) return null;
    if (files.has(candidate)) return candidate;
    for (const ext of SOURCE_EXTS) if (files.has(candidate + ext)) return candidate + ext;
    for (const ext of SOURCE_EXTS) if (files.has(`${candidate}/index${ext}`)) return `${candidate}/index${ext}`;
    return null;
  };
  const srcRoot = baseDir ? `${baseDir}/src` : 'src';

  const esmUrl = (spec: string): string => {
    const { name, subpath } = splitPackage(spec);
    const fallback = name === 'react' || name === 'react-dom' ? '18.3.1' : '';
    const version = versions.get(name) || fallback;
    const external = name === 'react' ? [] : name === 'react-dom' ? ['react'] : ['react', 'react-dom'];
    const query = external.length ? `?external=${external.join(',')}` : '';
    return `https://${ESM_HOST}/${name}${version ? `@${version}` : ''}${subpath ? `/${subpath}` : ''}${query}`;
  };

  // 4. Assets.
  let inlineBudget = INLINE_ASSET_BUDGET;
  const assetUrls = new Set<string>();
  const assetUrl = (path: string): string => {
    const bytes = files.get(path)!;
    const mime = MIME[extOf(path)];
    if (mime && bytes.length <= INLINE_ASSET_MAX && bytes.length <= inlineBudget) {
      inlineBudget -= Math.ceil(bytes.length * 1.34);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:${mime};base64,${btoa(binary)}`;
    }
    assetUrls.add(path);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}@${encodeURIComponent(ctx.branch)}/${encoded}`;
  };

  // 5. Plugin do esbuild.
  const fetchText = options.fetchText ?? defaultFetchText;
  const remoteCache = new Map<string, Promise<string>>();
  let remoteBytes = 0;
  const loadRemote = (url: string): Promise<string> => {
    let cached = remoteCache.get(url);
    if (!cached) {
      cached = fetchText(url).then((text) => {
        remoteBytes += text.length;
        if (remoteBytes > MAX_REMOTE_TOTAL_BYTES) throw new Error('Os pacotes do projeto somam mais do que o limite permitido.');
        return text;
      });
      remoteCache.set(url, cached);
    }
    return cached;
  };

  const compiled = new Set<string>();
  const packages = new Set<string>();
  const envUsed = new Set<string>();

  const plugin: Plugin = {
    name: 'froc-project',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const spec = args.path;

        if (args.kind === 'entry-point') return { path: entryPath!, namespace: 'proj' };

        // Dentro de módulos remotos (esm.sh).
        if (args.namespace === 'esm') {
          if (/^https?:\/\//.test(spec)) return { path: new URL(spec).href, namespace: 'esm' };
          if (spec.startsWith('/') || spec.startsWith('.')) return { path: new URL(spec, args.importer).href, namespace: 'esm' };
          packages.add(splitPackage(spec).name);
          return { path: esmUrl(spec), namespace: 'esm' };
        }

        if (/^https?:\/\//.test(spec)) return { path: new URL(spec).href, namespace: 'esm' };
        if (/^(?:data|blob):/.test(spec)) return { path: spec, external: true };

        const clean = spec.split('#')[0].split('?')[0];
        const importerDir = args.namespace === 'proj' ? dirOf(args.importer) : baseDir;

        let projectPath: string | null = null;
        if (clean.startsWith('.')) projectPath = joinPath(importerDir, clean);
        else if (clean.startsWith('/')) projectPath = joinPath(baseDir, clean.slice(1)) ?? null;
        else if (clean.startsWith('@/') || clean.startsWith('~/')) projectPath = joinPath(srcRoot, clean.slice(2));

        if (projectPath !== null || clean.startsWith('.') || clean.startsWith('/')) {
          if (args.kind === 'url-token' || ASSET_EXT.test(clean)) {
            const assetPath = projectPath && files.has(projectPath) ? projectPath : projectPath && files.has(`public/${projectPath}`) ? `public/${projectPath}` : null;
            if (!assetPath) return args.kind === 'url-token' ? { path: spec, external: true } : { errors: [{ text: `Arquivo não encontrado: ${clean}` }] };
            if (args.kind === 'url-token') return { path: assetUrl(assetPath), external: true };
            return { path: assetPath, namespace: 'asset' };
          }
          const found = resolveProjectFile(projectPath);
          if (found) return { path: found, namespace: 'proj' };
          return { errors: [{ text: `Arquivo não encontrado: ${clean}` }] };
        }

        // Pacote sem prefixo: primeiro tenta como pasta do projeto (baseUrl=src), depois npm.
        const { name } = splitPackage(clean);
        if (!versions.has(name)) {
          const local = resolveProjectFile(joinPath(srcRoot, clean));
          if (local) return { path: local, namespace: 'proj' };
        }
        packages.add(name);
        return { path: esmUrl(clean), namespace: 'esm' };
      });

      build.onLoad({ filter: /.*/, namespace: 'proj' }, (args) => {
        const bytes = files.get(args.path);
        if (!bytes) return { errors: [{ text: `Arquivo não encontrado: ${args.path}` }] };
        compiled.add(args.path);
        const text = decodeText(bytes);
        for (const match of text.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) envUsed.add(match[1]);
        const ext = extOf(args.path);
        const loader = ext === 'tsx' ? 'tsx' : ext === 'ts' ? 'ts' : ext === 'jsx' ? 'jsx' : ext === 'json' ? 'json' : ext === 'css' ? 'css' : /^m?js$/.test(ext) ? 'jsx' : 'text';
        return { contents: text, loader };
      });

      build.onLoad({ filter: /.*/, namespace: 'asset' }, (args) => ({
        contents: `export default ${JSON.stringify(assetUrl(args.path))};`,
        loader: 'js',
      }));

      build.onLoad({ filter: /.*/, namespace: 'esm' }, async (args) => {
        const contents = await loadRemote(args.path);
        const pathname = new URL(args.path).pathname;
        return { contents, loader: pathname.endsWith('.css') ? 'css' : 'js' };
      });
    },
  };

  let esbuild: typeof import('esbuild');
  try {
    esbuild = options.esbuild ?? (await import('esbuild'));
  } catch {
    return fail('O compilador de projetos não está disponível neste servidor agora.');
  }

  let jsText = '';
  let cssText = '';
  try {
    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      outdir: '/out',
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      logLevel: 'silent',
      legalComments: 'none',
      plugins: [plugin],
      define: {
        'process.env.NODE_ENV': '"production"',
        'import.meta.env': '{"MODE":"production","DEV":false,"PROD":true,"BASE_URL":"/","SSR":false}',
        'import.meta.env.MODE': '"production"',
        'import.meta.env.DEV': 'false',
        'import.meta.env.PROD': 'true',
        'import.meta.env.BASE_URL': '"/"',
        global: 'globalThis',
      },
    });
    for (const output of result.outputFiles || []) {
      if (output.path.endsWith('.js')) jsText = output.text;
      else if (output.path.endsWith('.css')) cssText = output.text;
    }
  } catch (error) {
    const errors = (error as { errors?: Array<{ text: string; location?: { file: string; line: number } | null }> }).errors || [];
    const detail = errors.slice(0, 3).map((e) => `${e.text}${e.location ? ` (${e.location.file}:${e.location.line})` : ''}`).join(' | ')
      || (error instanceof Error ? error.message : 'erro desconhecido');
    return fail(`Não consegui compilar o projeto: ${detail}`);
  }
  if (!jsText) return fail('A compilação não gerou nenhum código.');

  // 6. Monta o HTML final.
  const withoutEntry = html.replace(entryScriptTag, '');
  const inlined = inlineEntryHtml(files, ctx, entryHtmlPath, withoutEntry);
  let page = inlined.html;

  const tailwindStyle = /@tailwind|@apply/.test(cssText);
  const styleTag = cssText.trim() ? `<style data-froc-source="bundle.css"${tailwindStyle ? ' type="text/tailwindcss"' : ''}>\n${cssText}\n</style>` : '';
  const headExtra = `${usesTailwind ? '<script src="https://cdn.tailwindcss.com"></script>\n' : ''}${styleTag}`;
  const scriptTag = `<script data-froc-source="bundle.js">\n${jsText.replace(/<\/script/gi, '<\\/script')}\n</script>`;

  page = /<\/head>/i.test(page) ? page.replace(/<\/head>/i, () => `${headExtra}\n</head>`) : `${headExtra}\n${page}`;
  page = /<\/body>/i.test(page) ? page.replace(/<\/body>/i, () => `${scriptTag}\n</body>`) : `${page}\n${scriptTag}`;

  const htmlBytes = new TextEncoder().encode(page).length;
  if (htmlBytes > MAX_HTML_BYTES) {
    return fail(`O projeto compilado ficou com ${(htmlBytes / 1_000_000).toFixed(1)} MB, acima do limite do editor (${(MAX_HTML_BYTES / 1_000_000).toFixed(1)} MB).`);
  }

  const title = (page.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim() || ctx.repo;
  const missingEnv = [...envUsed].sort();
  const notes: string[] = [];
  if (usesTailwind) notes.push('Estilos Tailwind aplicados pela biblioteca oficial (CDN). Configurações personalizadas do tailwind.config não são lidas.');
  if (missingEnv.length) notes.push(`Variáveis de ambiente usadas e não configuradas: ${missingEnv.join(', ')}. Partes que dependem delas (APIs, login) podem não funcionar na prévia.`);
  notes.push('Rotas do navegador (React Router) funcionam melhor com HashRouter dentro da prévia.');
  const packageList = [...packages].sort();
  const missing = inlined.missing.slice(0, 30);

  return {
    html: page,
    title,
    report: {
      kind: 'react_bundled',
      entry: entryHtmlPath,
      totalFiles: files.size,
      inlined: { css: 0, js: compiled.size, assetsAsDataUri: inlined.assetsAsDataUri },
      assetsViaCdn: { count: inlined.assetsViaCdn + assetUrls.size, examples: [...assetUrls].slice(0, 12) },
      otherPages: inlined.otherPages.slice(0, 30),
      missingReferences: missing,
      protectedFilesSkipped: 0,
      htmlBytes,
      complete: missing.length === 0,
      needsBuildReason: null,
      message: `Projeto React compilado e aberto: ${compiled.size} arquivos do projeto e ${packageList.length} pacotes (${packageList.slice(0, 8).join(', ')}${packageList.length > 8 ? '…' : ''}). ${notes.join(' ')}`,
      bundle: { compiledFiles: compiled.size, packages: packageList, missingEnv, notes },
    },
  };
}
