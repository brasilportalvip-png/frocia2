import templatePackage from "./templates/package.json";
import templateLock from "./templates/package-lock.json";
import { createHash } from "node:crypto";
import { ProfessionalBundle, sourceDigest } from "./professionalContract.js";
export interface ProjectFile {
  path: string;
  content: string;
}
export const managedProjectName = (key: string) =>
  "froc-" + createHash("sha256").update(key).digest("hex").slice(0, 24);
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const consentScript = `(() => {
const key='froc-consent-v1'; let choice=null;
try { const saved=JSON.parse(localStorage.getItem(key)); if(saved&&saved.expires>Date.now())choice={analytics:saved.analytics===true,marketing:saved.marketing===true}; }catch{}
function enable(){for(const el of document.querySelectorAll('script[type="text/plain"][data-froc-consent]')){if(!choice?.[el.dataset.frocConsent]||el.dataset.loaded)continue;el.dataset.loaded='true';const script=document.createElement('script');if(el.dataset.src)script.src=el.dataset.src;else script.textContent=el.textContent;document.head.append(script);}}
const panel=document.createElement('section');panel.id='froc-consent';panel.setAttribute('aria-label','Preferências de cookies');panel.style.cssText='position:fixed;bottom:12px;left:12px;right:12px;z-index:2147483000;max-width:620px;background:#111827;color:#fff;padding:18px;border-radius:16px;box-shadow:0 4px 20px #0006;font:15px system-ui';
panel.innerHTML='<p style="margin:0 0 12px">Usamos cookies necessários. Você escolhe se permite análise de uso e marketing. <a href="/legal/cookies.html" style="color:#c4b5fd">Política de cookies</a></p><div id="froc-cookie-options" hidden><label style="display:block"><input type="checkbox" id="froc-analytics"> Permitir análise de uso</label><label style="display:block"><input type="checkbox" id="froc-marketing"> Permitir marketing</label></div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px"><button data-froc-choice="reject">Rejeitar opcionais</button><button data-froc-choice="custom">Personalizar</button><button data-froc-choice="accept">Aceitar opcionais</button><button data-froc-choice="save" hidden>Salvar preferências</button></div>';
for(const b of panel.querySelectorAll('button'))b.style.cssText='padding:10px 12px;border-radius:8px;border:1px solid #94a3b8;background:#fff;color:#111827;font:inherit;cursor:pointer';
const reopen=document.createElement('button');reopen.textContent='Cookies';reopen.setAttribute('aria-label','Alterar preferências de cookies');reopen.style.cssText='position:fixed;bottom:8px;left:8px;z-index:2147482999;background:#111827;color:white;border:1px solid #94a3b8;border-radius:8px;padding:8px';
reopen.onclick=()=>{panel.hidden=false;reopen.hidden=true;panel.querySelector('button').focus()};
panel.onclick=e=>{const action=e.target.closest('[data-froc-choice]')?.dataset.frocChoice;if(!action)return;if(action==='custom'){panel.querySelector('#froc-cookie-options').hidden=false;panel.querySelector('[data-froc-choice=save]').hidden=false;return;}const old=choice;choice=action==='accept'?{analytics:true,marketing:true}:action==='reject'?{analytics:false,marketing:false}:{analytics:panel.querySelector('#froc-analytics').checked,marketing:panel.querySelector('#froc-marketing').checked};try{localStorage.setItem(key,JSON.stringify({...choice,expires:Date.now()+15552000000}));}catch{}panel.hidden=true;reopen.hidden=false;if(old&&((old.analytics&&!choice.analytics)||(old.marketing&&!choice.marketing))){location.reload();return;}enable();};
document.body.append(panel,reopen);panel.hidden=Boolean(choice);reopen.hidden=!choice;enable();
})();`;
export function scaffoldProject(
  bundle: ProfessionalBundle,
  projectKey: string,
): { files: ProjectFile[]; releaseDigest: string } {
  const releaseDigest = sourceDigest(bundle.files);
  const variableNames = bundle.variables
    .filter((v) => v.visibility === "public")
    .map((v) => v.name);
  const key = createHash("sha256").update(projectKey).digest("hex");
  const extra: Record<string, string> = {
    "package.json": JSON.stringify(templatePackage, null, 2),
    "package-lock.json": JSON.stringify(templateLock, null, 2),
    ".gitignore":
      "node_modules\ndist\n.env*\nplaywright-report\ntest-results\n",
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          skipLibCheck: true,
          esModuleInterop: true,
          noEmit: true,
          lib: ["ES2022", "DOM"],
          types: ["node", "vite/client"],
        },
        include: ["src", "api", "tests"],
      },
      null,
      2,
    ),
    "vite.config.ts": `import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig({plugins:[react()]});`,
    "src/froc-env.d.ts":
      "export {}; declare global { interface Window { FROC_PUBLIC_CONFIG: Record<string,string>; FrocConfigReady: Promise<void>; } }",
    "vercel.json": JSON.stringify(
      {
        version: 2,
        framework: "vite",
        buildCommand: "npm run build",
        outputDirectory: "dist",
        rewrites: [
          { source: "/robots.txt", destination: "/api/froc-robots" },
          { source: "/sitemap.xml", destination: "/api/froc-sitemap" },
          {
            source: "/((?!api/|legal/|assets/|froc-|.*\\.).*)",
            destination: "/index.html",
          },
        ],
        headers: [
          {
            source: "/(.*)",
            headers: [
              { key: "X-Content-Type-Options", value: "nosniff" },
              {
                key: "Referrer-Policy",
                value: "strict-origin-when-cross-origin",
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
    "public/froc-app.webmanifest": JSON.stringify({
      name: bundle.title,
      short_name: bundle.title.slice(0, 24),
      description: bundle.description,
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#0f172a",
      theme_color: "#0f172a",
      icons: [
        {
          src: "/froc-icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable",
        },
      ],
    }),
    "public/froc-icon.svg":
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0f172a"/><path d="M128 128h256v64H192v64h160v64H192v64h-64z" fill="#a78bfa"/></svg>',
    "public/froc-offline.html":
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sem conexão</title></head><body style="font:18px system-ui;padding:32px"><main><h1>Você está sem conexão</h1><p>Conecte-se novamente para consultar dados, entrar na conta ou enviar informações. Nenhuma operação foi confirmada nesta tela.</p><button onclick="location.reload()">Tentar novamente</button></main></body></html>',
    "public/froc-sw.js": `const CACHE='froc-static-${releaseDigest.slice(0, 16)}';self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.add('/froc-offline.html'))));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('froc-static-')&&k!==CACHE).map(k=>caches.delete(k))))));self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/froc-offline.html')));return;}if(url.pathname.startsWith('/assets/'))e.respondWith(caches.open(CACHE).then(async cache=>{const stored=await cache.match(e.request);if(stored)return stored;const response=await fetch(e.request);if(response.ok)await cache.put(e.request,response.clone());return response;}));});`,
    "public/froc-pwa.js": `if('serviceWorker' in navigator&&location.protocol==='https:')window.addEventListener('load',()=>navigator.serviceWorker.register('/froc-sw.js').catch(()=>{}));`,
    "public/froc-config.js": `window.FROC_PUBLIC_CONFIG={};window.FrocConfigReady=fetch('/api/froc-public-config',{credentials:'same-origin',cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Configuração indisponível');return r.json()}).then(v=>{window.FROC_PUBLIC_CONFIG=v;const canonical=document.querySelector('link[rel=canonical]')||document.head.appendChild(document.createElement('link'));canonical.rel='canonical';canonical.href=v.PUBLIC_SITE_URL+location.pathname;}).catch(e=>{document.documentElement.dataset.configurationError='true';throw e;});`,
    "api/froc-public-config.ts": `const names=${JSON.stringify(variableNames)};export default function handler(_req:any,res:any){res.setHeader('Cache-Control','no-store');res.status(200).json(Object.fromEntries(names.map(n=>[n,process.env[n]||''])));}`,
    "api/froc-robots.ts": `export default function handler(_req:any,res:any){res.setHeader('Content-Type','text/plain');const prod=process.env.FROC_DEPLOYMENT_ENVIRONMENT==='production';res.status(200).send(prod?'User-agent: *\\nAllow: /\\nDisallow: /api/\\nSitemap: '+process.env.PUBLIC_SITE_URL+'/sitemap.xml':'User-agent: *\\nDisallow: /');}`,
    "api/froc-sitemap.ts": `export default function handler(_req:any,res:any){res.setHeader('Content-Type','application/xml');const origin=String(process.env.PUBLIC_SITE_URL||'');if(!/^https:\\/\\/[a-z0-9.-]+$/i.test(origin))return res.status(503).send('Configuração pendente');const urls=process.env.FROC_DEPLOYMENT_ENVIRONMENT==='production'?${JSON.stringify([...new Set([...bundle.publicPages, "/legal/privacy.html", "/legal/terms.html", "/legal/cookies.html"])])}:[];res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(p=>'<url><loc>'+origin+p+'</loc></url>').join('')+'</urlset>');}`,
    "public/froc-consent.js": consentScript,
    "public/.well-known/froc-release.json": JSON.stringify({ releaseDigest }),
    ["public/" + key + ".txt"]: key,
    "froc-delivery.json": JSON.stringify(
      {
        releaseDigest,
        requirements: bundle.requirements,
        journeys: bundle.journeys,
        integrations: bundle.integrations,
        payments: bundle.payments,
      },
      null,
      2,
    ),
    "froc-playwright.config.ts": `import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'tests',testMatch:'froc-browser.spec.ts',timeout:45000,workers:1,use:{baseURL:'http://127.0.0.1:4174'},webServer:{command:'npx vite preview --host 127.0.0.1 --port 4174',url:'http://127.0.0.1:4174'}});`,
    "tests/froc-browser.spec.ts": `import {test,expect} from '@playwright/test';import AxeBuilder from '@axe-core/playwright';test('responsive consent and accessibility',async({page})=>{await page.route('**/api/froc-public-config',r=>r.fulfill({json:{PUBLIC_BUSINESS_NAME:'Teste',PUBLIC_CONTACT_EMAIL:'teste@example.com',PUBLIC_SITE_URL:'https://example.com'}}));for(const width of [360,768,1440]){await page.setViewportSize({width,height:900});await page.goto('/');await expect(page.locator('body')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);}await page.getByRole('button',{name:'Rejeitar opcionais',exact:true}).click();await page.getByRole('button',{name:'Alterar preferências de cookies',exact:true}).click();await expect(page.getByRole('button',{name:'Personalizar',exact:true})).toBeVisible();const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(result.violations.filter(v=>['critical','serious'].includes(v.impact||''))).toEqual([]);});`,
  };
  for (const [part, title, text] of [
    ["privacy", "Privacidade", bundle.legal.privacy],
    ["terms", "Termos de uso", bundle.legal.terms],
    ["cookies", "Cookies", bundle.legal.cookies],
  ])
    extra["public/legal/" + part + ".html"] =
      `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><script src="/froc-config.js"></script><script defer src="/froc-consent.js"></script></head><body style="max-width:760px;margin:40px auto;padding:20px;font:17px/1.7 system-ui"><nav><a href="/">Início</a></nav><main><h1>${title}</h1><p>Responsável: <span data-business></span>. Contato: <span data-contact></span>.</p><p style="white-space:pre-wrap">${escape(text)}</p></main><script>window.FrocConfigReady.then(()=>{document.querySelector('[data-business]').textContent=window.FROC_PUBLIC_CONFIG.PUBLIC_BUSINESS_NAME;document.querySelector('[data-contact]').textContent=window.FROC_PUBLIC_CONFIG.PUBLIC_CONTACT_EMAIL;});</script></body></html>`;
  const files = bundle.files.map((file) =>
    file.path === "index.html"
      ? {
          ...file,
          content: file.content.replace(
            /<head([^>]*)>/i,
            '<head$1><link rel="manifest" href="/froc-app.webmanifest"><link rel="icon" href="/froc-icon.svg"><meta name="theme-color" content="#0f172a"><script defer src="/froc-pwa.js"></script><script src="/froc-config.js"></script><script defer src="/froc-consent.js"></script>',
          ),
        }
      : file,
  );
  files.push(
    ...Object.entries(extra).map(([path, content]) => ({ path, content })),
  );
  return { files, releaseDigest };
}
