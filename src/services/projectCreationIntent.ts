/**
 * Decide se a mensagem do chat e um pedido para CRIAR um site/app, para enviar
 * ao Criador de projetos em vez de responder com codigo na conversa.
 * Funcao pura: sem dependencias de navegador. Cobre jeitos naturais de pedir
 * ("quero um site...", "preciso de um app...", "me faz um site...") e evita
 * perguntas ("como criar um site?") e pedidos de outra coisa ("crie uma imagem para o site").
 */
const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const TRIGGERS = new Set([
  'crie', 'cria', 'criar', 'gere', 'gera', 'gerar', 'faca', 'faz', 'fazer', 'monte', 'monta', 'montar',
  'construa', 'constroi', 'construir', 'desenvolva', 'desenvolver', 'elabore', 'programe', 'projete',
  'quero', 'queria', 'preciso', 'precisava', 'gostaria', 'desejo', 'necessito',
  'pode', 'consegue', 'poderia', 'podia', 'vamos', 'bora',
]);

const NOUNS = new Set([
  'site', 'sites', 'website', 'websites', 'aplicativo', 'aplicativos', 'app', 'apps', 'webapp',
  'aplicacao', 'sistema', 'plataforma', 'portfolio', 'blog', 'landing',
]);

/** Palavras que podem aparecer entre o verbo e o substantivo sem mudar o objeto do pedido. */
const FILLERS = new Set([
  'um', 'uma', 'o', 'a', 'os', 'as', 'meu', 'minha', 'nosso', 'nossa', 'novo', 'nova', 'de', 'voce', 'que',
  'me', 'mim', 'nos', 'favor', 'ter', 'criar', 'fazer', 'montar', 'construir', 'gerar', 'desenvolver',
  'completo', 'completa', 'simples', 'bonito', 'bonita', 'moderno', 'moderna', 'profissional', 'otimo',
  'otima', 'bom', 'boa', 'lindo', 'linda', 'incrivel', 'responsivo', 'responsiva', 'web', 'mobile',
  'inteligente', 'rapido', 'rapida', 'personalizado', 'personalizada', 'premium', 'elegante', 'funcional',
  'pronto', 'pronta', 'tambem', 'mesmo',
]);

const QUESTION_STARTS = new Set(['como', 'qual', 'quais', 'quanto', 'quanta', 'quando', 'onde', 'quem', 'porque', 'sera', 'existe']);

export function isProjectCreationRequest(text: string): boolean {
  const tokens = normalize(text || '').split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length < 3) return false;
  if (QUESTION_STARTS.has(tokens[0])) return false;
  if (tokens[0] === 'o' && tokens[1] === 'que') return false;
  if (tokens[0] === 'por' && tokens[1] === 'que') return false;

  const limit = Math.min(tokens.length, 10);
  for (let i = 0; i < limit; i += 1) {
    if (!TRIGGERS.has(tokens[i])) continue;
    for (let j = i + 1; j < Math.min(tokens.length, i + 9); j += 1) {
      const token = tokens[j];
      if (NOUNS.has(token)) {
        if (token === 'landing') return tokens[j + 1] === 'page';
        return true;
      }
      if (token === 'loja' && /^(?:virtual|online)$/.test(tokens[j + 1] || '')) return true;
      if (token === 'pagina' && /^(?:web|inicial|institucional)$/.test(tokens[j + 1] || '')) return true;
      if (!FILLERS.has(token) && !TRIGGERS.has(token)) break;
    }
    // So o primeiro verbo de pedido conta: "quero saber como criar um site" e pergunta.
    return false;
  }
  return false;
}
