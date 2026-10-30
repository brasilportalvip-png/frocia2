/**
 * Reconhece pedidos de importar um repositorio do GitHub no chat
 * ("importe https://github.com/dono/repositorio", "import ...", "traga ...",
 * "clone ...", "abra ...") e devolve a URL canonica do repositorio.
 *
 * - Verbos FORTES (importar/clonar/baixar...) sempre contam.
 * - Verbos FRACOS (abra, pegue, use, edite...) so contam quando a mensagem nao pede
 *   analise ("abra e analise a seguranca" continua no chat).
 * - Perguntas ("como importar...?") e mensagens sem verbo nao contam.
 */
const normalize = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const URL_PATTERN = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i;

const STRONG_VERB = new RegExp(
  '\\b(?:' + [
    'import(?:s|a|e|ar|ando|o|ei|ou|em|ado|acao|acoes)?', 'inport(?:e|a|ar)?', 'impor(?:te|tar)',
    'trazer', 'traga', 'trouxe', 'carregue', 'carregar', 'carrega', 'load',
    'puxe', 'puxar', 'puxa', 'pull', 'clone', 'clonar', 'clona', 'fetch',
    'baixe', 'baixar', 'baixa', 'download', 'copie', 'copiar', 'duplique', 'duplicar',
    'migre', 'migrar', 'buscar', 'busque'
  ].join('|') + ')\\b'
);
const WEAK_VERB = new RegExp(
  '\\b(?:' + [
    'abra', 'abrir', 'abre', 'open', 'pegue', 'pegar', 'pega', 'get',
    'edite', 'editar', 'edita', 'altere', 'alterar', 'modifique', 'modificar',
    'use', 'usar', 'utilize', 'utilizar', 'trabalhe', 'trabalhar', 'adicione', 'adicionar', 'anexe', 'anexar'
  ].join('|') + ')\\b'
);
const ANALYSIS_WORDS = /\b(?:analis\w*|audit\w*|revis\w*|verifi\w*|expliqu\w*|resum\w*|diga|avali\w*|compar\w*|seguro|seguranca|bug|erro|review|analyze|explain|check)\b/;
const QUESTION_START = /^\s*(?:como|qual|quais|por que|porque|o que|quando|onde|sera que|e possivel|da pra|posso)\b/;

export function extractGithubImportRequest(text: string): string | null {
  const match = (text || '').match(URL_PATTERN);
  if (!match) return null;
  const normalized = normalize(text);
  if (QUESTION_START.test(normalized)) return null;
  const strong = STRONG_VERB.test(normalized);
  const weak = WEAK_VERB.test(normalized) && !ANALYSIS_WORDS.test(normalized);
  if (!strong && !weak) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '').replace(/[.,;:!?)]+$/, '');
  if (!owner || !repo) return null;
  return `https://github.com/${owner}/${repo}`;
}
