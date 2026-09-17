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

export type FrocVoiceIntent =
  | { type: 'none' }
  | { type: 'preview'; text: string }
  | { type: 'wake' }
  | { type: 'command'; command: string }
  | { type: 'stop' };

const STOP_PATTERN = /^(?:froc\s*,?\s*)?(?:pare|parar|desligue|desativar)(?:\s+(?:a\s+)?escuta)?[.!]?$/i;

export function classifyFrocVoiceTranscript(
  transcript: string,
  isFinal: boolean,
  armed: boolean
): FrocVoiceIntent {
  const cleaned = transcript.replace(/\s+/g, ' ').trim();
  if (!cleaned) return { type: 'none' };
  if (isFinal && STOP_PATTERN.test(cleaned)) return { type: 'stop' };

  const hasWake = hasFrocWakePhrase(cleaned);
  const command = normalizeFrocVoiceCommand(cleaned);
  if (!isFinal) return { type: 'preview', text: command || cleaned };
  if (hasWake && !command) return { type: 'wake' };
  if ((hasWake || armed) && command) return { type: 'command', command };
  return { type: 'none' };
}
