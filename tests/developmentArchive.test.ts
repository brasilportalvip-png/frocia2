import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { LIMITS, readArchive, writeArchive, sourceManifest, sha256 } from '../server/development/archive';

describe('Importação integral com bytes verificáveis', () => {
  it('preserva backend, lockfile longo, Unicode, binários e permissões na ida e volta', () => {
    const binary = Uint8Array.from({ length: 4096 }, (_, index) => index % 256);
    const original = new Map([
      ['server/production/router.ts', { bytes: strToU8('export const backend = true;'), mode: 0o644 }],
      ['package-lock.json', { bytes: strToU8(JSON.stringify({ packages: Array.from({ length: 4000 }, (_, i) => ({ id: i, integrity: 'sha512-original' })) })), mode: 0o644 }],
      ['assets/ação original.png', { bytes: binary, mode: 0o644 }],
      ['scripts/check.sh', { bytes: strToU8('#!/bin/sh\nexit 0\n'), mode: 0o755 }],
    ]);
    const bytes = writeArchive(original), files = readArchive(bytes);
    expect(sourceManifest(files)).toEqual(sourceManifest(original));
    expect([...files.get('assets/ação original.png')!.bytes]).toEqual([...binary]);
    expect(files.get('package-lock.json')!.bytes.length).toBeGreaterThan(100_000);
    expect(files.get('scripts/check.sh')!.mode).toBe(0o755);
  });
  it('remove apenas a pasta de transporte do GitHub, mantendo a árvore interna', () => {
    const files = readArchive(zipSync({ 'repo-sha/src/main.ts': strToU8('main'), 'repo-sha/server/index.ts': strToU8('server') }), true);
    expect([...files.keys()]).toEqual(['src/main.ts', 'server/index.ts']);
  });
  it.each(['../escape.ts', '/absolute', 'src/../../escape', 'C:/evil', 'folder\\escape', '.git/config', 'src/nul.txt'])(
    'recusa arquivo inseguro e não retorna conteúdo parcial: %s', path => {
      expect(() => readArchive(zipSync({ 'ok.txt': strToU8('ok'), [path]: strToU8('bad') }))).toThrow(/caminho inseguro/);
    });
  it('rejeita symlink e caminhos com colisão entre maiúsculas/minúsculas', () => {
    expect(() => readArchive(zipSync({ link: [strToU8('/tmp/secret'), { os: 3, attrs: 0xa1ff << 16 }] }))).toThrow(/simbólicos/);
    expect(() => readArchive(zipSync({ 'src/A.ts': strToU8('a'), 'src/a.ts': strToU8('b') }))).toThrow(/ambíguos/);
  });
  it('valida CRC e bloqueia ZIP truncado, tamanho declarado falso e expansão excessiva', () => {
    const valid = zipSync({ 'index.html': strToU8('hello') }, { level: 0 });
    expect(() => readArchive(valid.subarray(0, valid.length - 1))).toThrow();
    const altered = valid.slice(); altered[40] ^= 1;
    expect(() => readArchive(altered)).toThrow();
    const large = zipSync({ 'data.txt': new Uint8Array(LIMITS.file + 1) });
    expect(() => readArchive(large)).toThrow(/limites/);
  });
  it('aceita uma árvore grande sem limitar a 40 ou 100 arquivos', () => {
    const source = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`source/file-${i}.ts`, strToU8(`export const n=${i};`)]));
    expect(readArchive(zipSync(source)).size).toBe(1200);
  });
  it('detecta alterações reais em bytes, sem depender de resumo textual', () => {
    const before = readArchive(zipSync({ 'index.html': strToU8('<main>original</main>') }));
    const after = readArchive(writeArchive(before)); after.get('index.html')!.bytes = strToU8('<main>updated</main>');
    expect(sourceManifest(before).digest).not.toBe(sourceManifest(after).digest);
    expect(sha256(before.get('index.html')!.bytes)).not.toBe(sha256(after.get('index.html')!.bytes));
  });
});
