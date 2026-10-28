export type IntentMessage = { role: string; content: string };
export const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Quoted instructions are data. Inline code may identify a repository, but cannot issue a command. */
export function instructionText(prompt: string) {
  return normalized(prompt.replace(/```[\s\S]*?```|^\s*>[^\n]*|["“][^"”\n]*["”]|['‘][^'’\n]*['’]|`[^`\n]*`/gm, ' '));
}
const verb = /\b(?:corrija|corrige|conserte|conserta|arrume|arruma|repare|resolva|implemente|implementar|desenvolva|registre|registrar|execute|inicie|rode|aplique|audite|varra)\b/g;
export function hasEngineeringOrder(prompt: string) {
  const text = instructionText(prompt).replace(/\b(nao|nunca)\s*\n\s*/g, '$1 ');
  for (const clause of text.split(/[\n.!?;]|,\s*|\bmas\b|\be\s+(?=(?:corrija|implemente|inicie|execute|registre)\b)/)) {
    for (const match of clause.matchAll(verb)) {
      const before = clause.slice(Math.max(0, match.index! - 65), match.index);
      if (/\b(?:nao|nunca|sem)\s+(?:(?:quero|vamos|pode|deve|precisa|mais|que|voce|ainda|por|favor)\s+)*$/.test(before)) continue;
      if (/^\s*(?:como|por que|o que|quando|se)\b/.test(clause)) continue;
      if (/corrij|corrige|consert|arrum|repar|resolv|implement|desenvolv/.test(match[0]) ||
          /\b(?:tarefa|correcao|correcoes|engenharia|desenvolvimento|manutencao|autoevolucao|auditoria|varredura)\b/.test(clause)) return true;
    }
  }
  return /(?:^|\n)\s*(?:p[01]\s*[-—:]\s*)?(?:correcao completa|ordem de engenharia)\b/.test(text) &&
    /\b(?:repositorio[- ]alvo|propria plataforma|autoevolucao)\b/.test(text);
}
const ownRepo = 'brasilportalvip-png/frocia2';
const ownName = /\bfroc(?:\.?\s*ia|ia2)\b/;
export function explicitOwnTarget(prompt: string) {
  const text = instructionText(prompt);
  const target = text.match(/repositorio[- ]alvo\s*:\s*(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+)/)?.[1];
  if (target) return target.replace(/\.git$/, '') === ownRepo;
  return /\b(?:propria|proprio)\s+(?:froc\.?\s*ia|plataforma|produto)\b|\bcorrecao\s+(?:completa\s+)?(?:e\s+)?(?:na|da)\s+froc\.?\s*ia\b/.test(text) ||
    /\b(?:corrija|corrigir|conserte|implemente|autoevolucao)\b.{0,70}\b(?:a |na |da |propria )?froc\.?\s*ia\b/.test(text) ||
    /https?:\/\/github\.com\/brasilportalvip-png\/frocia2(?:[\s/#?]|$)/.test(text);
}
export function externalRepository(prompt: string) {
  const text = normalized(prompt.replace(/```[\s\S]*?```|^\s*>[^\n]*/gm, ' '));
  const matches = [...text.matchAll(/https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/g)];
  return matches.map(m => `${m[1]}/${m[2].replace(/\.git$/, '')}`).find(repo => repo !== ownRepo) || null;
}
export function engineeringScope(prompt: string, history: IntentMessage[] = []): 'own' | 'external' | null {
  if (explicitOwnTarget(prompt)) return 'own';
  if (externalRepository(prompt) || /\b(?:outro|outra)\s+(?:site|empresa|projeto|repositorio)\b/.test(instructionText(prompt))) return 'external';
  const text = instructionText(prompt);
  if (ownName.test(text) || /\b(?:meu|seu|nosso|proprio)\s+(?:site|repositorio)\b/.test(text)) return 'own';
  const previous = history.filter(m => m.role === 'user' && m.content !== prompt).slice(-1)[0];
  return previous && hasEngineeringOrder(prompt) ? engineeringScope(previous.content) : null;
}
