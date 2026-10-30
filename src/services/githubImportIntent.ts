/**
 * Reconhece "importe https://github.com/dono/repositorio" no chat e devolve a URL
 * canonica do repositorio. Perguntas ("como importar...") e mensagens sem verbo de
 * importacao nao contam, entao analises e conversas continuam indo ao chat normal.
 */
const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const URL_PATTERN = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i;
const IMPORT_VERB = /\b(?:importe|importa|importar|importando|traga|trazer|carregue|carregar|puxe|puxar|clone|clonar|abra|abrir|baixe|baixar|pegue|pegar)\b/;
const QUESTION_START = /^\s*(?:como|qual|quais|por que|porque|o que|quando|onde|sera que|e possivel|da pra)\b/;

export function extractGithubImportRequest(text: string): string | null {
  const match = (text || '').match(URL_PATTERN);
  if (!match) return null;
  const normalized = normalize(text);
  if (!IMPORT_VERB.test(normalized) || QUESTION_START.test(normalized)) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '').replace(/[.,;:!?)]+$/, '');
  if (!owner || !repo) return null;
  return `https://github.com/${owner}/${repo}`;
}
