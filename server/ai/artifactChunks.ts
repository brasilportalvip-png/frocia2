/**
 * Memória COMPLETA de anexos e repositórios.
 *
 * Defeito corrigido: nas mensagens seguintes a Froc.IA só recebia os primeiros 6.000
 * caracteres de cada anexo (artifactMemoryService.toContext). Num PDF de 40 páginas isso
 * é o começo; num repositório do GitHub importado é só a lista de arquivos, nenhuma linha
 * de código. A pergunta seguinte ("e o App.tsx?") era respondida sem o conteúdo.
 *
 * Agora o texto inteiro é guardado em trechos (um por arquivo no caso de repositório) e,
 * a cada pergunta, entram no contexto os trechos que mais combinam com ela — dizendo à IA
 * quantos trechos ela está vendo de quantos existem.
 */

export const MAX_ARTIFACT_FULL_TEXT_CHARS = 750_000;
export const ARTIFACT_CHUNK_CHARS = 24_000;
export const MAX_ARTIFACT_CHUNKS = 120;
export const ARTIFACT_EXCERPT_BUDGET_CHARS = 120_000;

export interface ArtifactChunk {
  index: number;
  label: string;
  content: string;
}

function splitText(text: string, label: string, startIndex: number): ArtifactChunk[] {
  const chunks: ArtifactChunk[] = [];
  let rest = text;
  const parts: string[] = [];
  while (rest.length > ARTIFACT_CHUNK_CHARS) {
    // Corta numa quebra de linha perto do limite para não partir frases/linhas de código.
    let cut = rest.lastIndexOf('\n', ARTIFACT_CHUNK_CHARS);
    if (cut < ARTIFACT_CHUNK_CHARS * 0.6) cut = ARTIFACT_CHUNK_CHARS;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.trim()) parts.push(rest);
  parts.forEach((content, i) => {
    chunks.push({
      index: startIndex + i,
      label: parts.length > 1 ? `${label} (parte ${i + 1}/${parts.length})` : label,
      content,
    });
  });
  return chunks;
}

/** Repositório importado do GitHub: um trecho por arquivo, com o caminho como rótulo. */
function repositoryChunks(text: string): ArtifactChunk[] | null {
  if (!text.trimStart().startsWith('{') || !text.includes('"importedFiles"')) return null;
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { return null; }
  const files = Array.isArray(parsed?.importedFiles) ? parsed.importedFiles : null;
  if (!files || files.length === 0) return null;
  const chunks: ArtifactChunk[] = [];
  const overview = [
    `Repositório: ${parsed.repository || 'desconhecido'} (${parsed.url || ''})`,
    `Branch: ${parsed.defaultBranch || '?'} | Arquivos no repositório: ${parsed.filesAvailable ?? '?'} | Conteúdo lido: ${files.length}`,
    parsed.importCoverage?.complete ? 'Leitura completa.' : 'Leitura PARCIAL: nem todos os arquivos foram lidos.',
    'Lista de arquivos:',
    ...(Array.isArray(parsed.files) ? parsed.files.slice(0, 400).map((f: any) => `- ${f.path}`) : []),
  ].join('\n');
  chunks.push(...splitText(overview, 'visão geral do repositório', 0));
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue;
    chunks.push(...splitText(file.content, file.path, chunks.length));
    if (chunks.length >= MAX_ARTIFACT_CHUNKS) break;
  }
  if (typeof parsed.readme === 'string' && parsed.readme.trim() && chunks.length < MAX_ARTIFACT_CHUNKS) {
    chunks.push(...splitText(parsed.readme, 'README', chunks.length));
  }
  return chunks.slice(0, MAX_ARTIFACT_CHUNKS);
}

export function splitArtifactText(name: string, text: string): ArtifactChunk[] {
  const clean = String(text || '').slice(0, MAX_ARTIFACT_FULL_TEXT_CHARS);
  if (!clean.trim()) return [];
  return (repositoryChunks(clean) || splitText(clean, name || 'arquivo', 0)).slice(0, MAX_ARTIFACT_CHUNKS);
}

function terms(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)
  );
}

