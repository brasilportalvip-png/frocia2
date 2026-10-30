/**
 * Resumo do código-fonte de um projeto importado, para a conversa saber do que se trata.
 * Recebe somente os arquivos já filtrados (sem .env) e ainda mascara trechos que parecem segredos.
 */
const MAX_TOTAL_CHARS = 24_000;
const MAX_PER_FILE_CHARS = 4_000;
const MAX_TREE_ENTRIES = 120;
const TEXT_FILE = /\.(?:tsx?|jsx?|mjs|cjs|json|html?|css|md|txt|vue|svelte)$/i;
const SKIP_FILE = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.min\.(?:js|css)|.*\.map)$/i;
const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{30,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /(?:secret|token|password|private_key)\s*[:=]\s*['"][^'"\s]{12,}['"]/gi,
];

export function maskSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, '[segredo-oculto]'), text);
}

function priority(path: string): number {
  const lower = path.toLowerCase();
  if (/^readme/.test(lower)) return 0;
  if (lower === 'package.json') return 1;
  if (/(^|\/)index\.html$/.test(lower)) return 2;
  if (/(^|\/)(?:main|index)\.(?:tsx?|jsx?)$/.test(lower)) return 3;
  if (/(^|\/)app\.(?:tsx?|jsx?|vue|svelte)$/.test(lower)) return 4;
  if (/(^|\/)(?:pages|components|routes|views)\//.test(lower)) return 6;
  if (/^src\//.test(lower)) return 5;
  return 8;
}

export function buildSourceDigest(files: Map<string, Uint8Array>): string {
  const paths = Array.from(files.keys()).sort();
  const tree = paths.slice(0, MAX_TREE_ENTRIES).map((path) => `- ${path}`);
  if (paths.length > MAX_TREE_ENTRIES) tree.push(`- … e mais ${paths.length - MAX_TREE_ENTRIES} arquivos`);

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const readable = paths
    .filter((path) => TEXT_FILE.test(path) && !SKIP_FILE.test(path))
    .sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));

  let remaining = MAX_TOTAL_CHARS;
  const sections: string[] = [];
  for (const path of readable) {
    if (remaining <= 200) break;
    const bytes = files.get(path);
    if (!bytes || bytes.byteLength === 0) continue;
    const limit = Math.min(MAX_PER_FILE_CHARS, remaining);
    const raw = decoder.decode(bytes);
    const body = maskSecrets(raw.length > limit ? `${raw.slice(0, limit)}\n… (arquivo cortado)` : raw);
    sections.push(`### ${path}\n${body}`);
    remaining -= body.length;
  }
  return `ARQUIVOS DO PROJETO:\n${tree.join('\n')}\n\nCÓDIGO (trechos):\n${sections.join('\n\n')}`;
}
