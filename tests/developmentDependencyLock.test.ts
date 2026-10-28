import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { resolveDependencyLock } from '../server/development/dependencyLock';
import type { SourceFiles } from '../server/development/archive';
const integrity = 'sha512-' + createHash('sha512').update('verified-tarball').digest('base64');
const manifest = (name = 'proof', version = '1.2.3') => ({ name, version, dist: { tarball: `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`, integrity } });
function source(packages: Record<string, unknown>): SourceFiles {
  return new Map([['package-lock.json', { bytes: Buffer.from(JSON.stringify({ name: 'project', lockfileVersion: 3, packages: { '': { name: 'project' }, ...packages } })), mode: 0o644 }]]);
}
const signal = () => new AbortController().signal;
describe('Metadados de instalação sem alterar o lockfile original', () => {
  it('preserva bytes de lockfile completo sem consultar registro', async () => {
    const files = source({ 'node_modules/proof': { version: '1.2.3', resolved: manifest().dist.tarball, integrity } });
    const prepared = await resolveDependencyLock(files, signal(), async () => { throw new Error('Unexpected network'); });
    expect(prepared.installLockfile).toEqual(files.get('package-lock.json')!.bytes);
    expect(prepared.evidence.hydrated).toEqual([]); expect(prepared.tarballs.size).toBe(1);
  });
  it('suplementa todas as entradas ausentes, mantém versões/bytes e deduplica consulta', async () => {
    const files = source({ 'node_modules/@scope/proof': { version: '1.2.3', dependencies: { other: '^1' } },
      'node_modules/parent/node_modules/@scope/proof': { version: '1.2.3' } });
    const original = Buffer.from(files.get('package-lock.json')!.bytes); let calls = 0;
    const result = await resolveDependencyLock(files, signal(), async (url, hosts) => {
      expect(url.href).toBe('https://registry.npmjs.org/%40scope%2Fproof/1.2.3'); expect([...hosts]).toEqual(['registry.npmjs.org']);
      calls++; return Buffer.from(JSON.stringify(manifest('@scope/proof')));
    });
    expect(calls).toBe(1); expect(result.evidence.hydrated).toHaveLength(2); expect(result.tarballs.size).toBe(1);
    const installed = JSON.parse(result.installLockfile.toString());
    expect(installed.packages['node_modules/@scope/proof']).toMatchObject({ version: '1.2.3', dependencies: { other: '^1' }, integrity });
    expect(files.get('package-lock.json')!.bytes).toEqual(original);
    expect(result.evidence).toMatchObject({ versionsChanged: false, sourceLockfileChanged: false });
  });
  it('recusa origem privada antes de buscar metadados', async () => {
    await expect(resolveDependencyLock(source({ 'node_modules/proof': { version: '1.2.3', resolved: 'http://127.0.0.1/private.tgz' } }), signal(), async () => { throw new Error('Network forbidden'); }))
      .rejects.toMatchObject({ code: 'dependency_registry_denied' });
  });
  it('recusa identidade ou versão diferente e URL de tarball externa', async () => {
    const files = source({ 'node_modules/proof': { version: '1.2.3' } });
    await expect(resolveDependencyLock(files, signal(), async () => Buffer.from(JSON.stringify(manifest('other'))))).rejects.toMatchObject({ code: 'dependency_metadata_mismatch' });
    await expect(resolveDependencyLock(files, signal(), async () => Buffer.from(JSON.stringify({ ...manifest(), dist: { tarball: 'https://evil.example/proof/-/proof.tgz', integrity } })))).rejects.toMatchObject({ code: 'dependency_registry_denied' });
  });
  it('recusa metadados que mudam hash já fixado', async () => {
    const files = source({ 'node_modules/proof': { version: '1.2.3', integrity: 'sha512-' + createHash('sha512').update('different').digest('base64') } });
    await expect(resolveDependencyLock(files, signal(), async () => Buffer.from(JSON.stringify(manifest())))).rejects.toMatchObject({ code: 'dependency_metadata_mismatch' });
  });
  it('recusa tags e intervalos e respeita cancelamento', async () => {
    const download = async () => { throw new Error('Unexpected network'); };
    await expect(resolveDependencyLock(source({ 'node_modules/proof': { version: '^1.2.3' } }), signal(), download)).rejects.toMatchObject({ code: 'dependency_metadata_unpinned' });
    const controller = new AbortController(); controller.abort();
    await expect(resolveDependencyLock(source({ 'node_modules/proof': { version: '1.2.3' } }), controller.signal, download)).rejects.toMatchObject({ code: 'job_cancelled' });
  });
  it('prepara apenas opcionais compatíveis, preservando todas as entradas do lockfile', async () => {
    const entries = {
      'node_modules/compatible': { version: '1.2.3', resolved: manifest('compatible').dist.tarball, integrity, optional: true, os: ['linux'], cpu: ['x64'], libc: ['glibc'] },
      'node_modules/other-os': { version: '1.2.3', resolved: manifest('other-os').dist.tarball, integrity, optional: true, os: ['darwin'] },
      'node_modules/other-cpu': { version: '1.2.3', resolved: manifest('other-cpu').dist.tarball, integrity, optional: true, cpu: ['!x64'] },
      'node_modules/other-libc': { version: '1.2.3', resolved: manifest('other-libc').dist.tarball, integrity, optional: true, libc: ['musl'] },
    };
    const files = source(entries), result = await resolveDependencyLock(files, signal(), undefined, { os: 'linux', cpu: 'x64', libc: 'glibc' });
    expect(result.tarballs.size).toBe(1); expect(result.evidence.skippedOptionalPackages).toHaveLength(3);
    expect(result.installLockfile).toEqual(files.get('package-lock.json')!.bytes);
    expect(Object.keys(JSON.parse(result.installLockfile.toString()).packages)).toHaveLength(5);
    await expect(resolveDependencyLock(source({ 'node_modules/required': { ...entries['node_modules/other-os'], optional: false } }), signal()))
      .rejects.toMatchObject({ code: 'dependency_platform_unsupported' });
  });
});
