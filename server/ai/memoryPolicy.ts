import { createHash } from 'node:crypto';

export type MemoryPurpose =
  | 'personalization'
  | 'project_continuity'
  | 'conversation_context'
  | 'user_note';

export type MemorySensitivity = 'standard' | 'personal';

export class MemoryPolicyViolationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MemoryPolicyViolationError';
    this.code = code;
  }
}

const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:password|senha|passwd|secret|segredo|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*["']?\S{6,}/i,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{12,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:\d[ -]*?){13,19}\b.*\b(?:cvv|cvc|validade)\b/i,
];

const PERSONAL_DATA_PATTERNS = [
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/,
  /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/,
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,
  /\b(?:endere[cç]o|data de nascimento|documento pessoal)\s*[:=]/i,
];

const DEFAULT_RETENTION_DAYS = {
  user: 365,
  organization: 180,
  project: 180,
  conversation: 30,
} as const;

export function assertMemoryContentAllowed(content: string): void {
  const normalized = content.normalize('NFKC').trim();

  if (!normalized) {
    throw new MemoryPolicyViolationError(
      'empty_memory',
      'A memória não pode estar vazia.'
    );
  }

  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new MemoryPolicyViolationError(
      'credentials_forbidden',
      'Senhas, tokens, chaves privadas e dados completos de cartão não podem ser salvos como memória.'
    );
  }
}

export function classifyMemorySensitivity(
  content: string,
  requested: MemorySensitivity = 'standard'
): MemorySensitivity {
  if (
    requested === 'personal' ||
    PERSONAL_DATA_PATTERNS.some((pattern) => pattern.test(content))
  ) {
    return 'personal';
  }

  return 'standard';
}

export function resolveRetention(
  scope: keyof typeof DEFAULT_RETENTION_DAYS,
  requestedDays?: number,
  from = new Date()
): { retentionDays: number; validUntil: string } {
  const retentionDays = Math.max(
    1,
    Math.min(730, requestedDays || DEFAULT_RETENTION_DAYS[scope])
  );
  const validUntil = new Date(
    from.getTime() + retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  return { retentionDays, validUntil };
}

export function memoryQueryFingerprint(prompt: string): string {
  return createHash('sha256')
    .update(prompt.normalize('NFKC').trim().toLowerCase())
    .digest('hex')
    .slice(0, 24);
}

export function defaultPurposeForScope(
  scope: keyof typeof DEFAULT_RETENTION_DAYS
): MemoryPurpose {
  if (scope === 'project' || scope === 'organization') {
    return 'project_continuity';
  }
  if (scope === 'conversation') return 'conversation_context';
  return 'personalization';
}
