export function selectPreferredMalePortugueseVoice(voices: SpeechSynthesisVoice[]) {
  const portuguese=voices.filter(v=>/^pt(?:-|_)/i.test(v.lang));
  return portuguese.find(v=>/\b(male|masculin|daniel|felipe|ricardo|tiago|antonio|paulo|carlos)\b/i.test(v.name))||portuguese.find(v=>/pt-BR/i.test(v.lang))||portuguese[0];
}
