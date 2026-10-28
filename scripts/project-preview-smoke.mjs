import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export async function verifyProjectPreview(browser, directory = path.resolve(process.env.DEVELOPMENT_ACCEPTANCE_OUTPUT || 'development-acceptance')) {
  const html = await fs.readFile(path.join(directory, 'preview.html'), 'utf8');
  const scenarios = [];
  for (const viewport of [{ name: 'desktop', width: 1365, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage(), requests = [], errors = [], consoleErrors = [];
    let rejectRuntime;
    const runtimeFailure = new Promise((_, reject) => { rejectRuntime = reject; });
    runtimeFailure.catch(() => {});
    const checked = operation => Promise.race([operation, runtimeFailure]);
    page.on('pageerror', error => { errors.push(error.message); rejectRuntime(new Error(`Preview runtime error: ${error.message}`)); });
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 1000)); });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://preview.invalid' && url.pathname === '/') return route.fulfill({ contentType: 'text/html',
        headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src 'self' blob:; connect-src 'none'" },
        body: '<!doctype html><html><body><iframe title="Imported project" sandbox="allow-scripts" style="width:100%;height:900px"></iframe></body></html>' });
      requests.push(route.request().url()); return route.abort();
    });
    try {
      await checked(page.goto('https://preview.invalid/'));
      await page.locator('iframe').evaluate((frame, source) => { frame.srcdoc = source; }, html);
      const frame = page.frameLocator('iframe');
      await checked(frame.locator('body').filter({ hasText: /Froc|marketing/i }).waitFor({ timeout: 20_000 }));
      const button = frame.getByRole('button', { name: /Entrar\s*\/\s*(?:Criar Conta|Cadastrar)/i }).first();
      await checked(button.click({ timeout: 15_000 }));
      const login = frame.getByRole('dialog', { name: /Entrar no Froc/i });
      await checked(login.waitFor({ timeout: 15_000 }));
      await checked(login.getByRole('button', { name: /^Criar conta$/i }).click());
      const registration = frame.getByRole('dialog', { name: /Criar conta Froc/i });
      await checked(registration.waitFor({ timeout: 15_000 }));
      await checked(registration.getByRole('button', { name: /^Já tenho conta$/i }).click());
      await checked(login.waitFor({ timeout: 15_000 }));
      const isolation = await frame.locator('html').evaluate(() => {
        try { void parent.document.body; return { parentAccessBlocked: false }; }
        catch (error) { return { parentAccessBlocked: error.name === 'SecurityError' }; }
      });
      if (!isolation.parentAccessBlocked || await page.locator('iframe').getAttribute('sandbox') !== 'allow-scripts') throw new Error('Opaque iframe isolation not preserved.');
      if (errors.length) throw new Error(`Preview runtime errors: ${errors.join('; ').slice(0, 500)}`);
      scenarios.push({ viewport: viewport.name, width: viewport.width, height: viewport.height, loaded: true, accessibleDialog: true,
        registrationAndReturn: true, parentAccessBlocked: true, externalRequestsBlocked: requests.length, runtimeErrors: errors });
    } catch (error) {
      const frame = page.frameLocator('iframe');
      const diagnostic = { viewport: viewport.name, error: String(error), runtimeErrors: errors, consoleErrors: consoleErrors.slice(-15),
        buttons: await frame.getByRole('button').allTextContents().catch(() => []),
        body: await frame.locator('body').innerText({ timeout: 1000 }).then(text => text.slice(0, 4000)).catch(() => 'unavailable') };
      await fs.writeFile(path.join(directory, 'browser-smoke.json'), JSON.stringify({ loaded: false, browserVersion: browser.version(), scenarios, diagnostic }, null, 2));
      console.error(JSON.stringify(diagnostic, null, 2)); throw error;
    } finally { await context.close(); }
  }
  const report = { loaded: true, accessibleDialog: true, browserVersion: browser.version(), sandbox: 'allow-scripts', sameOriginGranted: false,
    scenarios, externalRequestsBlocked: scenarios.reduce((total, item) => total + item.externalRequestsBlocked, 0), runtimeErrors: [] };
  await fs.writeFile(path.join(directory, 'browser-smoke.json'), JSON.stringify(report, null, 2));
  console.log('Desktop/mobile: rendered UI, login, registration, return and opaque iframe passed.');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch({ headless: true });
  try { await verifyProjectPreview(browser); } finally { await browser.close(); }
}
