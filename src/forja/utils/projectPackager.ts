import { strToU8, zipSync } from 'fflate';
import type { AuditCheck } from '../types';

export function slugifyProjectName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '') || 'meu-site-producao'
  );
}

/**
 * Generates standard Vite + React + TypeScript + Tailwind production files
 * alongside the AI-generated source files (and optional pre-built dist/index.html).
 */
export function buildProductionBundleFiles(
  projectName: string,
  files: Record<string, string>,
  standaloneHtml?: string
): Record<string, string> {
  const indexHtml = files['index.html'] || '';
  const slug = slugifyProjectName(projectName);

  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(indexHtml);
  const siteTitle = titleMatch ? titleMatch[1].trim() : projectName;

  const descMatch = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(
    indexHtml
  );
  const siteDesc =
    descMatch?.[1]?.trim() ||
    `${siteTitle} — Aplicação web completa e pronta para produção.`;

  const isReactProject = Boolean(files['src/App.tsx'] || files['src/main.tsx']);

  const bundle: Record<string, string> = {};
  for (const [filePath, content] of Object.entries(files)) {
    bundle[filePath] = content;
  }

  if (Object.keys(bundle).length === 0) return bundle;

  if (isReactProject && !bundle['src/main.tsx']) {
    bundle['src/main.tsx'] = `import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
`;
  }

  if (isReactProject && !bundle['src/index.css']) {
    bundle['src/index.css'] = `@import "tailwindcss";\n`;
  }

  if (isReactProject && !bundle['vite.config.ts']) {
    bundle['vite.config.ts'] = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
`;
  }

  if (isReactProject && !bundle['tsconfig.json']) {
    bundle['tsconfig.json'] = JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['src'],
      },
      null,
      2
    );
  }

  if (!bundle['package.json']) {
    bundle['package.json'] = isReactProject
      ? JSON.stringify(
          {
            name: slug,
            version: '1.0.0',
            private: true,
            type: 'module',
            description: siteDesc,
            scripts: {
              dev: 'vite',
              build: 'vite build',
              preview: 'vite preview',
            },
            dependencies: {
              'lucide-react': '^0.546.0',
              react: '^19.0.1',
              'react-dom': '^19.0.1',
            },
            devDependencies: {
              '@tailwindcss/vite': '^4.3.3',
              '@types/react': '^19.0.0',
              '@types/react-dom': '^19.0.0',
              '@vitejs/plugin-react': '^6.1.1',
              tailwindcss: '^4.3.3',
              typescript: '^5.7.0',
              vite: '^6.2.0',
            },
          },
          null,
          2
        )
      : JSON.stringify(
          {
            name: slug,
            version: '1.0.0',
            private: true,
            description: siteDesc,
            scripts: {
              start: 'npx serve . -l 3000',
              preview: 'npx serve . -l 4173',
            },
          },
          null,
          2
        );
  }

  bundle['public/manifest.json'] = JSON.stringify(
    {
      name: siteTitle,
      short_name: projectName.slice(0, 24),
      description: siteDesc,
      start_url: '/',
      display: 'standalone',
      background_color: '#0f172a',
      theme_color: '#2563eb',
    },
    null,
    2
  );

  bundle['public/robots.txt'] = `User-agent: *\nAllow: /\n\nSitemap: /sitemap.xml\n`;

  bundle['public/sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://exemplo.com/</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;

  bundle['vercel.json'] = JSON.stringify(
    {
      $schema: 'https://openapi.vercel.sh/vercel.json',
      cleanUrls: true,
      trailingSlash: false,
      ...(isReactProject
        ? { buildCommand: 'npm run build', outputDirectory: 'dist' }
        : {}),
      headers: [
        {
          source: '/(.*)',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          ],
        },
      ],
    },
    null,
    2
  );

  bundle['netlify.toml'] = isReactProject
    ? `[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`
    : `[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "SAMEORIGIN"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
`;

  if (standaloneHtml) {
    bundle['dist/index.html'] = standaloneHtml;
  }

  bundle['README.md'] = `# ${siteTitle}

${siteDesc}

## Opção 1: Publicação Imediata (Sem Build)

A pasta \`dist/index.html\` já contém a aplicação compilada em arquivo único pronto para produção. Você pode arrastar a pasta \`dist\` diretamente para o **Netlify Drop** ou abrir no navegador.

## Opção 2: Projeto Fonte Vite + React + TypeScript

\`\`\`bash
npm install
npm run dev      # Desenvolvimento local
npm run build    # Build otimizado de produção em dist/
\`\`\`

Compatível nativamente com **Vercel** (\`vercel.json\`) e **Netlify** (\`netlify.toml\`).
`;

  return bundle;
}

/**
 * Legacy fallback assembler for plain HTML/CSS/JS bundles.
 */
export function assembleStandaloneHtml(
  files: Record<string, string>,
  options: { withErrorBridge?: boolean } = {}
): string {
  const rawHtml = files['index.html'] || '';
  if (!rawHtml.trim()) return '';

  const css = files['styles.css'] || files['src/index.css'] || '';
  const js = files['app.js'] || '';

  let html = rawHtml;

  const cssLinkRegex = /<link\b[^>]*href=["'](?:\.\/)?styles\.css["'][^>]*\/?>/i;
  if (css.trim()) {
    const cleaned = css.replace(/@import\s+["']tailwindcss["'];?/gi, '');
    const styleBlock = `<style data-forja-bundle="styles.css">\n${cleaned}\n</style>`;
    if (cssLinkRegex.test(html)) {
      html = html.replace(cssLinkRegex, styleBlock);
    } else if (html.includes('</head>')) {
      html = html.replace('</head>', `${styleBlock}\n</head>`);
    } else {
      html = `${styleBlock}\n${html}`;
    }
  }

  const errorBridgeScript = options.withErrorBridge
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
    report(reason, 'app.js', 0);
  });
})();
</script>`
    : '';

  const jsScriptRegex = /<script\b[^>]*src=["'](?:\.\/)?app\.js["'][^>]*><\/script>/i;
  const safeJs = js.replace(/<\/script>/gi, '<\\/script>');
  const scriptBlock = js.trim()
    ? `${errorBridgeScript}\n<script data-forja-bundle="app.js">\n${safeJs}\n</script>`
    : errorBridgeScript;

  if (scriptBlock) {
    if (jsScriptRegex.test(html)) {
      html = html.replace(jsScriptRegex, scriptBlock);
    } else if (html.includes('</body>')) {
      html = html.replace('</body>', `${scriptBlock}\n</body>`);
    } else {
      html = `${html}\n${scriptBlock}`;
    }
  }

  return html;
}

export async function exportProjectAsZip(
  projectName: string,
  files: Record<string, string>,
  standaloneHtml?: string
): Promise<Blob> {
  const bundle = buildProductionBundleFiles(projectName, files, standaloneHtml);
  const folderName = slugifyProjectName(projectName);
  const entries: Record<string, Uint8Array> = {};
  for (const [filePath, content] of Object.entries(bundle)) {
    entries[`${folderName}/${filePath}`] = strToU8(content);
  }
  const zipped = zipSync(entries, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

/**
 * Deterministic static audit over generated React/TypeScript/HTML files.
 */
export function runProductionAudit(
  projectName: string,
  files: Record<string, string>,
  standaloneHtml?: string
): AuditCheck[] {
  const html = files['index.html'] || '';
  const allCode = Object.values(files).join('\n');
  const sourceCode = Object.entries(files)
    .filter(([p]) => /\.(tsx?|jsx?|js)$/i.test(p))
    .map(([, c]) => c)
    .join('\n');
  const bundle = buildProductionBundleFiles(projectName, files, standaloneHtml);

  const checks: AuditCheck[] = [];

  // 1. Semantic HTML5 across index.html + React JSX
  const hasDoctype = /<!doctype\s+html>/i.test(html);
  const hasLang = /<html[^>]+lang=/i.test(html);
  const hasLandmarks =
    /<main\b/i.test(allCode) && (/<header\b/i.test(allCode) || /<nav\b/i.test(allCode));
  checks.push({
    id: 'semantic-html',
    category: 'HTML & SEO',
    title: 'Estrutura HTML5 Semântica',
    description: 'Verifica DOCTYPE, atributo de idioma e marcos semânticos (<header>, <main>, <footer>).',
    status: hasDoctype && hasLang && hasLandmarks ? 'pass' : html ? 'warn' : 'fail',
    detail:
      hasDoctype && hasLang && hasLandmarks
        ? 'DOCTYPE, lang e landmarks semânticos presentes.'
        : 'Faltam tags semânticas (<main>, <header>) ou atributo lang no HTML.',
    fixPrompt:
      'Garanta que index.html tenha <!doctype html> e lang="pt-BR", e que os componentes React utilizem landmarks semânticos <header>, <main> e <footer>.',
  });

  // 2. SEO & Meta Tags
  const hasTitle = /<title>[^<]{4,}<\/title>/i.test(html);
  const hasMetaDesc = /<meta\s+[^>]*name=["']description["'][^>]*content=["'][^"']{10,}["']/i.test(
    html
  );
  const hasViewport = /<meta\s+[^>]*name=["']viewport["']/i.test(html);
  const hasOg = /<meta\s+[^>]*property=["']og:title["']/i.test(html);
  checks.push({
    id: 'seo-meta',
    category: 'HTML & SEO',
    title: 'Metadados SEO e OpenGraph',
    description: 'Confirma presença de <title>, meta description, viewport mobile e og:title.',
    status:
      hasTitle && hasMetaDesc && hasViewport && hasOg
        ? 'pass'
        : hasTitle && hasViewport
          ? 'warn'
          : 'fail',
    detail:
      hasTitle && hasMetaDesc && hasViewport && hasOg
        ? 'Título, descrição, viewport e tags OpenGraph configurados.'
        : 'Meta description ou tags OpenGraph (og:title) incompletas.',
    fixPrompt:
      'Adicione tags completas de SEO no <head> do index.html: <title>, <meta name="description">, <meta property="og:title"> e <meta property="og:description">.',
  });

  // 3. Responsiveness & Styling
  const hasTailwind = /tailwindcss\.com/i.test(html) || /@import\s+["']tailwindcss["']/i.test(allCode);
  const hasResponsiveBreakpoints = /(sm:|md:|lg:|@media)/i.test(allCode);
  checks.push({
    id: 'responsive-layout',
    category: 'Design & Responsividade',
    title: 'Layout Responsivo Multi-Dispositivo',
    description: 'Valida uso de breakpoints responsivos para mobile, tablet e desktop.',
    status: hasTailwind && hasResponsiveBreakpoints ? 'pass' : 'warn',
    detail:
      hasTailwind && hasResponsiveBreakpoints
        ? 'Breakpoints responsivos e Tailwind CSS ativos.'
        : 'Poucos breakpoints responsivos detectados; revise o comportamento em telas móveis.',
    fixPrompt:
      'Aprimore a responsividade garantindo menu mobile funcional, grid adaptável (md:/lg:) e zero overflow horizontal em 390px.',
  });

  // 4. Zero Broken External Assets
  const fragileImageHosts = /(unsplash\.com|picsum\.photos|via\.placeholder\.com|placeholder\.com)/i.test(
    allCode
  );
  checks.push({
    id: 'zero-broken-assets',
    category: 'Design & Responsividade',
    title: 'Ativos Visuais Autônomos (Zero 404)',
    description: 'Garante ausência de URLs externas frágeis ou imagens quebradas.',
    status: !fragileImageHosts ? 'pass' : 'warn',
    detail: !fragileImageHosts
      ? 'Nenhuma URL de imagem externa frágil detectada; recursos visuais autocontidos.'
      : 'Detectada URL externa frágil (unsplash/placeholder). Substitua por ilustrações SVG.',
    fixPrompt:
      'Substitua todas as URLs externas de imagem (unsplash/placeholder/picsum) por ilustrações SVG inline ou componentes visuais em React.',
  });

  // 5. Real React Interactivity & No Placeholders
  const hasReactInteractivity =
    /useState|onClick|onSubmit|onChange|addEventListener/i.test(sourceCode);
  const hasForbiddenStubs =
    /(window\.alert\s*\(|\balert\s*\(|lorem\s+ipsum|\bTODO\b|\bFIXME\b)/i.test(
      allCode
    );
  checks.push({
    id: 'js-interactivity',
    category: 'Interatividade JS',
    title: 'Estado e Lógica Real sem Placeholders',
    description: 'Verifica hooks/eventos React reais e ausência de TODOs, Lorem Ipsum ou window.alert.',
    status:
      hasReactInteractivity && !hasForbiddenStubs
        ? 'pass'
        : hasForbiddenStubs
          ? 'fail'
          : 'warn',
    detail:
      hasReactInteractivity && !hasForbiddenStubs
        ? 'Estado interativo e manipuladores reais ativos sem stubs temporários.'
        : hasForbiddenStubs
          ? 'Foram encontrados alertas nativos, TODOs ou textos Lorem Ipsum.'
          : 'Pouca interatividade detectada nos componentes.',
    fixPrompt:
      'Remova qualquer Lorem Ipsum, TODO ou window.alert() e garanta que todos os botões, formulários e filtros tenham interatividade real em React.',
  });

  // 6. Deployment Bundle Completeness
  const hasDeployConfigs =
    Boolean(bundle['vercel.json']) &&
    Boolean(bundle['netlify.toml']) &&
    Boolean(bundle['package.json']) &&
    Boolean(bundle['dist/index.html'] || files['index.html']);
  checks.push({
    id: 'deploy-bundle',
    category: 'Pacote de Deploy',
    title: 'Configs de Deploy e Compilado Final',
    description: 'Confirma pacote Vite/React completo, vercel.json, netlify.toml e dist/index.html compilado.',
    status: hasDeployConfigs ? 'pass' : 'fail',
    detail: hasDeployConfigs
      ? `${Object.keys(bundle).length} arquivos prontos para publicação imediata.`
      : 'Gere o site primeiro para montar e compilar o pacote completo de deploy.',
  });

  return checks;
}
