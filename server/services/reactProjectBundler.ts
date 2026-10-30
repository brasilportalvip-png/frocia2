import type { Plugin } from 'esbuild';
import type { NpmInstaller } from './npmInstaller.js';
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
const CORE_PACKAGES = new Set(['react', 'react-dom']);
// Ferramentas de build: nunca viram código do site (ex.: `@import "tailwindcss"` no CSS).
const BUILD_ONLY = /^(?:tailwindcss|@tailwindcss\/.+|postcss(?:-.+)?|autoprefixer|vite|@vitejs\/.+|vitest|typescript|eslint(?:-.+)?|@eslint\/.+|prettier|@types\/.+)$/;


export interface ReactBundleOptions {
  /** Injetável para testes. Padrão: fetch real, restrito ao esm.sh. */
  fetchText?: (url: string) => Promise<string>;
  /** Espera entre tentativas de compilação após falha momentânea. Padrão: 2500 ms (testes usam 0). */
  retryDelayMs?: number;
  /** Injetável para testes. Padrão: import('esbuild'). */
  esbuild?: typeof import('esbuild');
  /** Instalador de pacotes a partir do package-lock.json do projeto. Sem ele (ou sem o pacote no lock), usa o esm.sh. */
  installer?: Pick<NpmInstaller, 'has' | 'ensure' | 'getDir'>;
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

const RETRY_DELAYS_MS = [1_500, 3_500];

async function fetchOnce(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'froc-ia-bundler' } });
    const finalHost = new URL(response.url || url).hostname;
    if (finalHost !== ESM_HOST) throw new Error(`Redirecionamento bloqueado para ${finalHost}`);
    const text = await response.text();
    if (text.length > MAX_MODULE_BYTES) throw new Error(`Módulo grande demais: ${url}`);
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function defaultFetchText(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== ESM_HOST) {
    throw new Error(`Host não permitido para pacotes: ${parsed.hostname}`);
  }
  let lastError = '';
  // O esm.sh monta pacotes sob demanda: a primeira tentativa às vezes dá 5xx e a seguinte funciona.
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const result = await fetchOnce(url);
      if (result.ok) return result.text;
      lastError = `esm.sh respondeu ${result.status} para ${url}`;
      if (result.status < 500 && result.status !== 429) throw new Error(lastError);
    } catch (error) {
      if (error instanceof Error && /Redirecionamento bloqueado|Módulo grande demais/.test(error.message)) throw error;
      lastError = error instanceof Error ? error.message : String(error);
      if (/^esm\.sh respondeu 4\d\d/.test(lastError) && !lastError.includes(' 429 ')) throw error;
    }
    if (attempt < RETRY_DELAYS_MS.length) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
  throw new Error(lastError);
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Módulo ESM vazio, mas com exatamente os nomes que o projeto importa do pacote. */
function buildStubModule(spec: string, files: Map<string, Uint8Array>): string {
  const names = new Set<string>();
  const pattern = new RegExp(`import\\s+(?:type\\s+)?(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${escapeRegExp(spec)}['"]`, 'g');
  for (const [path, bytes] of files) {
    if (!/\.(?:tsx?|jsx?|mjs)$/.test(path)) continue;
    for (const match of decodeText(bytes).matchAll(pattern)) {
      for (const part of match[1].split(',')) {
        const original = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(original) && original !== 'default') names.add(original);
      }
    }
  }
  const rejectLogin = '() => Promise.reject(Object.assign(new Error("Login indisponível na prévia"), { code: "auth/network-request-failed" }))';
  const emptySnapshot = '{ exists: () => false, data: () => undefined, id: "", docs: [], empty: true, size: 0, forEach() {} }';
  const behaviours: Record<string, string> = {
    // O app deve concluir o carregamento como "ninguém logado" em vez de esperar para sempre.
    onAuthStateChanged: '(_a, cb) => { if (typeof cb === "function") setTimeout(() => cb(null), 0); return () => {}; }',
    onIdTokenChanged: '(_a, cb) => { if (typeof cb === "function") setTimeout(() => cb(null), 0); return () => {}; }',
    getRedirectResult: '() => Promise.resolve(null)',
    setPersistence: '() => Promise.resolve()',
    signOut: '() => Promise.resolve()',
    isSupported: '() => Promise.resolve(false)',
    getDoc: `() => Promise.resolve(${emptySnapshot})`,
    getDocs: `() => Promise.resolve(${emptySnapshot})`,
    onSnapshot: `(_r, a) => { const cb = typeof a === "function" ? a : a && a.next; if (cb) setTimeout(() => cb(${emptySnapshot}), 0); return () => {}; }`,
  };
  const behaviourFor = (name: string): string =>
    behaviours[name] ?? (/^(?:signIn|createUser|sendEmail|sendPassword|signInWith)/.test(name) ? rejectLogin : 'make()');
  return [
    'const make = () => new Proxy(function () {}, {',
    "  get: (_t, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : make()),",
    '  apply: () => make(),',
    '  construct: () => make(),',
    '});',
    'export default make();',
    ...[...names].map((name) => `export const ${name} = ${behaviourFor(name)};`),
  ].join('\n');
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
      cached.catch(() => remoteCache.delete(url));
      remoteCache.set(url, cached);
    }
    return cached;
  };

  const topLevelPackages = new Map<string, { name: string; spec: string }>();
  const stubbed = new Set<string>();
  const buildOnlySeen = new Set<string>();
  const npmPackages = new Set<string>(); // instalados do npm (via package-lock.json)
  const pendingStub = new Set<string>(); // pacotes cujos arquivos internos não carregaram: na próxima tentativa viram versão vazia
  const compiled = new Set<string>();
  const packages = new Set<string>();
  const envUsed = new Set<string>();

  const plugin: Plugin = {
    name: 'froc-project',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        const spec = args.path;

        if (args.kind === 'entry-point') return { path: entryPath!, namespace: 'proj' };

        // Arquivos de pacotes instalados em disco: o esbuild resolve sozinho (exports, browser, module...).
        if (args.namespace === 'file' || (args.pluginData as { frocInner?: boolean } | undefined)?.frocInner) return undefined;

        // Dentro de módulos remotos (esm.sh).
        if (args.namespace === 'esm') {
          if (/^https?:\/\//.test(spec)) return { path: new URL(spec).href, namespace: 'esm' };
          if (spec.startsWith('/') || spec.startsWith('.')) return { path: new URL(spec, args.importer).href, namespace: 'esm' };
          packages.add(splitPackage(spec).name);
          if (pendingStub.has(splitPackage(spec).name)) return { path: spec, namespace: 'stub' };
          topLevelPackages.set(esmUrl(spec), { name: splitPackage(spec).name, spec });
          return { path: esmUrl(spec), namespace: 'esm' };
        }

        if (/^https?:\/\//.test(spec)) return { path: new URL(spec).href, namespace: 'esm' };
        if (/^(?:data|blob):/.test(spec)) return { path: spec, external: true };

        const clean = spec.split('#')[0].split('?')[0];
        if (!clean.startsWith('.') && !clean.startsWith('/') && !clean.startsWith('@/') && !clean.startsWith('~/') && BUILD_ONLY.test(splitPackage(clean).name)) {
          buildOnlySeen.add(splitPackage(clean).name);
          return { path: clean, namespace: args.kind === 'import-rule' ? 'empty-css' : 'empty-js' };
        }
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
        if (options.installer?.has(name) && (await options.installer.ensure(name))) {
          const resolved = await build.resolve(clean, {
            kind: args.kind,
            resolveDir: await options.installer.getDir(),
            importer: args.importer,
            pluginData: { frocInner: true }, // evita o plugin se chamar de novo
          });
          if (resolved.errors.length === 0 && !resolved.external) {
            packages.add(name);
            npmPackages.add(name);
            return { path: resolved.path, namespace: resolved.namespace, sideEffects: resolved.sideEffects };
          }
        }
        packages.add(name);
        if (pendingStub.has(name)) return { path: clean, namespace: 'stub' };
        topLevelPackages.set(esmUrl(clean), { name, spec: clean });
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

      build.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'css' }));
      build.onLoad({ filter: /.*/, namespace: 'empty-js' }, () => ({ contents: 'export default {};', loader: 'js' }));

      build.onLoad({ filter: /.*/, namespace: 'asset' }, (args) => ({
        contents: `export default ${JSON.stringify(assetUrl(args.path))};`,
        loader: 'js',
      }));

      build.onLoad({ filter: /.*/, namespace: 'esm' }, async (args) => {
        try {
          const contents = await loadRemote(args.path);
          const pathname = new URL(args.path).pathname;
          return { contents, loader: pathname.endsWith('.css') ? 'css' : 'js' };
        } catch (error) {
          // Pacote opcional/nativo que o esm.sh não conseguiu montar: usa uma versão vazia
          // para o restante do projeto continuar abrindo. O núcleo (React) nunca é trocado.
          const info = topLevelPackages.get(args.path);
          if (info && !CORE_PACKAGES.has(info.name)) {
            stubbed.add(info.name);
            return { contents: buildStubModule(info.spec, files), loader: 'js' };
          }
          const inner = new URL(args.path).pathname.match(/^\/((?:@[^/@]+\/)?[^/@]+)@/);
          if (inner && !CORE_PACKAGES.has(inner[1])) pendingStub.add(inner[1]);
          throw error;
        }
      });

      build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
        stubbed.add(splitPackage(args.path).name);
        return { contents: buildStubModule(args.path, files), loader: 'js' };
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
  const TRANSIENT = /esm\.sh respondeu (?:5\d\d|429)|aborted|fetch failed|ECONNRESET|ETIMEDOUT/i;
  let lastFailure = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stubsBefore = pendingStub.size;
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
      lastFailure = '';
      break;
    } catch (error) {
      const errors = (error as { errors?: Array<{ text: string; location?: { file: string; line: number } | null }> }).errors || [];
      const detail = errors.slice(0, 3).map((e) => `${e.text}${e.location ? ` (${e.location.file}:${e.location.line})` : ''}`).join(' | ')
        || (error instanceof Error ? error.message : 'erro desconhecido');
      lastFailure = detail;
      // Falha momentânea do esm.sh: o que já baixou fica guardado e só o que faltou é pedido de novo.
      if (attempt < 3 && pendingStub.size > stubsBefore) continue; // pacote com arquivo interno fora do ar: refaz com versão vazia dele
      if (attempt < 3 && TRANSIENT.test(detail)) {
        await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 2_500));
        continue;
      }
      break;
    }
  }
  if (lastFailure) return fail(`Não consegui compilar o projeto: ${lastFailure}`);
  if (!jsText) return fail('A compilação não gerou nenhum código.');

  // 6. Monta o HTML final.
  const withoutEntry = html.replace(entryScriptTag, '');
  const inlined = inlineEntryHtml(files, ctx, entryHtmlPath, withoutEntry);
  let page = inlined.html;

  const tailwindStyle = /@tailwind|@apply/.test(cssText);
  const styleTag = cssText.trim() ? `<style data-froc-source="bundle.css"${tailwindStyle ? ' type="text/tailwindcss"' : ''}>\n${cssText}\n</style>` : '';
  // A prévia roda em um iframe isolado (sem allow-same-origin): IndexedDB e, às vezes, sessionStorage/localStorage
  // são negados. Declaramos IndexedDB como inexistente (bibliotecas como o Firebase Auth usam outro armazenamento)
  // e damos um armazenamento em memória no lugar dos que o navegador negar.
  const sandboxCompat = `<script data-froc-source="sandbox-compat">(function(){function def(n,v){try{Object.defineProperty(window,n,{value:v,configurable:true,writable:true});return true}catch(e){return false}}def('indexedDB',undefined);def('webkitIndexedDB',undefined);function mem(){var d={};return{get length(){return Object.keys(d).length},key:function(i){var k=Object.keys(d)[i];return k===undefined?null:k},getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}}}}['sessionStorage','localStorage'].forEach(function(n){try{window[n].getItem('__froc')}catch(e){def(n,mem())}})})();</script>\n`;
  const errorOverlay = `<script data-froc-source="preview-errors">(function(){function show(m){var d=document.getElementById('froc-preview-error');if(!d){d=document.createElement('div');d.id='froc-preview-error';d.style.cssText='position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;background:#7f1d1d;color:#fff;padding:10px 12px;border-radius:8px;font:12px/1.4 system-ui;max-height:40vh;overflow:auto';document.documentElement.appendChild(d)}d.textContent='Erro na prévia: '+m+'  (clique para fechar)';d.onclick=function(){d.remove()}}window.addEventListener('error',function(e){show(e.message||'erro desconhecido')});window.addEventListener('unhandledrejection',function(e){show(String((e.reason&&e.reason.message)||e.reason))});setTimeout(function(){var r=document.getElementById('root');if(r&&!r.childNodes.length)show('a tela ficou vazia: o projeto não renderizou nada (pode depender de login ou de variáveis de ambiente não configuradas).')},4000)})();</script>\n`;
  const headExtra = `${sandboxCompat}${errorOverlay}${usesTailwind ? '<script src="https://cdn.tailwindcss.com"></script>\n' : ''}${styleTag}`;
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
  if (buildOnlySeen.size) notes.push(`Ferramentas de build ignoradas na prévia (não fazem parte do site): ${[...buildOnlySeen].sort().join(', ')}.`);
  if (usesTailwind) notes.push('Estilos Tailwind aplicados pela biblioteca oficial (CDN, versão 3). Classes exclusivas do Tailwind 4 e configurações personalizadas do tailwind.config podem aparecer diferentes.');
  if (stubbed.size) notes.push(`Pacotes opcionais que não puderam ser carregados e foram trocados por versão vazia: ${[...stubbed].sort().join(', ')}. Recursos que dependem deles (aplicativo de celular, analytics) ficam desligados na prévia.`);
  if (missingEnv.length) notes.push(`Variáveis de ambiente usadas e não configuradas: ${missingEnv.join(', ')}. Partes que dependem delas (APIs, login) podem não funcionar na prévia.`);
  if (npmPackages.size) notes.unshift(`${npmPackages.size} pacotes instalados do npm a partir do package-lock.json do projeto (como num build normal).`);
  if (options.installer && 'failures' in options.installer) {
    const failed = [...((options.installer as unknown as { failures: Map<string, string> }).failures.keys())];
    if (failed.length) notes.push(`Não consegui instalar do npm (usei o esm.sh no lugar): ${failed.sort().join(', ')}.`);
  }
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
      bundle: { compiledFiles: compiled.size, packages: packageList, missingEnv, notes, stubbedPackages: [...stubbed].sort(), npmPackages: [...npmPackages].sort() },
    },
  };
}
