/**
 * Froc.IA — roteador único de intenção.
 *
 * Decide, a cada mensagem (voz ou texto), QUAL capacidade atende o pedido —
 * imagem, vídeo, criação de site/app, pesquisa ou conversa — esteja o pedido no
 * começo, no meio ou no fim da frase, e mesmo no meio de outro assunto:
 *   "a gente tava falando de vendas... agora cria uma imagem de um gato astronauta"
 *   "me faz uma foto de praia ao pôr do sol"
 *   "quero um vídeo curto mostrando café sendo servido"
 *   "faz uma imagem disso"  → usa o assunto da conversa como tema
 *
 * Função pura (sem DOM), usada pelo chat e coberta por testes.
 */

export type FrocRoutedMode = 'Imagem' | 'Vídeo' | 'Pesquisa';

export interface FrocRoutedIntent {
  mode: FrocRoutedMode;
  /** Texto limpo para o gerador (ex.: "um gato astronauta"). */
  prompt: string;
}

export interface FrocRouteContext {
  /** Último assunto da conversa (para "faz uma imagem disso"). */
  previousTopic?: string;
  /** Mensagem com anexos: "analise esta imagem" nunca é geração. */
  hasAttachments?: boolean;
}

const stripWord = (word: string) =>
  word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const IMAGE_NOUNS = new Set([
  'imagem', 'imagens', 'imagen', 'image', 'images', 'foto', 'fotos', 'fotografia', 'fotografias',
  'ilustracao', 'ilustracoes', 'desenho', 'desenhos', 'figura', 'figuras', 'arte', 'artes',
  'logotipo', 'logomarca', 'wallpaper', 'retrato', 'retratos', 'pintura', 'pinturas', 'poster',
  'cartaz', 'figurinha', 'figurinhas', 'avatar', 'icone', 'thumbnail', 'thumb', 'capa',
]);
const VIDEO_NOUNS = new Set([
  'video', 'videos', 'vidio', 'vidios', 'animacao', 'animacoes', 'clipe', 'clipes', 'reel', 'reels',
  'short', 'shorts', 'filminho', 'curta',
]);

