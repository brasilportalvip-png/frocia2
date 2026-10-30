/**
 * Com um projeto aberto no editor, pedidos de alteração escritos no chat
 * ("mude o título para...", "troque a cor do botão", "adicione uma seção de preços")
 * devem alterar o projeto, não virar só conversa. Perguntas e pedidos de análise continuam no chat.
 */
const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const EDIT_VERB = new RegExp(
  '\\b(?:' + [
    'mude', 'mudar', 'muda', 'troque', 'trocar', 'troca', 'altere', 'alterar', 'altera',
    'modifique', 'modificar', 'ajuste', 'ajustar', 'ajusta', 'corrija', 'corrigir', 'conserte', 'consertar',
    'adicione', 'adicionar', 'adiciona', 'acrescente', 'acrescentar', 'inclua', 'incluir',
    'remova', 'remover', 'tire', 'tirar', 'retire', 'apague', 'apagar', 'exclua', 'excluir',
    'aumente', 'aumentar', 'diminua', 'diminuir', 'reduza', 'reduzir',
    'deixe', 'deixar', 'coloque', 'colocar', 'ponha', 'por', 'renomeie', 'renomear', 'substitua', 'substituir',
    'melhore', 'melhorar', 'reescreva', 'reescrever', 'traduza', 'traduzir', 'mova', 'mover'
  ].join('|') + ')\\b'
);
const SITE_PART = new RegExp(
  '\\b(?:' + [
    'titulo', 'subtitulo', 'texto', 'cor', 'cores', 'fundo', 'botao', 'botoes', 'menu', 'logo', 'logotipo',
    'imagem', 'imagens', 'foto', 'fotos', 'secao', 'secoes', 'rodape', 'cabecalho', 'header', 'footer', 'hero',
    'banner', 'fonte', 'fontes', 'tipografia', 'layout', 'pagina', 'site', 'formulario', 'contato', 'preco', 'precos',
    'depoimentos', 'faq', 'icone', 'icones', 'link', 'links', 'nome', 'slogan', 'tema', 'animacao', 'sombra', 'borda'
  ].join('|') + ')\\b'
);
const QUESTION_START = /^\s*(?:como|qual|quais|por que|porque|o que|quando|onde|sera que|e possivel|da pra|posso|voce|vc)\b/;
const ANALYSIS_WORDS = /\b(?:analis\w*|audit\w*|avali\w*|opiniao|o que acha|o que voce acha|o que me diz)\b/;

export function isProjectEditRequest(text: string): boolean {
  const normalized = normalize(text || '').trim();
  if (normalized.length < 6 || normalized.includes('?')) return false;
  if (QUESTION_START.test(normalized) || ANALYSIS_WORDS.test(normalized)) return false;
  return EDIT_VERB.test(normalized) && SITE_PART.test(normalized);
}
