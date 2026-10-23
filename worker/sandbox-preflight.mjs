import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { run } from './sandbox-process.mjs';

// O npm executa binarios nativos do workspace durante a instalacao (esbuild,
// por exemplo). Rodar apenas JavaScript com um Node externo nao testa isso.
export async function prepareNativeSmokeProject(cwd) {
  await fs.mkdir(cwd, { recursive: true });
  const native = path.join(cwd, 'native-smoke');
  await fs.copyFile('/bin/true', native);
  await fs.chmod(native, 0o755);
  const binary = await fs.readFile(native);
  assert.equal(binary.subarray(0, 4).toString('hex'), '7f454c46', 'sandbox_preflight_requires_native_elf');
  const name = 'frocia-sandbox-preflight';
  const version = '1.0.0';
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name, version, private: true,
    scripts: { install: 'node install-smoke.mjs', test: 'node --test smoke.test.mjs' } }));
  await fs.writeFile(path.join(cwd, 'package-lock.json'), JSON.stringify({ name, version,
    lockfileVersion: 3, requires: true, packages: { '': { name, version, hasInstallScript: true } } }));
  await fs.writeFile(path.join(cwd, 'install-smoke.mjs'), `
    import { execFileSync } from 'node:child_process';
    import path from 'node:path';
    execFileSync(path.join(process.cwd(), 'native-smoke'), [], { stdio: 'pipe' });
    console.log('native-install-ok');
  `);
  await fs.writeFile(path.join(cwd, 'value.txt'), 'baseline\n');
  await fs.writeFile(path.join(cwd, 'smoke.test.mjs'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; test('patch aplicado', () => assert.equal(readFileSync('value.txt', 'utf8'), 'patch\\n'));\n");
  return native;
}

export async function prepareBrowserSmokeScript(cwd) {
  const entry = pathToFileURL(createRequire(import.meta.url).resolve('playwright')).href;
  const script = path.join(cwd, 'browser-smoke.mjs');
  await fs.writeFile(script, `
    const api = await import(${JSON.stringify(entry)});
    const { chromium } = api.default || api;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<button>testar</button>');
      await page.locator('button').evaluate(button => button.addEventListener('click', () => { button.textContent = 'ok'; }));
      await page.locator('button').click();
      if (await page.locator('button').textContent() !== 'ok') throw new Error('browser_preflight_dom_failed');
      console.log(JSON.stringify({ status: 'browser-preflight-ok', browserVersion: browser.version() }));
    } finally { await browser.close(); }
  `);
  return script;
}

// Usa o mesmo executor e as mesmas credenciais Unix do ciclo real, sem
// consultar Gemini, Firebase, GitHub ou Vercel e sem tocar no repositorio real.
async function main() {
  assert.equal(process.platform, 'linux', 'sandbox_preflight_requires_linux');
  assert.equal(process.getuid(), 0, 'sandbox_preflight_requires_controller');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'frocia-sandbox-preflight-'));
  const cwd = path.join(temp, 'repo');
  const checked = async (command, args, isolated = false) => {
    const result = await run(command, args, cwd, 30_000, {}, isolated);
    assert.equal(result.exitCode, 0, `sandbox_preflight:${command} ${args[0]}: ${result.stderr.toString().slice(-500)}`);
    return result.stdout.toString();
  };
  try {
    const native = await prepareNativeSmokeProject(cwd);
    const source = path.join(cwd, 'value.txt');
    await checked('git', ['init', '-q']);
    await checked('git', ['add', '.']);
    await checked('git', ['-c', 'user.name=Sandbox preflight', '-c', 'user.email=sandbox@localhost', 'commit', '-qm', 'baseline']);
    const sha = (await checked('git', ['rev-parse', 'HEAD'])).trim();
    await checked('chown', ['-R', '10001:10001', temp]);
    const owner = await fs.stat(temp);
    assert.equal(owner.uid, 10001);
    assert.equal(owner.mode & 0o777, 0o700);
    await checked('git', ['reset', '--hard', sha], true);
    await checked('git', ['clean', '-fd'], true);

    // O controlador precisa ler/aplicar o patch depois do chown; os comandos
    // de teste continuam sem capacidades e sem os segredos do controlador.
    assert.equal(await fs.readFile(source, 'utf8'), 'baseline\n');
    await fs.writeFile(source, 'patch\n');
    const identity = JSON.parse(await checked('node', ['--input-type=module', '-e', `
      import fs from 'node:fs';
      const status = fs.readFileSync('/proc/self/status', 'utf8');
      const field = name => status.split(String.fromCharCode(10)).find(line => line.startsWith(name + ':'))?.split(':')[1].trim();
      console.log(JSON.stringify({ uid: process.getuid(), gid: process.getgid(),
        effective: field('CapEff'), permitted: field('CapPrm'), ambient: field('CapAmb'),
        noNewPrivileges: field('NoNewPrivs'),
        hasSecrets: ['GEMINI_API_KEY', 'SELF_EVOLUTION_WORKER_TOKEN', 'SELF_EVOLUTION_WORKER_SIGNING_SECRET', 'BROWSER_TEST_PASSWORD'].some(key => Boolean(process.env[key])) }));
    `], true));
    assert.equal(identity.uid, 10001);
    assert.equal(identity.gid, 10001);
    for (const field of ['effective', 'permitted', 'ambient']) assert.match(identity[field] || '', /^0+$/);
    assert.equal(identity.noNewPrivileges, '1');
    assert.equal(identity.hasSecrets, false);
    const terminated = await run('node', ['-e', 'setInterval(() => {}, 1000)'], cwd, 100, {}, true);
    assert.equal(terminated.exitCode, 124, 'sandbox_controller_cannot_terminate_test_process');
    await checked(native, [], true);
    assert.match(await checked('npm', ['ci', '--offline'], true), /native-install-ok/);
    const browserScript = await prepareBrowserSmokeScript(cwd);
    assert.match(await checked('node', [browserScript], true), /browser-preflight-ok/);
    await checked('npm', ['test'], true);
    assert.match(await checked('git', ['diff', '--', 'value.txt'], true), /\+patch/);
    await checked('git', ['diff', '--check'], true);
    await checked('git', ['ls-files', '-z'], true);
    await checked('git', ['reset', '--hard', sha], true);
    await checked('git', ['clean', '-fd'], true);
    assert.equal((await checked('git', ['status', '--porcelain'], true)).trim(), '');
    assert.equal(await fs.readFile(source, 'utf8'), 'baseline\n');
    console.log('[sandbox-preflight] OK: Git, binario ELF, npm ci, Chromium, edicao, teste e rollback; uid=10001, capacidades=0, sem segredos.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(error => console.error('[sandbox-preflight] Falha na limpeza:', error.code));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => { console.error('[sandbox-preflight]', error.message); process.exitCode = 1; });
}
