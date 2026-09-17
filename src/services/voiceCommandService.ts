export function normalizeFrocVoiceCommand(transcript: string): string {
  return transcript.replace(/^\s*(?:ok|ol[aá]|ei)\s+froc(?:\s*,?\s*)?/i, '').replace(/\s+/g, ' ').trim();
}
export function hasFrocWakePhrase(transcript: string): boolean {
  return /^\s*(?:ok|ol[aá]|ei)\s+froc\b/i.test(transcript);
}
