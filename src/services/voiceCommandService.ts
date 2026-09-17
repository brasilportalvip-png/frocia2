const FROC_NAME_PATTERN = '(?:froc|frock|frog|rock|froke|fr[oó]qui)';
const WAKE_PREFIX_PATTERN = '(?:ok(?:ay)?|ol[aá]|ei)';
const WAKE_PATTERN = new RegExp(`^\\s*${WAKE_PREFIX_PATTERN}\\s+${FROC_NAME_PATTERN}\\b`, 'i');

export function normalizeFrocVoiceCommand(transcript: string): string {
  return transcript.replace(WAKE_PATTERN, '').replace(/^\s*,?\s*/, '').replace(/\s+/g, ' ').trim();
}
export function hasFrocWakePhrase(transcript: string): boolean {
  return WAKE_PATTERN.test(transcript);
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

const STOP_PATTERN = new RegExp(
  `^(?:${FROC_NAME_PATTERN}\\s*,?\\s*)?(?:pare|parar|desligue|desativar)(?:\\s+(?:a\\s+)?escuta)?[.!]?$`,
  'i'
);

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

/**
 * Mobile browsers already require an explicit tap before opening the microphone.
 * After that user gesture, accepting a direct final sentence avoids forcing a
 * second wake-word round-trip that Chrome for Android frequently closes between
 * utterances.
 */
export function classifyFrocMobileVoiceTranscript(
  transcript: string,
  isFinal: boolean
): FrocVoiceIntent {
  const intent = classifyFrocVoiceTranscript(transcript, isFinal, false);
  if (!isFinal || intent.type !== 'none') return intent;
  const command = normalizeFrocVoiceCommand(transcript);
  return command ? { type: 'command', command } : { type: 'none' };
}

export function isAndroidChromeVoiceClient(userAgent: string): boolean {
  return /Android/i.test(userAgent) && /Chrome\//i.test(userAgent) && !/(?:EdgA|OPR)\//i.test(userAgent);
}
