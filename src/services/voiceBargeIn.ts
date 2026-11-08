/**
 * Interrupção em tempo real (barge-in) da Froc.IA.
 *
 * O microfone continua ouvindo enquanto a Froc pensa e fala. Quando a pessoa
 * fala por cima, a Froc para na hora e atende o novo pedido. Como o alto-falante
 * também chega ao microfone, o texto ouvido é comparado com o que a própria Froc
 * está dizendo para não se interromper com o próprio eco.
 */

export type BargeInDecision = 'ignore' | 'stop-only' | 'interrupt';

const normalize = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Frases curtas que só pedem para ela calar/parar de falar. */
const STOP_ONLY =
  /^(?:(?:ok|ei|oi|ola|hey)\s+)?(?:(?:froc|frock|frog|froke)\s*)?(?:(?:ok|ei)\s+)?(?:para|pare|parar|para ai|para de falar|pare de falar|chega|chega ai|espera|espere|espera ai|perai|pera|peraí|silencio|fica quieta|cala|cala a boca|stop|calma|ja entendi|entendi|ok obrigado|obrigado|obrigada|valeu|beleza|ta bom|tudo bem|ok)?$/;

/** Fração das palavras ouvidas que aparecem no texto que a Froc está falando. */
export function echoRatio(heard: string, spoken: string): number {
  const heardWords = normalize(heard).split(' ').filter((word) => word.length >= 3);
  if (!heardWords.length) return 0;
  const spokenWords = new Set(normalize(spoken).split(' ').filter((word) => word.length >= 3));
  if (!spokenWords.size) return 0;
  const hits = heardWords.filter((word) => spokenWords.has(word)).length;
  return hits / heardWords.length;
}

export function isLikelyEcho(heard: string, spoken: string): boolean {
  const words = normalize(heard).split(' ').filter((word) => word.length >= 3);
  if (!words.length) return false;
  // Uma ou duas palavras soltas que a Froc acabou de dizer: quase sempre eco.
  if (words.length <= 2) return echoRatio(heard, spoken) >= 0.5;
  return echoRatio(heard, spoken) >= 0.6;
}

/**
 * Decide o que fazer com uma fala ouvida enquanto a Froc está ocupada
 * (falando, pensando ou aguardando a resposta).
 */
export function decideBargeIn(heard: string, isFinal: boolean, spokenReference: string): BargeInDecision {
  const text = normalize(heard);
  if (!text) return 'ignore';
  if (STOP_ONLY.test(text) && text.length > 0) {
    // "ok", "beleza" ditos pela própria Froc não devem calá-la.
    if (isLikelyEcho(text, spokenReference) && !/^(?:(?:ok|ei|oi)\s+)?(?:froc|para|pare|chega|espera|silencio|cala|stop)/.test(text)) {
      return 'ignore';
    }
    return 'stop-only';
  }
  if (isLikelyEcho(text, spokenReference)) return 'ignore';
  const meaningful = text.split(' ').filter((word) => word.length >= 2);
  if (isFinal) return meaningful.length >= 1 ? 'interrupt' : 'ignore';
  // Parcial: exige um começo de frase real para não cortar por ruído.
  return meaningful.length >= 3 ? 'interrupt' : 'ignore';
}
