import { describe, expect, it } from 'vitest';
import { extractGithubImportRequest } from '../src/services/githubImportIntent.js';

describe('atalho de importacao do GitHub no chat', () => {
  it.each([
    ['Importe https://github.com/brasilportalvip-png/frocia2', 'https://github.com/brasilportalvip-png/frocia2'],
    ['quero importar o projeto https://github.com/dono/meu-repo.git agora', 'https://github.com/dono/meu-repo'],
    ['Traga https://github.com/dono/repo/tree/main/src para mim.', 'https://github.com/dono/repo'],
    ['carregue https://www.github.com/dono/repo, por favor', 'https://github.com/dono/repo'],
    ['import https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['import  https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['importa https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['Importação do https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['inporte https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['clone https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['baixe https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['pegue https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['abra https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['open https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['quero editar https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['use este projeto https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['puxa https://github.com/dono/repo', 'https://github.com/dono/repo'],
    ['Pode importar https://github.com/dono/repo?', 'https://github.com/dono/repo'],
    ['Por favor, importe o https://github.com/dono/repo pra mim', 'https://github.com/dono/repo'],
  ])('reconhece: %s', (text, url) => {
    expect(extractGithubImportRequest(text)).toBe(url);
  });

  it.each([
    'Como importar https://github.com/dono/repo?',
    'Analise https://github.com/dono/repo e diga se esta seguro',
    'https://github.com/dono/repo',
    'Quero importar um projeto do GitHub',
    'Oi, tudo bem?',
    'abra e analise a seguranca de https://github.com/dono/repo',
    'Posso importar https://github.com/dono/repo?',
    'isso e importante https://github.com/dono/repo',
    'verifique https://github.com/dono/repo por erros',
    'explique o https://github.com/dono/repo',
  ])('deixa no chat comum: %s', text => {
    expect(extractGithubImportRequest(text)).toBeNull();
  });
});
