import * as esbuild from 'esbuild';
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
  options: { withErrorBridge?: boolean } = {}
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

  try {
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
            build.onResolve({ filter: /.*/ }, (args) => {
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

              // Allow core packages from node_modules
              if (allowedNodePackages.has(args.path)) {
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

  // Remove Vite module script tag pointing to /src/main.tsx so we replace with compiled bundle
  html = html.replace(
    /<script\b[^>]*type=["']module["'][^>]*src=["']\/?src\/main\.tsx["'][^>]*><\/script>/gi,
    ''
  );

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
    } catch (_) {}
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
