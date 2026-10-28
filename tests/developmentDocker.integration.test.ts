import { afterAll, describe, expect, it } from 'vitest';
import { DockerProjectSandbox } from '../server/development/dockerSandbox';
import { sha256, type SourceFiles } from '../server/development/archive';
import type { CommandReceipt } from '../server/development/agent';
const enabled = process.env.RUN_DEVELOPMENT_DOCKER_TESTS === '1';
const file = (text: string) => ({ bytes: Buffer.from(text), mode: 0o644 });
function project(script: string): SourceFiles {
  return new Map([
    ['package.json', file(JSON.stringify({ name: 'isolated-proof', version: '1.0.0', scripts: { typecheck: 'node --check proof.cjs', test: 'node proof.cjs', build: 'node -e "require(\'fs\').mkdirSync(\'dist\',{recursive:true});require(\'fs\').writeFileSync(\'dist/index.html\',\'<main>Isolated</main>\')"' } }))],
    ['package-lock.json', file(JSON.stringify({ name: 'isolated-proof', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'isolated-proof', version: '1.0.0' } } }))],
    ['proof.cjs', file(script)], ['.env', file('PRIVATE_PROJECT_SECRET=not-mounted-in-the-container')],
    ['assets/binário.dat', { bytes: Buffer.from([0, 255, 128, 13, 10, 0, 42]), mode: 0o644 }],
    ['tools/proof.sh', { bytes: Buffer.from('#!/bin/sh\nprintf transfer-ok'), mode: 0o755 }],
  ]);
}
describe.skipIf(!enabled)('Isolamento real do executor central (Docker necessário)', () => {
  afterAll(() => { delete process.env.FROC_CONTROLLER_SECRET; });
  it('bloqueia rede, credenciais, rootfs e vazamento entre projetos, com npm ci/test/build reais', async () => {
    process.env.FROC_CONTROLLER_SECRET = 'controller-secret-not-for-user-code';
    const first = await new DockerProjectSandbox(new AbortController().signal).validate(project(`
      const fs=require('node:fs'), assert=require('node:assert/strict');
      assert.equal(process.getuid(),10001);
      assert.equal(process.env.FROC_CONTROLLER_SECRET,undefined);
      assert.equal(process.env.GITHUB_TOKEN,undefined);
      assert.equal(process.env.GEMINI_API_KEY,undefined);
      assert.equal(fs.existsSync('/var/run/docker.sock'),false);
      assert.equal(fs.existsSync('/workspace/.env'),false);
      assert.equal(fs.statSync('/workspace/proof.cjs').uid,10001);
      assert.equal(fs.statSync('/cache').uid,10001);
      assert.deepEqual([...fs.readFileSync('/workspace/assets/binário.dat')],[0,255,128,13,10,0,42]);
      assert.equal(require('node:child_process').execFileSync('/workspace/tools/proof.sh',{encoding:'utf8'}),'transfer-ok');
      assert.throws(()=>fs.writeFileSync('/opt/froc/escape','bad'));
      fs.writeFileSync('/tmp/project-private-marker','project-one');
      (async()=>{let blocked=false;try{await fetch('https://example.com',{signal:AbortSignal.timeout(1500)});}catch{blocked=true;}assert.equal(blocked,true);console.log('network-and-secrets-blocked');})().catch(()=>process.exit(1));
    `));
    expect(first.commands.map(c => c.exitCode)).toEqual([0, 0, 0, 0]);
    expect(first.isolation).toMatchObject({ network: 'none', readOnlyRoot: true, user: '10001:10001', pidsLimit: 256, memoryBytes: 2147483648, nanoCpus: 1_000_000_000 });
    const second = await new DockerProjectSandbox(new AbortController().signal).validate(project(`require('node:assert/strict').equal(require('node:fs').existsSync('/tmp/project-private-marker'),false);`));
    expect(second.commands.every(c => c.exitCode === 0)).toBe(true); expect(second.preview).toBeTruthy();
  }, 180_000);
  it('preserva o recibo do comando que falhou sem executar o build nem declarar prévia', async () => {
    const received: CommandReceipt[] = [];
    const result = await new DockerProjectSandbox(new AbortController().signal, undefined,
      { command: async receipt => { received.push(receipt); } }).validate(project('console.error("fixture-command-failure");process.exit(23);'));
    expect(received.map(receipt => receipt.command)).toEqual(['npm ci', 'npm run typecheck', 'npm test']);
    expect(received.map(receipt => receipt.exitCode)).toEqual([0, 0, 23]);
    expect(received.at(-1)!.stderr).toContain('fixture-command-failure');
    expect(result.commands).toEqual(received); expect(result.preview).toBeUndefined();
  }, 180_000);
  it('instala dependência sem URL/hash offline e restaura o lockfile antes dos testes', async () => {
    const files = project(`
      const assert=require('node:assert/strict'),fs=require('node:fs');
      assert.equal(require('is-number')(42),true);
      const entry=JSON.parse(fs.readFileSync('package-lock.json','utf8')).packages['node_modules/is-number'];
      assert.equal(entry.version,'7.0.0');assert.equal(entry.resolved,undefined);assert.equal(entry.integrity,undefined);
    `);
    const pkg=JSON.parse(Buffer.from(files.get('package.json')!.bytes).toString());pkg.dependencies={'is-number':'7.0.0'};
    files.set('package.json',file(JSON.stringify(pkg)));
    const lock=JSON.parse(Buffer.from(files.get('package-lock.json')!.bytes).toString());
    lock.packages[''].dependencies=pkg.dependencies;lock.packages['node_modules/is-number']={version:'7.0.0'};
    files.set('package-lock.json',file(JSON.stringify(lock)));
    const originalHash=sha256(files.get('package-lock.json')!.bytes);
    const result=await new DockerProjectSandbox(new AbortController().signal).validate(files);
    expect(result.commands.map(command=>command.exitCode)).toEqual([0,0,0,0]);
    expect(result.isolation.dependencyLock).toMatchObject({originalSha256:originalHash,versionsChanged:false,sourceLockfileChanged:false,
      hydrated:[{name:'is-number',version:'7.0.0'}]});
    expect(sha256(files.get('package-lock.json')!.bytes)).toBe(originalHash);
  }, 180_000);
});
