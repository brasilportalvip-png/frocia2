import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  githubCodeReadingContext,
  githubCodeReadingFromError,
  githubCodeReadingFromImport,
  shouldImportGithubCode,
} from '../server/ai/githubCodeReading.js';
import { shouldResearchGithub } from '../server/ai/githubResearchService.js';

// Pedido real que recebeu uma "auditoria" feita só com títulos de commits e PRs.
const PEDIDO_REAL =
  'https://github.com/brasilportalvip-png/Froc-Sobrenatural-Ca-a-Fantasma   site  https://froc-sobrenatural-ca-a-fantasma.vercel.app/  ' +
  'froc preciso que olhe e intenda verdadadeiramente este site de ponta a ponta faça um comite  completo e personalizado... ' +
  'pois  fiz testes reais com este site e não tive sucesso em que ele promete ... fiz testes verdadeiros';

describe('Leitura do código de repositórios citados no chat', () => {
  it('importa o código sempre que houver link de repositório e nenhum anexo', () => {
    expect(shouldImportGithubCode(PEDIDO_REAL, 0)).toBe(true);
    expect(shouldImportGithubCode('Audite https://github.com/openai/example', 0)).toBe(true);
    expect(shouldImportGithubCode('https://github.com/a/b', 0)).toBe(true);
    expect(shouldImportGithubCode('https://github.com/a/b', 1)).toBe(false);
    expect(shouldImportGithubCode('Bom dia, sem link', 0)).toBe(false);
  });

  it('a palavra "github" dentro da própria URL não conta mais como pedido de pesquisa', () => {
    expect(shouldResearchGithub('https://github.com/a/b')).toBe(false);
    expect(shouldResearchGithub('olha https://github.com/a/b pra mim')).toBe(true);
    expect(shouldResearchGithub('Audite o repositório https://github.com/openai/example')).toBe(true);
    expect(shouldResearchGithub(PEDIDO_REAL)).toBe(true);
  });

  it('as duas rotas de chat importam o código mesmo quando a pesquisa de metadados também roda', () => {
    for (const file of ['server/routes/aiRoutes.ts', 'server/ai/aiExecutionService.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain('shouldImportGithubCode(sanitizedPrompt, attachments.length)');
      expect(source).toContain('githubCodeReadingContext(githubCodeReading)');
      // A condição antiga fazia a importação depender de a pesquisa NÃO rodar.
      expect(source).not.toMatch(/const githubRepositoryUrl =\s*attachments\.length === 0 &&\s*!shouldResearchGithub/);
    }
  });

  it('com o código lido, manda citar arquivos e não deduzir pelo histórico', () => {
    const context = githubCodeReadingContext(
      githubCodeReadingFromImport('dono/repo', { summary: 'IMPORTAÇÃO PARCIAL: 40 de 180 arquivos lidos. Não lidos: 140 acima do limite.' })
    );
    expect(context).toContain('FATO CONFIRMADO PELO SERVIDOR');
    expect(context).toContain('cite o caminho do arquivo');
    expect(context).toContain('não deduza deles como o código funciona');
    expect(context).toContain('PARCIAL');
    expect(context).toContain('"definitiva"');
    const complete = githubCodeReadingContext(githubCodeReadingFromImport('dono/repo', { summary: 'Importação completa: 12 de 12 arquivos lidos.' }));
    expect(complete).toContain('Todos os arquivos de texto foram lidos');
  });

  it('se a leitura falhar, obriga a dizer na primeira frase que o código não foi lido', () => {
    const context = githubCodeReadingContext(
      githubCodeReadingFromError('https://github.com/dono/repo', new Error('O GitHub recusou temporariamente a leitura pública, possivelmente por limite da API.'))
    );
    expect(context).toContain('FALHOU');
    expect(context).toContain('NÃO leu nenhum arquivo');
    expect(context).toContain('primeira frase');
    expect(context).toContain('limite da API');
    expect(githubCodeReadingContext(null)).toBe('');
  });
});
