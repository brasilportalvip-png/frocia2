const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const factualRequest = /\b(?:qual|quais|quanto|quantos|quem|onde|quando|pesquise|pesquisa|busque|busca|procure|consulte|verifique|confira|mostre|compare|recomende|explique|me diga|quero|preciso|gostaria|poderia|pode|mande|traga|crie|gere|faca)\b/;

/** Trata a fala atual; o assunto antigo nao transforma uma despedida em pesquisa. */
export function isEverydayConversation(prompt: string): boolean {
  const text = normalize(prompt);
  if (factualRequest.test(text) || /\bcomo\s+(?!(?:voce|vc|ce)\b|(?:vai|esta)\s+(?:voce|vc|ce|tudo)\b)/.test(text)) return false;
  const greeting = /^(?:(?:ok|okay),?\s+(?:froc(?:\.?ia)?|frank),?\s*)?(?:oi|ola|bom dia|boa tarde|boa noite|tudo bem|como voce (?:esta|vai)|(?:esta )?tudo bem com voce|voce esta bem)(?=\s|[?!.,]|$)/.test(text);
  return (greeting && !/\b(?:api|sdk|versao|preco|cotacao|clima|noticias?|disponivel|presidente|ceo)\b/.test(text)) ||
    /\b(?:por hoje e so|por agora e so|por enquanto e so|vou (?:descansar|dormir|deitar|sair)|ate amanha|ate mais|obrigad[oa] pela (?:ajuda|conversa))\b/.test(text) ||
    /^(?:(?:hoje|ontem|agora)[, ]+)?(?:eu )?(?:ja )?(?:trabalhei|terminei|consegui|configurei|liberei|alterei|corrigi|passei o dia|estou cansad[oa])\b/.test(text) ||
    /\b(?:conversar com voce|tudo que voce (?:fala|responde)|voce (?:so repete|nao responde|nao entendeu)|esta dificil conversar|ta dificil conversar)\b/.test(text);
}

export function isConversationRecall(prompt: string): boolean {
  const text = normalize(prompt);
  if (/\b(?:pesquise|busque|procure|consulte|verifique|compare|noticias?|cotacao|placar|clima|presidente|ceo)\b/.test(text)) return false;
  return /\b(?:eu (?:te )?(?:pedi|disse|contei|falei|enviei|mandei|comentei)|(?:te|lhe) (?:pedi|disse|contei|falei)|conversamos|falamos|combinamos|decidimos)\b/.test(text) &&
    /\b(?:lembra|lembre|recorda|recorde|qual|quais|o que|como|retome|continue)\b/.test(text);
}
