/**
 * Regras de tamanho e limpeza dos projetos do criador (Forja).
 * O Firestore aceita até 1 MB por documento, então arquivos, conversa e HTML têm teto.
 */

export const FORJA_LIMITS = {
  promptChars: 12_000,
  files: 120,
  fileChars: 400_000,
  totalChars: 850_000,
  htmlChars: 900_000,
  messages: 40,
  messageChars: 6_000,
};

/** Créditos por construção. Ajustável na Vercel: FORJA_CREDITS_NEW e FORJA_CREDITS_EDIT. */
export function forjaCreditCost(isNew: boolean, envVars: Record<string, string | undefined> = process.env) {
  const raw = isNew ? envVars.FORJA_CREDITS_NEW : envVars.FORJA_CREDITS_EDIT;
  const n = Number(raw);
  if (raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0) return Math.round(n);
  return isNew ? 95 : 30;
}

// Tipo simples (sem união): o projeto não usa "strict", e a união não se estreitaria em `!r.ok`.
export interface ForjaFilesResult {
  ok: boolean;
  files: Record<string, string>;
  error: string;
}

export function sanitizeForjaFiles(input: unknown): ForjaFilesResult {
  const files: Record<string, string> = {};
  if (!input || typeof input !== 'object') return { ok: true, files, error: '' };
  let total = 0;
  for (const [rawPath, content] of Object.entries(input as Record<string, unknown>)) {
    if (typeof content !== 'string') continue;
    const path = rawPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
    if (!path || path.length > 200 || path.split('/').some((s) => s === '..' || s === '')) continue;
    if (/(^|\/)\.env/i.test(path)) continue;
    if (content.length > FORJA_LIMITS.fileChars) return { ok: false, files: {}, error: `O arquivo ${path} é grande demais (máximo ${Math.round(FORJA_LIMITS.fileChars / 1000)} mil caracteres).` };
    total += content.length;
    files[path] = content;
    if (Object.keys(files).length > FORJA_LIMITS.files) return { ok: false, files: {}, error: `O projeto passou de ${FORJA_LIMITS.files} arquivos.` };
  }
  if (total > FORJA_LIMITS.totalChars) return { ok: false, files: {}, error: 'O projeto ficou grande demais para salvar (máximo ~850 mil caracteres de código). Baixe o ZIP e divida em partes.' };
  return { ok: true, files, error: '' };
}

export interface ForjaStoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  plan?: string;
  summary?: string;
  phase?: string;
  phaseLabel?: string;
  error?: string;
  files?: { path: string; status: 'writing' | 'complete'; lines: number; bytes: number }[];
  createdAt: number;
}

const cut = (v: unknown, n = FORJA_LIMITS.messageChars) => (typeof v === 'string' ? v.slice(0, n) : undefined);

export function sanitizeForjaMessages(input: unknown): ForjaStoredMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-FORJA_LIMITS.messages)
    .filter((m) => m && typeof m === 'object')
    .map((m: Record<string, unknown>) => {
      const out: ForjaStoredMessage = {
        id: String(m.id || '').slice(0, 80),
        role: m.role === 'user' ? 'user' : 'assistant',
        content: cut(m.content) ?? '',
        createdAt: Number(m.createdAt) || Date.now(),
      };
      for (const k of ['plan', 'summary', 'phase', 'phaseLabel', 'error'] as const) {
        const v = cut(m[k]);
        if (v) out[k] = v;
      }
      // Mensagem salva no meio da construção não pode voltar "escrevendo" para sempre.
      if (out.phase && !['done', 'error'].includes(out.phase)) out.phase = 'done';
      if (Array.isArray(m.files)) {
        out.files = (m.files as Record<string, unknown>[]).slice(0, 60).map((f) => ({
          path: String(f.path || '').slice(0, 200),
          status: 'complete' as const,
          lines: Number(f.lines) || 0,
          bytes: Number(f.bytes) || 0,
        }));
      }
      return out;
    });
}

/** Caminho de arquivo gerado seguro (sem ../, sem caminho absoluto, sem .env). */
export function safeGeneratedPath(path: string): string | null {
  const p = String(path || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
  if (!p || p.length > 200 || p.split('/').some((s) => s === '..' || s === '')) return null;
  if (/(^|\/)\.env/i.test(p) || /(^|\/)\.git\//.test(p)) return null;
  return p;
}