/**
 * Escolhe os trechos que entram no contexto: primeiro os que a pergunta cita pelo nome
 * (ex.: "App.tsx"), depois os que mais compartilham palavras com ela; sem pista nenhuma,
 * na ordem do documento. Respeita o orçamento de caracteres.
 */
export function selectArtifactExcerpts(
  chunks: ArtifactChunk[],
  prompt: string,
  budgetChars = ARTIFACT_EXCERPT_BUDGET_CHARS
): ArtifactChunk[] {
  const promptLower = prompt.toLowerCase();
  const promptTerms = terms(prompt);
  const scored = chunks.map((chunk) => {
    const baseLabel = chunk.label.replace(/ \(parte \d+\/\d+\)$/, '');
    const fileName = baseLabel.split('/').pop()?.toLowerCase() || '';
    let score = 0;
    if (fileName && fileName.length >= 3 && promptLower.includes(fileName)) score += 50;
    if (baseLabel.length >= 3 && promptLower.includes(baseLabel.toLowerCase())) score += 30;
    const chunkTerms = terms(`${chunk.label}\n${chunk.content.slice(0, ARTIFACT_CHUNK_CHARS)}`);
    for (const term of promptTerms) if (chunkTerms.has(term)) score += 1;
    return { chunk, score };
  });
  const anyMatch = scored.some((item) => item.score > 0);
  const ordered = anyMatch
    ? scored.sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index)
    : scored.sort((a, b) => a.chunk.index - b.chunk.index);
  const selected: ArtifactChunk[] = [];
  let used = 0;
  for (const { chunk, score } of ordered) {
    if (anyMatch && score === 0 && selected.length > 0) break;
    if (used + chunk.content.length > budgetChars) {
      if (selected.length === 0) {
        selected.push({ ...chunk, content: chunk.content.slice(0, budgetChars) });
        used = budgetChars;
      }
      continue;
    }
    selected.push(chunk);
    used += chunk.content.length;
  }
  return selected.sort((a, b) => a.index - b.index);
}

/** Bloco de contexto com os trechos e a cobertura (quantos de quantos). */
export function artifactExcerptsContext(name: string, excerpts: ArtifactChunk[], totalChunks: number): string {
  if (!excerpts.length) return '';
  return [
    `conteúdo guardado: ${excerpts.length} de ${totalChunks} trecho(s) escolhidos para esta pergunta.`,
    excerpts.length < totalChunks
      ? '- Os demais trechos existem na memória mas não estão aqui: não afirme o que há neles; se a pergunta depender deles, diga qual parte precisa e peça para citá-la pelo nome.'
      : '- Todo o conteúdo guardado deste arquivo está abaixo.',
    ...excerpts.map((chunk) => `--- trecho: ${chunk.label} ---\n${chunk.content}`),
  ].join('\n');
}

/**
 * Regra de memória verdadeira, para TODOS os modos (antes as regras de honestidade mais
 * fortes só valiam no modo Engenharia). Diz à IA o que ela realmente lembra e se a memória
 * entre conversas está ligada — sem a chave MEMORY_ENCRYPTION_KEY ela falha em silêncio.
 */
export function memoryTruthPolicy(encryptionConfigured: boolean): string {
  return [
    '[MEMÓRIA — O QUE VOCÊ REALMENTE LEMBRA]',
    '- Você só lembra do que aparece nos blocos desta solicitação: histórico recente, resumo da conversa, memória extensa de conversas anteriores, memórias salvas e artefatos recuperados.',
    '- Se a pessoa perguntar sobre algo combinado antes e isso não estiver nesses blocos, diga que não encontrou na memória e peça para ela relembrar o ponto. Nunca reconstrua de imaginação nem finja lembrar.',
    '- Ao usar algo de uma conversa anterior ou de um anexo antigo, diga de onde veio (ex.: "na conversa sobre X você disse...", "no arquivo Y").',
    '- Se de um anexo você só tiver a prévia ou parte dos trechos, deixe isso claro e não complete o resto.',
    encryptionConfigured
      ? '- Estado: memória entre conversas e de anexos ATIVA.'
      : '- Estado: memória entre conversas e de anexos DESLIGADA neste servidor (falta a chave de criptografia). Você só lembra desta conversa. Se pedirem para lembrar algo em outra conversa, diga isso com franqueza.',
  ].join('\n');
}
