import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './sandbox-process.mjs';

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
    await fs.mkdir(cwd);
    const source = path.join(cwd, 'value.txt');
    await fs.writeFile(source, 'baseline\n');
    await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test smoke.test.mjs' } }));
    await fs.writeFile(path.join(cwd, 'smoke.test.mjs'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; test('patch aplicado', () => assert.equal(readFileSync('value.txt', 'utf8'), 'patch\\n'));\n");
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
    await checked('npm', ['test'], true);
    assert.match(await checked('git', ['diff', '--', 'value.txt'], true), /\+patch/);
    await checked('git', ['diff', '--check'], true);
    await checked('git', ['ls-files', '-z'], true);
    await checked('git', ['reset', '--hard', sha], true);
    await checked('git', ['clean', '-fd'], true);
    assert.equal((await checked('git', ['status', '--porcelain'], true)).trim(), '');
    assert.equal(await fs.readFile(source, 'utf8'), 'baseline\n');
    console.log('[sandbox-preflight] OK: Git, edicao, teste e rollback; uid=10001, capacidades=0, sem segredos.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(error => console.error('[sandbox-preflight] Falha na limpeza:', error.code));
  }
}

void main().catch(error => { console.error('[sandbox-preflight]', error.message); process.exitCode = 1; });
