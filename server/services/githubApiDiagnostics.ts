import { RedactionService } from '../selfEvolution/redactionService.js';

export interface GithubApiDiagnostic {
  httpStatus: number;
  githubMessage?: string;
  requestId?: string;
  requiredPermissions?: string;
  rateLimitRemaining?: number;
  retryAfterSeconds?: number;
}

/** Somente campos publicos do erro: nunca o corpo completo nem cabecalhos de autenticacao. */
export function safeGithubText(value: unknown, secrets: string[] = []): string {
  if (typeof value !== 'string') return '';
  let text = value;
  for (const secret of [...secrets, process.env.GITHUB_TOKEN, process.env.GITHUB_APP_TOKEN,
    process.env.GITHUB_APP_PRIVATE_KEY]) {
    if (secret?.trim()) text = text.split(secret.trim()).join('[REDACTED_SECRET]');
  }
  return RedactionService.redactSensitiveData(text).replace(/[\r\n\t]+/g, ' ').slice(0, 600);
}

export async function inspectGithubFailure(response: Response, secrets: string[] = []): Promise<GithubApiDiagnostic> {
  const diagnostic: GithubApiDiagnostic = { httpStatus: response.status };
  try {
    const body: unknown = await response.json();
    const message = body && typeof body === 'object' ? (body as Record<string, unknown>).message : undefined;
    const safe = safeGithubText(message, secrets);
    if (safe) diagnostic.githubMessage = safe;
  } catch { /* Um erro HTML/vazio continua sendo um erro HTTP, sem expor seu corpo. */ }
  const header = (name: string) => response.headers?.get(name) || '';
  const requestId = header('x-github-request-id');
  if (/^[a-fA-F0-9:-]{1,100}$/.test(requestId)) diagnostic.requestId = requestId;
  const permissions = header('x-accepted-github-permissions');
  if (/^[a-z_]+=(?:read|write)(?:[,;] ?[a-z_]+=(?:read|write))*$/.test(permissions) && permissions.length <= 300) {
    diagnostic.requiredPermissions = permissions;
  }
  for (const [name, key] of [['x-ratelimit-remaining', 'rateLimitRemaining'], ['retry-after', 'retryAfterSeconds']] as const) {
    const value = header(name);
    if (/^\d{1,10}$/.test(value)) diagnostic[key] = Number(value);
  }
  return diagnostic;
}

export function formatGithubFailure(operation: string, diagnostic: GithubApiDiagnostic): string {
  return `${operation}: HTTP ${diagnostic.httpStatus}.` +
    (diagnostic.githubMessage ? ` GitHub: ${diagnostic.githubMessage}.` : '') +
    (diagnostic.requiredPermissions ? ` Permissoes exigidas: ${diagnostic.requiredPermissions}.` : '') +
    (diagnostic.rateLimitRemaining === 0 ? ' O limite de requisicoes desta credencial foi atingido.' : '') +
    (diagnostic.retryAfterSeconds !== undefined ? ` Nova tentativa permitida apos ${diagnostic.retryAfterSeconds}s.` : '') +
    (diagnostic.requestId ? ` Referencia GitHub: ${diagnostic.requestId}.` : '');
}
