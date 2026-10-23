import { readFileSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateWorkerBrowserVersion } from '../scripts/validate-worker-browser-version.mjs';
import { run } from '../worker/sandbox-process.mjs';

const version = '1.62.1';
function fixtures(workerVersion = version) {
  const project = { packages: Object.fromEntries(['@playwright/test', 'playwright', 'playwright-core']
    .map(name => [`node_modules/${name}`, { version }])) };
  const manifest = { dependencies: { playwright: workerVersion } };
  const lock = { packages: { '': { dependencies: { playwright: workerVersion } },
    'node_modules/playwright': { version: workerVersion }, 'node_modules/playwright-core': { version: workerVersion } } };
  return { project, manifest, lock };
}

describe('Compatibilidade do navegador entre projeto e worker', () => {
  it('confere os arquivos reais usados para construir a imagem', () => {
    const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
    const project = read('package-lock.json');
    expect(validateWorkerBrowserVersion(project, read('worker/package.json'), read('worker/package-lock.json')))
      .toBe(project.packages['node_modules/@playwright/test'].version);
  });

  it('barra a divergencia 1.62.1/1.63.0 presente na rodada 32', () => {
    const { project, manifest, lock } = fixtures('1.63.0');
    expect(() => validateWorkerBrowserVersion(project, manifest, lock)).toThrow(/testes=1.62.1.*1.63.0/);
  });

  it('rejeita versao flutuante e playwright-core divergente', () => {
    const { project, manifest, lock } = fixtures();
    manifest.dependencies.playwright = '^1.62.1';
    expect(() => validateWorkerBrowserVersion(project, manifest, lock)).toThrow('worker_playwright_version_mismatch');
    manifest.dependencies.playwright = version;
    lock.packages['node_modules/playwright-core'].version = '1.63.0';
    expect(() => validateWorkerBrowserVersion(project, manifest, lock)).toThrow('worker_playwright_version_mismatch');
    lock.packages['node_modules/playwright-core'].version = version;
    (lock.packages as Record<string, unknown>)['node_modules/dep/node_modules/playwright-core'] = { version: '1.63.0' };
    expect(() => validateWorkerBrowserVersion(project, manifest, lock)).toThrow('worker_playwright_version_mismatch');
  });

  it('mostra o erro real quando o cache nao possui o navegador exigido pelo SDK do projeto', async () => {
    const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'froc-browser-cache-'));
    try {
      await fs.mkdir(path.join(cache, 'chromium_headless_shell-other-version'));
      const expectedRevision = JSON.parse(readFileSync('node_modules/playwright-core/browsers.json', 'utf8'))
        .browsers.find((browser: { name: string }) => browser.name === 'chromium-headless-shell').revision;
      const result = await run(process.execPath, ['--input-type=module', '-e', `
        import { chromium } from 'playwright';
        try { const browser = await chromium.launch(); await browser.close(); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
      `], process.cwd(), 10_000, { PLAYWRIGHT_BROWSERS_PATH: cache });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Executable doesn't exist");
      expect(result.stderr.toString()).toContain(`chromium_headless_shell-${expectedRevision}`);
    } finally { await fs.rm(cache, { recursive: true, force: true }); }
  });
});