/** Verbos/expressões de pedido que podem vir antes do objeto. */
const TRIGGERS = new Set([
  'crie', 'cria', 'criar', 'criaria', 'gere', 'gera', 'gerar', 'faca', 'faz', 'fazer', 'faria', 'desenhe',
  'desenha', 'desenhar', 'produza', 'produz', 'produzir', 'monte', 'monta', 'montar', 'manda', 'mande',
  'mandar', 'envia', 'envie', 'enviar', 'quero', 'queria', 'preciso', 'precisava', 'gostaria', 'desejo',
  'pode', 'podia', 'poderia', 'consegue', 'conseguiria', 'imagine', 'imagina', 'pinte', 'pinta',
  'ilustre', 'ilustra', 'renderize', 'renderiza', 'anime', 'anima', 'grave', 'grava', 'bota', 'bote',
  'coloca', 'coloque', 'mostre', 'mostra', 'me', 'da', 'de', 'traz', 'traga', 'vamos', 'bora',
]);
const STRONG_TRIGGERS = new Set([
  'crie', 'cria', 'criar', 'criaria', 'gere', 'gera', 'gerar', 'faca', 'faz', 'fazer', 'faria', 'desenhe',
  'desenha', 'desenhar', 'produza', 'produz', 'produzir', 'monte', 'monta', 'montar', 'manda', 'mande',
  'quero', 'queria', 'preciso', 'precisava', 'gostaria', 'desejo', 'imagine', 'imagina', 'pinte', 'pinta',
  'ilustre', 'ilustra', 'renderize', 'renderiza', 'anime', 'anima', 'traz', 'traga',
]);
/** Palavras que podem ficar entre o verbo e o objeto. */
const FILLERS = new Set([
  'um', 'uma', 'o', 'a', 'os', 'as', 'uns', 'umas', 'outra', 'outro', 'nova', 'novo', 'mais', 'me', 'pra',
  'para', 'mim', 'voce', 'que', 'ai', 'agora', 'tambem', 'so', 'rapidinho', 'rapido', 'ja', 'la', 'de',
  'favor', 'por', 'pf', 'linda', 'lindo', 'bonita', 'bonito', 'realista', 'realistas', 'curta', 'curto',
  'pequena', 'pequeno', 'grande', 'bela', 'belo', 'incrivel', 'legal', 'top', 'hd', '4k', 'ultra',
  'profissional', 'criativa', 'criativo', 'colorida', 'colorido', 'artistica', 'artistico', 'nos',
  'fazer', 'criar', 'gerar', 'desenhar', 'produzir', 'montar', 'ver', 'ter', 'uma', 'dessas', 'desses',
]);
/** Se aparecerem antes do objeto, é análise/pergunta, não geração. */
const ANALYSIS = new Set([
  'analise', 'analisa', 'analisar', 'descreva', 'descreve', 'descrever', 'leia', 'le', 'ler', 'veja',
  've', 'olhe', 'olha', 'explique', 'explica', 'compare', 'compara', 'traduza', 'traduz', 'identifique',
  'identifica', 'reconheca', 'transcreva', 'resuma', 'resume', 'avalie', 'avalia', 'corrija', 'corrige',
  'edite', 'edita', 'recorte', 'melhore', 'converta', 'baixe', 'baixa', 'salve', 'salva', 'apague',
  'exclua', 'abra', 'abre', 'abrir',
]);
const QUESTION_STARTS = new Set(['como', 'qual', 'quais', 'quanto', 'quanta', 'quando', 'onde', 'quem', 'porque', 'sera', 'existe', 'oque']);
/** Objeto já existente: "nesta imagem", "essa foto" → não é pedido de criação. */
const DEMONSTRATIVES = new Set(['esta', 'essa', 'nesta', 'nessa', 'desta', 'dessa', 'deste', 'desse', 'neste', 'nesse', 'na', 'no', 'minha', 'meu', 'sua', 'seu']);
/** Palavras que ligam o objeto ao tema: "imagem DE um gato", "vídeo MOSTRANDO...". */
const LINKS = new Set(['de', 'do', 'da', 'dos', 'das', 'com', 'sobre', 'mostrando', 'retratando', 'representando', 'em', 'no', 'na', 'para', 'pro', 'pra', 'que', 'mostre', 'mostra', 'onde', 'tipo', 'estilo']);
/** Ligações fortes para mensagens curtas só com o objeto ("uma imagem de um gato"). */
const OBJECT_LINKS = new Set(['de', 'do', 'da', 'dos', 'das', 'com', 'sobre', 'mostrando', 'retratando', 'representando']);
/** Adjetivos logo depois do objeto que não fazem parte do tema ("imagem REALISTA de..."). */
const LEADING_ADJECTIVES = new Set(['realista', 'realistas', 'curta', 'curto', 'linda', 'lindo', 'bonita', 'bonito', 'hd', '4k', 'ultra', 'rapida', 'rapido', 'pequena', 'pequeno', 'nova', 'novo', 'profissional', 'criativa', 'criativo', 'colorida', 'colorido', 'artistica', 'artistico', 'detalhada', 'detalhado', 'incrivel', 'legal', 'top']);
/** Verbos que já significam imagem: "desenha um dragão". */
const DRAW_VERBS = new Set(['desenhe', 'desenha', 'desenhar', 'pinte', 'pinta', 'pintar', 'ilustre', 'ilustra', 'ilustrar']);
/** Tema que aponta para a conversa: "uma imagem disso". */
const PRONOUN_TOPIC = /^(?:disso|isso|disto|isto|dele|dela|deles|delas|desse assunto|dessa ideia|desse tema|do assunto|do tema|do que (?:a gente )?(?:falamos|conversamos|estamos falando)|sobre isso|sobre o assunto|sobre o que falamos|do que voce disse|dessa resposta|do que (?:eu )?falei)\b/;

const RESEARCH = /(?:^|\s)(?:pesquise|pesquisa sobre|pesquisar sobre|faca uma pesquisa|faz uma pesquisa|fazer uma pesquisa|investigue|procure na (?:internet|web)|busque na (?:internet|web)|procura na (?:internet|web)|busca na (?:internet|web)|pesquisa na (?:internet|web)|pesquise na (?:internet|web))\b/;

interface Word { raw: string; norm: string; endsClause: boolean }

function words(text: string): Word[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((raw) => ({ raw, norm: stripWord(raw), endsClause: /[,.;:!?…]$/.test(raw) }))
    .filter((word) => word.norm || word.endsClause);
}

/** Separa a frase em trechos: vírgula, ponto, "e agora", "agora", "então"… */
function clauses(list: Word[]): Word[][] {
  const result: Word[][] = [];
  let current: Word[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const word = list[index];
    const startsNew =
      current.length > 0 &&
      (word.norm === 'agora' || word.norm === 'entao' || word.norm === 'depois' ||
        (word.norm === 'e' && /^(?:agora|entao|depois|tambem|ai)$/.test(list[index + 1]?.norm || '')) ||
        (word.norm === 'mas' && current.length > 2));
    if (startsNew) {
      result.push(current);
      current = [];
    }
    if (word.norm) current.push(word);
    if (word.endsClause && current.length) {
      result.push(current);
      current = [];
    }
  }
  if (current.length) result.push(current);
  return result;
}

function cleanPrompt(list: Word[]): string {
  return list.map((word) => word.raw).join(' ').replace(/^[\s,.;:!?…-]+|[\s,.;:!?…]+$/g, '').trim();
}

