import { describe, expect, it } from 'vitest';
import { buildSourceDigest, maskSecrets } from '../server/services/projectSourceDigest.js';

const enc = (text: string) => new TextEncoder().encode(text);

describe('buildSourceDigest', () => {
  it('lista arquivos e inclui README e código, nesta ordem de prioridade', () => {
    const files = new Map<string, Uint8Array>([
      ['src/App.tsx', enc('export default function App(){return <h1>Caça Fantasmas</h1>}')],
      ['README.md', enc('# Caça Fantasma\nSite de serviços paranormais')],
      ['package.json', enc('{"name":"caca"}')],
      ['package-lock.json', enc('{"lockfileVersion":3}')],
    ]);
    const digest = buildSourceDigest(files);
    expect(digest).toContain('- README.md');
    expect(digest).toContain('### README.md');
    expect(digest.indexOf('### README.md')).toBeLessThan(digest.indexOf('### src/App.tsx'));
    expect(digest).not.toContain('### package-lock.json');
  });

  it('mascara chaves que parecem segredos e respeita o limite de tamanho', () => {
    const key = 'AIza' + 'a'.repeat(35);
    expect(maskSecrets(`const k="${key}"`)).not.toContain(key);
    const big = new Map<string, Uint8Array>();
    for (let i = 0; i < 30; i++) big.set(`src/f${i}.ts`, enc('x'.repeat(9000)));
    expect(buildSourceDigest(big).length).toBeLessThan(40000);
  });
});
