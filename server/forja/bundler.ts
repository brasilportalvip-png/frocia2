// esbuild só carrega quando alguém compila um site (não pesa na inicialização da API).
const loadEsbuild = () => import('esbuild');

/*
 * Pacotes do site (React, React DOM e ícones Lucide).
 * Na Vercel a pasta node_modules não vai junto com a função, então o compilador não achava
 * "react" ("Could not resolve react") e a prévia ficava em branco. Agora: tenta o node_modules
 * (desenvolvimento e testes) e, se não achar, baixa do esm.sh — o mesmo caminho que a Froc.IA
 * já usa para abrir projetos do GitHub. Tudo entra DENTRO do HTML final (nada externo).
 * Versões fixas: uma única cópia do React (duas cópias quebram os hooks).
 */
export const FORJA_REACT_VERSION = '19.1.0';
export const FORJA_LUCIDE_VERSION = '0.546.0';
const ESM_ORIGIN = 'https://esm.sh';

export function esmUrlFor(spec: string, lucideExports?: string[] | null): string | null {
  const v = FORJA_REACT_VERSION;
  switch (spec) {
    case 'react':
      return `${ESM_ORIGIN}/react@${v}?target=es2022`;
    case 'react/jsx-runtime':
      return `${ESM_ORIGIN}/react@${v}/jsx-runtime?target=es2022&external=react`;
    case 'react/jsx-dev-runtime':
      return `${ESM_ORIGIN}/react@${v}/jsx-dev-runtime?target=es2022&external=react`;
    case 'react-dom':
      return `${ESM_ORIGIN}/react-dom@${v}?target=es2022&external=react`;
    case 'react-dom/client':
      return `${ESM_ORIGIN}/react-dom@${v}/client?target=es2022&external=react,react-dom`;
    case 'lucide-react': {
      // Só os ícones usados (o pacote inteiro tem milhares).
      const only = lucideExports && lucideExports.length ? `&exports=${[...new Set(lucideExports)].sort().join(',')}` : '';
      return `${ESM_ORIGIN}/lucide-react@${FORJA_LUCIDE_VERSION}?target=es2022&external=react${only}`;
    }
    default:
      return null;
  }
}

/** Ícones importados com `import { A, B as C } from 'lucide-react'` (null = import com *). */
export function lucideImportsIn(files: Record<string, string>): string[] | null {
  const names: string[] = [];
  for (const content of Object.values(files)) {
    if (/import\s+\*\s+as\s+\w+\s+from\s+['"]lucide-react['"]/.test(content)) return null;
    for (const m of content.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (/^[A-Z][A-Za-z0-9]*$/.test(name)) names.push(name);
      }
    }
  }
  return names;
}

// Cache entre compilações na mesma instância (a 2ª prévia já sai sem baixar nada).
const remoteModules = new Map<string, Promise<string>>();
const MAX_REMOTE_BYTES = 6_000_000;

async function fetchRemoteModule(url: string): Promise<string> {
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'froc-ia-forja' } });
      if (res.ok) {
        const text = await res.text();
        if (text.length > MAX_REMOTE_BYTES) throw new Error(`pacote grande demais: ${url}`);
        return text;
      }
      lastError = `esm.sh respondeu ${res.status}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  const what = url.includes('lucide-react') ? 'os ícones (lucide-react) — confira se todos os nomes de ícones existem' : 'o React';
  throw new Error(`Não consegui baixar ${what} (${lastError}). Tente de novo em instantes.`);
}

function loadRemoteModule(url: string): Promise<string> {
  let cached = remoteModules.get(url);
  if (!cached) {
    cached = fetchRemoteModule(url);
    cached.catch(() => remoteModules.delete(url));
    remoteModules.set(url, cached);
  }
  return cached;
}
import path from 'path';

export interface BundleResult {
  ok: boolean;
  js: string;
  css: string;
  html: string;
  errors: string[];
}

function normalizeVirtualPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function resolveVirtualCandidate(
  rawPath: string,
  importer: string | undefined,
  files: Record<string, string>
): string | null {
  let target = rawPath;

  if (target.startsWith('@/')) {
    const stripped = target.slice(2);
    target = files[stripped] || files[`src/${stripped}`] ? stripped : `src/${stripped}`;
  } else if (importer && (target.startsWith('./') || target.startsWith('../'))) {
    const importerDir = path.posix.dirname(normalizeVirtualPath(importer));
    target = path.posix.normalize(
      importerDir === '.' ? target : path.posix.join(importerDir, target)
    );
  }

  target = normalizeVirtualPath(target);

  const candidates = [
    target,
    `${target}.tsx`,
    `${target}.ts`,
    `${target}.jsx`,
    `${target}.js`,
    `${target}/index.tsx`,
    `${target}/index.ts`,
  ];

  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(files, c)) {
      return c;
    }
  }
  return null;
}

/**
 * Compiles a virtual multi-file React + TypeScript project in memory with esbuild.
 * Resolves react, react-dom, and lucide-react from the host's node_modules.
 */
export async function compileVirtualReactProject(
  rawFiles: Record<string, string>,
  options: { withErrorBridge?: boolean; /** Testes: ignora o node_modules (como na Vercel). */ skipLocalPackages?: boolean } = {}
): Promise<BundleResult> {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFiles)) {
    files[normalizeVirtualPath(k)] = v;
  }

  // Ensure src/main.tsx exists if src/App.tsx exists
  if (!files['src/main.tsx'] && files['src/App.tsx']) {
    files['src/main.tsx'] = `import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
