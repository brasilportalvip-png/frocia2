import { describe, expect, it } from 'vitest';
import { extractGithubImportRequest } from '../src/services/githubImportIntent.js';

describe('atalho de importacao do GitHub no chat', () => {
  it.each([
    ['Importe https://github.com/brasilportalvip-png/frocia2', 'https://github.com/brasilportalvip-png/frocia2'],
    ['quero importar o projeto https://github.com/dono/meu-repo.git agora', 'https://github.com/dono/meu-repo'],
    ['Traga https://github.com/dono/repo/tree/main/src para mim.', 'https://github.com/dono/repo'],
    ['carregue https://www.github.com/dono/repo, por favor', 'https://github.com/dono/repo'],
  ])('reconhece: %s', (text, url) => {
    expect(extractGithubImportRequest(text)).toBe(url);
  });

  it.each([
    'Como importar https://github.com/dono/repo?',
    'Analise https://github.com/dono/repo e diga se esta seguro',
    'https://github.com/dono/repo',
    'Quero importar um projeto do GitHub',
    'Oi, tudo bem?',
  ])('deixa no chat comum: %s', text => {
    expect(extractGithubImportRequest(text)).toBeNull();
  });
});
