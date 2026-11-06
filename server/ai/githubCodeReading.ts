import { extractCanonicalGithubRepository } from './githubResearchService.js';

/**
 * Leitura do CÓDIGO de um repositório citado no chat.
 *
 * Defeito corrigido: as rotas só importavam os arquivos quando `shouldResearchGithub`
 * era falso. Como essa verificação procurava a palavra "github" no texto inteiro — e a
 * própria URL https://github.com/... contém "github" —, ela era SEMPRE verdadeira.
 * Resultado: com qualquer link do GitHub a Froc.IA recebia só títulos de commits e PRs,
 * nunca o código, e respondia "auditorias" deduzidas desses títulos.
 *
 * Agora: link de repositório sem anexo → o código é importado sempre; a pesquisa de
 * metadados (commits, PRs) continua como complemento. Se a importação falhar, o chat
 * não cai e o modelo recebe um aviso explícito de que NÃO leu o código.
 */
export function shouldImportGithubCode(prompt: string, attachmentCount: number): boolean {
  return attachmentCount === 0 && Boolean(extractCanonicalGithubRepository(prompt));
}

export type GithubCodeReading =
  | { status: 'read'; repository: string; summary: string; complete: boolean }
  | { status: 'failed'; repository: string; reason: string };

/** Bloco de contexto que diz ao modelo exatamente o que ele leu (ou não leu). */
export function githubCodeReadingContext(reading: GithubCodeReading | null): string {
  if (!reading) return '';
  if (reading.status === 'read') {
    return [
      '',
      '[LEITURA DO CÓDIGO DO REPOSITÓRIO — FATO CONFIRMADO PELO SERVIDOR]',
      `Repositório: ${reading.repository}`,
      `Cobertura: ${reading.summary}`,
      'O conteúdo dos arquivos lidos está no anexo github-repository.json (campo importedFiles).',
      '- Baseie o diagnóstico no conteúdo desses arquivos e cite o caminho do arquivo (e o trecho) de cada afirmação.',
      '- Títulos de commits e PRs são só histórico: não deduza deles como o código funciona.',
      reading.complete
        ? '- Todos os arquivos de texto foram lidos.'
        : '- A leitura foi PARCIAL: diga isso no começo da resposta e não afirme nada sobre arquivos que não foram lidos.',
      '- Não chame nenhuma correção de "definitiva", "perfeita" ou "garantida": nada foi executado nem testado.',
      '[/LEITURA DO CÓDIGO DO REPOSITÓRIO]',
    ].join('\n');
  }
  return [
    '',
    '[LEITURA DO CÓDIGO DO REPOSITÓRIO — FALHOU]',
    `Repositório: ${reading.repository}`,
    `Motivo: ${reading.reason}`,
    '- Você NÃO leu nenhum arquivo deste repositório. Diga isso logo na primeira frase da resposta.',
    '- Não descreva como o código funciona, não aponte defeitos em arquivos e não proponha correção como se tivesse lido o código.',
    '- No máximo, levante hipóteses marcadas como hipóteses e peça à pessoa que tente de novo em alguns minutos ou anexe os arquivos.',
    '[/LEITURA DO CÓDIGO DO REPOSITÓRIO]',
  ].join('\n');
}

/** Converte a resposta do importador no registro de leitura. */
export function githubCodeReadingFromImport(repository: string, imported: { summary: string }): GithubCodeReading {
  const summary = String(imported.summary || '').slice(0, 600);
  return { status: 'read', repository, summary, complete: /^Importação completa/i.test(summary) };
}

export function githubCodeReadingFromError(repository: string, error: unknown): GithubCodeReading {
  const reason = error instanceof Error && error.message ? error.message : 'Falha desconhecida ao ler o repositório.';
  return { status: 'failed', repository, reason: reason.slice(0, 300) };
}
