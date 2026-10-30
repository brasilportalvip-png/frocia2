import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { NpmInstaller, dependencyClosure, parseLock, parseTar, tarballUrl, type LockPackages } from '../server/services/npmInstaller.js';
import { bundleReactProject } from '../server/services/reactProjectBundler.js';

const enc = (s: string) => new TextEncoder().encode(s);

function tar(files: Record<string, string>): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = enc(content);
    const header = new Uint8Array(512);
    header.set(enc(name).subarray(0, 100), 0);
    header.set(enc('0000644\0'), 100);
    header.set(enc('0000000\0'), 108);
    header.set(enc('0000000\0'), 116);
    header.set(enc(data.length.toString(8).padStart(11, '0') + '\0'), 124);
    header.set(enc('00000000000\0'), 136);
    header.set(enc('        '), 148);
    header[156] = '0'.charCodeAt(0);
    header.set(enc('ustar\0'), 257);
    header.set(enc('00'), 263);
    const sum = header.reduce((acc, byte) => acc + byte, 0);
    header.set(enc(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    blocks.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const block of blocks) { out.set(block, offset); offset += block.length; }
  return out;
}

const tgz = (files: Record<string, string>) => new Uint8Array(gzipSync(tar(files)));
const sri = (bytes: Uint8Array) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

describe('parseTar', () => {
  it('remove a pasta "package/" e ignora caminhos perigosos', () => {
    const files = parseTar(tar({ 'package/index.js': 'a', 'package/lib/b.js': 'b', 'package/../evil.js': 'x' }));
    expect(files.map((f) => f.path)).toEqual(['index.js', 'lib/b.js']);
  });
});

describe('lock e dependências', () => {
  const lock: LockPackages = {
    '': {},
    'node_modules/a': { version: '1.0.0', dependencies: { b: '^1' } },
    'node_modules/b': { version: '1.0.0', dependencies: { c: '^1' } },
    'node_modules/c': { version: '1.0.0' },
    'node_modules/a/node_modules/c': { version: '2.0.0' },
    'node_modules/win-only': { version: '1.0.0', os: ['win32'] },
    'node_modules/@s/pkg': { version: '3.1.0' },
  };

  it('resolve dependências aninhadas como o Node e pula pacotes de outra plataforma', () => {
    expect(dependencyClosure(lock, 'node_modules/a').sort()).toEqual(['node_modules/a', 'node_modules/b', 'node_modules/c']);
    expect(dependencyClosure(lock, 'node_modules/win-only', )).toEqual(process.platform === 'win32' ? ['node_modules/win-only'] : []);
  });

  it('monta a URL do registry quando o lock não traz "resolved"; recusa outros hosts', () => {
    expect(tarballUrl('node_modules/@s/pkg', lock['node_modules/@s/pkg'])).toBe('https://registry.npmjs.org/@s/pkg/-/pkg-3.1.0.tgz');
    expect(tarballUrl('node_modules/x', { version: '1.0.0', resolved: 'https://evil.example/x.tgz' })).toBeNull();
    expect(tarballUrl('node_modules/x', { version: '1.0.0', resolved: 'git+ssh://git@github.com/a/b.git' })).toBeNull();
  });

  it('só aceita package-lock v2 ou v3', () => {
    expect(parseLock('{"lockfileVersion":1,"dependencies":{}}')).toBeNull();
    expect(parseLock('não é json')).toBeNull();
    expect(parseLock('{"lockfileVersion":3,"packages":{"":{}}}')).toEqual({ '': {} });
  });
});

describe('NpmInstaller + bundleReactProject', () => {
  const installers: NpmInstaller[] = [];
  afterEach(async () => { await Promise.all(installers.splice(0).map((i) => i.cleanup())); });

  const tiny = tgz({
    'package/package.json': JSON.stringify({ name: 'tiny', version: '1.0.0', exports: { '.': { browser: './browser.js', default: './node.js' } } }),
    'package/browser.js': "import { helper } from 'tiny-dep'; export const hello = () => 'ola-' + helper();",
    'package/node.js': "export const hello = () => 'NODE-ERRADO';",
  });
  const dep = tgz({
    'package/package.json': JSON.stringify({ name: 'tiny-dep', version: '2.0.0', main: 'index.js' }),
    'package/index.js': "module.exports = { helper: () => 'dep-ok' };",
  });
  const registry: Record<string, Uint8Array> = {
    'https://registry.npmjs.org/tiny/-/tiny-1.0.0.tgz': tiny,
    'https://registry.npmjs.org/tiny-dep/-/tiny-dep-2.0.0.tgz': dep,
  };
  const lock: LockPackages = {
    '': {},
    'node_modules/tiny': { version: '1.0.0', integrity: sri(tiny), dependencies: { 'tiny-dep': '^2' } },
    'node_modules/tiny-dep': { version: '2.0.0', integrity: sri(dep) },
  };

  const make = (override?: (url: string) => Uint8Array) => {
    const requested: string[] = [];
    const installer = new NpmInstaller(lock, {
      fetchBuffer: async (url) => {
        requested.push(url);
        const bytes = override ? override(url) : registry[url];
        if (!bytes) throw new Error(`404 ${url}`);
        return bytes;
      },
    });
    installers.push(installer);
    return { installer, requested };
  };

  it('instala o pacote e suas dependências e o esbuild usa o campo exports (condição browser)', async () => {
    const { installer, requested } = make();
    const files = new Map<string, Uint8Array>([
      ['index.html', enc('<html><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>')],
      ['package.json', enc('{"dependencies":{"tiny":"^1.0.0"}}')],
      ['src/main.ts', enc("import { hello } from 'tiny'; document.getElementById('root')!.textContent = hello();")],
    ]);
    const result = await bundleReactProject(files, { owner: 'o', repo: 'r', branch: 'main' }, 'index.html', {
      installer,
      retryDelayMs: 0,
      fetchText: async (url) => { throw new Error(`esm.sh não deveria ser usado: ${url}`); },
    });
    expect(result.report.kind).toBe('react_bundled');
    expect(result.html).toContain('ola-');
    expect(result.html).toContain('dep-ok');
    expect(result.html).not.toContain('NODE-ERRADO');
    expect(result.report.bundle?.npmPackages).toEqual(['tiny']);
    expect(requested.sort()).toEqual(Object.keys(registry).sort());
    const dir = await installer.getDir();
    expect(existsSync(path.join(dir, 'node_modules/tiny/browser.js'))).toBe(true);
    expect(readFileSync(path.join(dir, 'node_modules/tiny-dep/index.js'), 'utf8')).toContain('dep-ok');
  });

  it('recusa pacote cujo hash não confere (cai para o esm.sh em vez de usar arquivo adulterado)', async () => {
    const { installer } = make((url) => (url.includes('tiny-dep') ? tgz({ 'package/index.js': 'evil' }) : registry[url]));
    expect(await installer.ensure('tiny')).toBe(false);
    expect(installer.failures.get('tiny')).toContain('integrity');
  });

  it('limpa a pasta temporária', async () => {
    const { installer } = make();
    await installer.ensure('tiny');
    const dir = await installer.getDir();
    expect(existsSync(dir)).toBe(true);
    await installer.cleanup();
    expect(existsSync(dir)).toBe(false);
  });
});
