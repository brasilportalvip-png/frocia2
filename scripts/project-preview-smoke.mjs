import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const directory = path.resolve(process.env.DEVELOPMENT_ACCEPTANCE_OUTPUT || 'development-acceptance');
const html = await fs.readFile(path.join(directory, 'preview.html'), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'https://preview.invalid' && url.pathname === '/') return route.fulfill({ contentType: 'text/html',
      headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src 'self' blob:; connect-src 'none'" },
      body: '<!doctype html><html><body><iframe title="Imported project" sandbox="allow-scripts" style="width:100%;height:900px"></iframe></body></html>' });
    requests.push(route.request().url()); return route.abort();
  });
  await page.goto('https://preview.invalid/');
  await page.locator('iframe').evaluate((frame, source) => { frame.srcdoc = source; }, html);
  const frame = page.frameLocator('iframe');
  await frame.locator('body').filter({ hasText: /Froc|marketing/i }).waitFor({ timeout: 20_000 });
  const button = frame.getByRole('button', { name: /Entrar\s*\/\s*(?:Criar Conta|Cadastrar)/i }).first();
  await button.click({ timeout: 15_000 });
  await frame.getByRole('dialog', { name: /Entrar no Froc|Criar conta Froc/i }).waitFor({ timeout: 15_000 });
  if (errors.length) throw new Error(`Preview runtime errors: ${errors.join('; ').slice(0, 500)}`);
  await fs.writeFile(path.join(directory, 'browser-smoke.json'), JSON.stringify({ loaded: true, accessibleDialog: true, sandbox: 'allow-scripts', sameOriginGranted: false, externalRequestsBlocked: requests.length, runtimeErrors: errors }, null, 2));
  console.log('Opaque iframe and accessible dialog: passed.');
} finally { await browser.close(); }