function mediaInClause(clause: Word[], isShortMessage: boolean): { mode: 'Imagem' | 'Vídeo'; nounIndex: number } | null {
  if (!clause.length) return null;
  if (QUESTION_STARTS.has(clause[0].norm) || (clause[0].norm === 'o' && clause[1]?.norm === 'que') ||
      (clause[0].norm === 'por' && clause[1]?.norm === 'que')) return null;

  for (let index = 0; index < clause.length; index += 1) {
    const norm = clause[index].norm;
    const mode = IMAGE_NOUNS.has(norm) ? 'Imagem' : VIDEO_NOUNS.has(norm) ? 'Vídeo' : null;
    if (!mode) continue;
    // "foto de perfil" é a conta do usuário; "capa"/"arte" sozinhos são ambíguos sem verbo forte.
    if (norm === 'foto' && clause[index + 1]?.norm === 'de' && clause[index + 2]?.norm === 'perfil') return null;
    if (index > 0 && DEMONSTRATIVES.has(clause[index - 1].norm)) return null;

    // Procura o verbo de pedido antes do objeto, aceitando palavras de enchimento no caminho.
    let hasStrong = false;
    let hasTrigger = false;
    for (let back = index - 1; back >= 0 && back >= index - 7; back -= 1) {
      const previous = clause[back].norm;
      if (ANALYSIS.has(previous)) return null;
      if (STRONG_TRIGGERS.has(previous)) { hasStrong = true; hasTrigger = true; continue; }
      if (TRIGGERS.has(previous)) { hasTrigger = true; continue; }
      if (FILLERS.has(previous)) continue;
      break;
    }
    if (hasStrong) return { mode, nounIndex: index };
    // "me manda/mostra uma imagem de..." (gatilho fraco) ou mensagem curta só com o objeto: "uma imagem de um gato".
    const startsWithObject = index === 0 || (index <= 2 && /^(?:um|uma|umas|uns)$/.test(clause[index - 1].norm) &&
      clause.slice(0, index).every((word) => FILLERS.has(word.norm)));
    if ((hasTrigger || startsWithObject) && isShortMessage && OBJECT_LINKS.has(clause[index + 1]?.norm || '')) {
      return { mode, nounIndex: index };
    }
    if (hasTrigger && OBJECT_LINKS.has(clause[index + 1]?.norm || '') && (clause[index + 2] !== undefined)) {
      return { mode, nounIndex: index };
    }
  }
  return null;
}

export function routeFrocRequest(text: string, context: FrocRouteContext = {}): FrocRoutedIntent | null {
  const original = String(text || '').trim();
  if (!original) return null;
  const all = words(original);
  if (!all.length) return null;
  const isShortMessage = all.length <= 14;

  // O pedido costuma estar no fim ("...agora cria uma imagem de X"): analisa do último trecho para o primeiro.
  const parts = clauses(all);
  for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
    const clause = parts[partIndex];
    const found = mediaInClause(clause, isShortMessage);
    if (!found) {
      // "desenha um dragão", "pinta uma paisagem"
      const verbAt = clause.findIndex((word) => DRAW_VERBS.has(word.norm));
      const beforeOk = verbAt >= 0 && clause.slice(0, verbAt).every((word) => FILLERS.has(word.norm) || TRIGGERS.has(word.norm));
      const abstractTopic = clause.slice(verbAt + 1).some((word) =>
        /^(?:plano|planos|estrategia|arquitetura|projeto|sistema|processo|fluxo|solucao|banco|tabela|funil|roteiro|cronograma)$/.test(word.norm));
      if (beforeOk && !abstractTopic && clause.length > verbAt + 1 && !context.hasAttachments) {
        const topic = cleanPrompt([...clause.slice(verbAt + 1), ...parts.slice(partIndex + 1).flat()]);
        return { mode: 'Imagem', prompt: topic };
      }
      continue;
    }
    if (context.hasAttachments && found.mode === 'Imagem') {
      // Com anexo, só gera se o verbo de criação for explícito.
      const strong = clause.slice(0, found.nounIndex).some((word) => STRONG_TRIGGERS.has(word.norm));
      if (!strong) return null;
    }

    // Tema: o que vem depois do objeto, sem as palavras de ligação iniciais
    // ("imagem DE um gato" → "um gato"). Continua pelos trechos seguintes.
    let rest = clause.slice(found.nounIndex + 1);
    while (rest.length && ((LINKS.has(rest[0].norm) && rest[0].norm !== 'que') || LEADING_ADJECTIVES.has(rest[0].norm))) rest = rest.slice(1);
    const tail = parts.slice(partIndex + 1).flat();
    let prompt = cleanPrompt([...rest, ...tail]);
    const promptNorm = prompt.split(' ').map(stripWord).filter(Boolean).join(' ');

    if (!promptNorm || PRONOUN_TOPIC.test(promptNorm)) {
      const topic = (context.previousTopic || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      prompt = topic
        ? `${found.mode === 'Vídeo' ? 'Vídeo' : 'Imagem'} sobre: ${topic}`
        : original;
    }
    return { mode: found.mode, prompt };
  }

  const normalizedAll = all.map((word) => word.norm).join(' ');
  if (RESEARCH.test(normalizedAll) && !QUESTION_STARTS.has(all[0].norm)) {
    return { mode: 'Pesquisa', prompt: original };
  }
  return null;
}
