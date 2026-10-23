import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateWorkerBrowserVersion(projectLock, workerManifest, workerLock) {
  const expected = projectLock.packages?.['node_modules/@playwright/test']?.version;
  const versions = {
    project: projectLock.packages?.['node_modules/playwright']?.version,
    projectCore: projectLock.packages?.['node_modules/playwright-core']?.version,
    worker: workerLock.packages?.['node_modules/playwright']?.version,
    workerCore: workerLock.packages?.['node_modules/playwright-core']?.version,
    workerDeclared: workerManifest.dependencies?.playwright,
    workerLocked: workerLock.packages?.['']?.dependencies?.playwright,
    ...Object.fromEntries(Object.entries(workerLock.packages || {})
      .filter(([name]) => /\/node_modules\/(?:playwright|playwright-core)$/.test(name))
      .map(([name, value]) => [name, value.version])),
  };
  if (!expected || Object.values(versions).some(version => version !== expected)) {
    throw new Error(`worker_playwright_version_mismatch: testes=${expected || 'ausente'}; ${JSON.stringify(versions)}. Sincronize Playwright e seus locks antes de construir o worker.`);
  }
  return expected;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const read = name => JSON.parse(readFileSync(name, 'utf8'));
    const version = validateWorkerBrowserVersion(read('package-lock.json'), read('worker/package.json'), read('worker/package-lock.json'));
    console.log(`[worker-browser-version] OK: projeto e worker usam Playwright ${version}.`);
  } catch (error) {
    console.error('[worker-browser-version]', error.message);
    process.exitCode = 1;
  }
}
