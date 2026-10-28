import { afterAll, describe, expect, it } from 'vitest';
import { DockerProjectSandbox } from '../server/development/dockerSandbox';
import type { SourceFiles } from '../server/development/archive';
const enabled = process.env.RUN_DEVELOPMENT_DOCKER_TESTS === '1';
const file = (text: string) => ({ bytes: Buffer.from(text), mode: 0o644 });
function project(script: string): SourceFiles {
  return new Map([
    ['package.json', file(JSON.stringify({ name: 'isolated-proof', version: '1.0.0', scripts: { typecheck: 'node --check proof.cjs', test: 'node proof.cjs', build: 'node -e "require(\'fs\').mkdirSync(\'dist\',{recursive:true});require(\'fs\').writeFileSync(\'dist/index.html\',\'<main>Isolated</main>\')"' } }))],
    ['package-lock.json', file(JSON.stringify({ name: 'isolated-proof', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'isolated-proof', version: '1.0.0' } } }))],
    ['proof.cjs', file(script)], ['.env', file('PRIVATE_PROJECT_SECRET=not-mounted-in-the-container')],
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
      assert.throws(()=>fs.writeFileSync('/opt/froc/escape','bad'));
      fs.writeFileSync('/tmp/project-private-marker','project-one');
      (async()=>{let blocked=false;try{await fetch('https://example.com',{signal:AbortSignal.timeout(1500)});}catch{blocked=true;}assert.equal(blocked,true);console.log('network-and-secrets-blocked');})().catch(()=>process.exit(1));
    `));
    expect(first.commands.map(c => c.exitCode)).toEqual([0, 0, 0, 0]);
    expect(first.isolation).toMatchObject({ network: 'none', readOnlyRoot: true, user: '10001:10001', pidsLimit: 256, memoryBytes: 2147483648, nanoCpus: 1_000_000_000 });
    const second = await new DockerProjectSandbox(new AbortController().signal).validate(project(`require('node:assert/strict').equal(require('node:fs').existsSync('/tmp/project-private-marker'),false);`));
    expect(second.commands.every(c => c.exitCode === 0)).toBe(true); expect(second.preview).toBeTruthy();
  }, 180_000);
});