`;
  }

  // Legacy plain HTML fallback if no React entry is present
  if (!files['src/main.tsx'] && files['index.html']) {
    const rawHtml = files['index.html'] || '';
    const css = files['styles.css'] || '';
    const js = files['app.js'] || '';
    let html = rawHtml;
    if (css) {
      html = html.includes('</head>')
        ? html.replace('</head>', `<style>\n${css}\n</style>\n</head>`)
        : `<style>\n${css}\n</style>\n${html}`;
    }
    if (js) {
      const safeJs = js.replace(/<\/script>/gi, '<\\/script>');
      html = html.includes('</body>')
        ? html.replace('</body>', `<script>\n${safeJs}\n</script>\n</body>`)
        : `${html}\n<script>\n${safeJs}\n</script>`;
    }
    return { ok: true, js, css, html, errors: [] };
  }

  if (!files['src/main.tsx']) {
    return {
      ok: false,
      js: '',
      css: '',
      html: '',
      errors: ['Arquivo de entrada src/App.tsx ou src/main.tsx não encontrado.'],
    };
  }

  const allowedNodePackages = new Set([
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'lucide-react',
  ]);

  const lucideImports = lucideImportsIn(files);

  try {
    const esbuild = await loadEsbuild();
    const result = await esbuild.build({
      entryPoints: ['virtual:src/main.tsx'],
      bundle: true,
      write: false,
      logLevel: 'silent',
      minify: true,
      treeShaking: true,
      format: 'iife',
      jsx: 'automatic',
      target: ['es2020'],
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      plugins: [
        {
          name: 'forja-virtual-fs',
          setup(build) {
            build.onResolve({ filter: /.*/ }, async (args) => {
              if (args.path.startsWith('virtual:')) {
                const norm = normalizeVirtualPath(args.path.slice(8));
                return { path: norm, namespace: 'vfs' };
              }

              // Ignore CSS imports inside TSX (we inline src/index.css directly)
              if (args.path.endsWith('.css')) {
                return { path: args.path, namespace: 'vfs-css' };
              }

              if (
                args.namespace === 'vfs' &&
                (args.path.startsWith('./') ||
                  args.path.startsWith('../') ||
                  args.path.startsWith('@/'))
              ) {
                const resolved = resolveVirtualCandidate(
                  args.path,
                  args.importer,
                  files
                );
                if (resolved) {
                  return { path: resolved, namespace: 'vfs' };
                }
                return {
                  errors: [
                    {
                      text: `Módulo não encontrado: "${args.path}" importado por "${args.importer}"`,
                    },
                  ],
                };
              }

              // Dentro de um módulo baixado do esm.sh: caminhos do próprio esm.sh e pacotes fixados.
              if (args.namespace === 'esm') {
                if (/^https?:\/\//.test(args.path) || args.path.startsWith('/') || args.path.startsWith('.')) {
                  return { path: new URL(args.path, args.importer).href, namespace: 'esm' };
                }
                const pinned = esmUrlFor(args.path);
                if (pinned) return { path: pinned, namespace: 'esm' };
                return { errors: [{ text: `Pacote interno não suportado: "${args.path}"` }] };
              }

              // React, React DOM e Lucide: node_modules quando existir; senão, esm.sh.
              if (allowedNodePackages.has(args.path)) {
                if ((args.pluginData as { forjaInner?: boolean } | undefined)?.forjaInner) return undefined;
                const local = options.skipLocalPackages
                  ? { errors: [{ text: 'pulado' }], path: '', namespace: '', external: false, sideEffects: undefined }
                  : await build.resolve(args.path, {
                  kind: args.kind,
                  resolveDir: process.cwd(),
                  importer: args.importer,
                  pluginData: { forjaInner: true },
                });
                if (local.errors.length === 0 && local.path && !local.external) {
                  return { path: local.path, namespace: local.namespace, sideEffects: local.sideEffects };
                }
                const remote = esmUrlFor(args.path, args.path === 'lucide-react' ? lucideImports : null);
                if (remote) return { path: remote, namespace: 'esm' };
                return undefined;
              }

              // Disallow unknown external packages when coming from virtual files
              if (args.namespace === 'vfs') {
                return {
                  errors: [
                    {
                      text: `Pacote externo não suportado no sandbox: "${args.path}". Utilize React, Lucide Icons (lucide-react), Tailwind CSS ou SVG/Canvas nativos.`,
                    },
                  ],
                };
              }

              return undefined;
            });

            build.onLoad({ filter: /.*/, namespace: 'esm' }, async (args) => {
              const contents = await loadRemoteModule(args.path);
              return { contents, loader: 'js' };
            });

            build.onLoad({ filter: /.*/, namespace: 'vfs-css' }, () => {
              return { contents: '', loader: 'js' };
            });

            build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => {
              const content = files[args.path];
              if (content === undefined) {
                return {
                  errors: [{ text: `Arquivo virtual não encontrado: ${args.path}` }],
                };
              }
              const ext = args.path.endsWith('.tsx')
                ? 'tsx'
                : args.path.endsWith('.ts')
                  ? 'ts'
                  : args.path.endsWith('.jsx')
                    ? 'jsx'
                    : args.path.endsWith('.json')
                      ? 'json'
                      : 'js';
              return {
                contents: content,
                loader: ext,
                resolveDir: process.cwd(),
              };
            });
          },
        },
      ],
    });

    const compiledJs = result.outputFiles?.[0]?.text || '';
    const rawCss = files['src/index.css'] || files['styles.css'] || '';
    const cleanedCss = rawCss
      .replace(/@import\s+["']tailwindcss["'];?/gi, '')
      .replace(/@custom-variant\s+dark\s+[^;]+;/gi, '')
      .trim();

    const html = assembleCompiledHtml({
      indexHtml: files['index.html'] || '',
      compiledJs,
      customCss: cleanedCss,
      withErrorBridge: options.withErrorBridge,
    });

    return {
      ok: true,
      js: compiledJs,
      css: cleanedCss,
      html,
      errors: [],
    };
  } catch (err: unknown) {
    const buildErr = err as {
      errors?: Array<{ text: string; location?: { file?: string; line?: number; column?: number } }>;
      message?: string;
    };
    const formattedErrors: string[] = [];
    if (Array.isArray(buildErr.errors) && buildErr.errors.length > 0) {
      for (const e of buildErr.errors) {
        const loc = e.location?.file
          ? `${e.location.file}:${e.location.line ?? 1}:${e.location.column ?? 0} — `
          : '';
        formattedErrors.push(`${loc}${e.text}`);
      }
    } else if (buildErr.message) {
      formattedErrors.push(buildErr.message);
    } else {
      formattedErrors.push('Erro desconhecido ao compilar o projeto React/TypeScript.');
    }

    return {
      ok: false,
      js: '',
      css: '',
      html: '',
      errors: formattedErrors,
    };
  }
}

export function assembleCompiledHtml(params: {
  indexHtml: string;
  compiledJs: string;
  customCss: string;
  withErrorBridge?: boolean;
}): string {
  const baseHtml =
    params.indexHtml && params.indexHtml.trim()
      ? params.indexHtml
      : `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aplicação em Produção</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

  let html = baseHtml;

  // Ensure Tailwind CDN is present for standalone compiled HTML / preview
  if (!/cdn\.tailwindcss\.com/i.test(html)) {
    const twTag = `<script src="https://cdn.tailwindcss.com"></script>`;
    html = html.includes('</head>')
      ? html.replace('</head>', `  ${twTag}\n  </head>`)
      : `${twTag}\n${html}`;
  }

  html = stripLocalScripts(html);

  // Inject custom CSS
  if (params.customCss) {
    const styleBlock = `<style data-forja-styles>\n${params.customCss}\n</style>`;
    html = html.includes('</head>')
      ? html.replace('</head>', `  ${styleBlock}\n  </head>`)
      : `${styleBlock}\n${html}`;
  }

  const errorBridge = params.withErrorBridge
    ? `<script data-forja-preview-bridge>
(function() {
  function report(msg, src, line) {
    try {
      window.parent.postMessage({
        type: 'FORJA_PREVIEW_ERROR',
        payload: { message: String(msg), source: src || '', line: line || 0, timestamp: Date.now() }
      }, '*');
    } catch (_) { /* janela pai indisponível */ }
  }
  window.addEventListener('error', function(e) {
    if (e && e.message) report(e.message, e.filename, e.lineno);
  });
  window.addEventListener('unhandledrejection', function(e) {
    var reason = e && e.reason ? (e.reason.message || String(e.reason)) : 'Promise rejection';
    report(reason, 'bundle.js', 0);
  });
})();
</script>`
    : '';

  // Escape </script> inside compiled JS safely
  const safeJs = params.compiledJs.replace(/<\/script>/gi, '<\\/script>');
  const bundleBlock = `${errorBridge}\n<script data-forja-bundle>\n${safeJs}\n</script>`;

  if (html.includes('</body>')) {
    html = html.replace('</body>', `${bundleBlock}\n</body>`);
  } else {
    html = `${html}\n${bundleBlock}`;
  }

  return html;
}

/**
 * O site final é UM arquivo: todo <script src> local (./src/main.tsx, /src/main.tsx, app.js...)
 * e todo importmap são removidos, porque o código já vai embutido. Antes, um caminho como
 * "./src/main.tsx" escapava e o navegador baixava a página da Froc no lugar do script
 * ("Uncaught SyntaxError: Unexpected token '<'"). Scripts de CDN (Tailwind) continuam.
 */
export function stripLocalScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*type=["']importmap["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\bsrc=["']([^"']*)["'][^>]*>\s*<\/script>/gi, (tag, src: string) =>
      /^(?:https?:)?\/\//i.test(src.trim()) ? tag : ''
    )
    .replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/gi, '')
    .replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["'](?!https?:|\/\/)[^"']*["'][^>]*>/gi, '');
}
