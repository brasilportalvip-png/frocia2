export function normalizeFrocVoiceCommand(transcript: string): string {
  return transcript.replace(/^\s*(?:ok|ol[aá]|ei)\s+froc(?:\s*,?\s*)?/i, '').replace(/\s+/g, ' ').trim();
}
export function hasFrocWakePhrase(transcript: string): boolean {
  return /^\s*(?:ok|ol[aá]|ei)\s+froc\b/i.test(transcript);
}

export function getFinalFrocVoiceCommand(
  transcript: string,
  isFinal: boolean
): string | null {
  if (!isFinal || !hasFrocWakePhrase(transcript)) return null;
  return normalizeFrocVoiceCommand(transcript) || null;
}
