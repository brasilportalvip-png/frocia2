/** Trecho apoiado pela fonte, sem marcação (**negrito**, # títulos, listas) e curto. */
export function plainSupportedText(text: string): string {
  const clean = String(text || '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:#{1,6}|[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 220 ? `${clean.slice(0, 217).trimEnd()}…` : clean;
}
