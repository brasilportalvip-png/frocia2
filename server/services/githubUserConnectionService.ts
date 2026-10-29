import crypto from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';

const API = 'https://api.github.com';
const STATE_LIFETIME_MS = 10 * 60_000;

export class GithubUserConnectionError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = 'GithubUserConnectionError';
  }
}

interface Scope { userId: string; tenantId: string }
interface Credentials { accessToken: string; expiresAt: number | null; refreshToken?: string; refreshExpiresAt?: number }
interface Account extends Scope {
  login: string; githubUserId: number; clientId: string;
  encrypted: { iv: string; tag: string; ciphertext: string };
  refreshLease?: { id: string; expiresAt: number } | null;
}

export interface UserGithubRepository {
  id: number; owner: string; name: string; private: boolean;
  defaultBranch: string; canPush: boolean;
}

function configuration() {
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  const stateSecret = process.env.GITHUB_APP_STATE_SECRET?.trim();
  let redirectUri = '';
  try {
    const url = new URL(process.env.APP_URL || '');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password) throw new Error();
    redirectUri = new URL('/?github=callback', url.origin).toString();
  } catch { /* An invalid origin must never receive an authorization code. */ }
  const missing = [
    ...(!clientId ? ['GITHUB_APP_CLIENT_ID'] : []),
    ...(!clientSecret ? ['GITHUB_APP_CLIENT_SECRET'] : []),
    ...(!stateSecret || stateSecret.length < 32 ? ['GITHUB_APP_STATE_SECRET'] : []),
    ...(!redirectUri ? ['APP_URL'] : []),
  ];
  return { clientId, clientSecret, stateSecret, redirectUri, missing };
}

function configured() {
  const config = configuration();
  if (config.missing.length) throw new GithubUserConnectionError(
    'github_user_oauth_not_configured',
    'A autorização de usuários do GitHub App precisa ser configurada pelo administrador.', 503
  );
  if (!isFirebaseAdminConfigured()) throw new GithubUserConnectionError('database_not_configured', 'Banco de dados indisponível.', 503);
  return config;
}

function scopeId(scope: Scope) {
  return crypto.createHash('sha256').update(JSON.stringify([scope.tenantId, scope.userId])).digest('hex');
}

function accountRef(scope: Scope) {
  return adminDb.collection('github_user_connections').doc(scopeId(scope));
}

function seal(value: Credentials, scope: Scope): Account['encrypted'] {
  const key = crypto.createHash('sha256').update(`github-user-token-v1:${configured().stateSecret}`).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(scopeId(scope)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

function unseal(account: Account, scope: Scope): Credentials {
  try {
    const key = crypto.createHash('sha256').update(`github-user-token-v1:${configured().stateSecret}`).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(account.encrypted.iv, 'base64'));
    decipher.setAAD(Buffer.from(scopeId(scope)));
    decipher.setAuthTag(Buffer.from(account.encrypted.tag, 'base64'));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(account.encrypted.ciphertext, 'base64')), decipher.final(),
    ]).toString('utf8'));
  } catch {
    throw new GithubUserConnectionError('github_reconnect_required', 'Reconecte sua conta do GitHub para renovar a autorização.', 401);
  }
}

async function request(path: string, token: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'FrocIA-UserConnection' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GithubUserConnectionError('github_unreachable', 'Não foi possível acessar o GitHub. Tente novamente.', 502);
  }
  if (response.status === 401) throw new GithubUserConnectionError('github_reconnect_required', 'A autorização expirou ou foi revogada. Reconecte sua conta do GitHub.', 401);
  if (!response.ok) throw new GithubUserConnectionError(
    response.status === 404 ? 'github_repository_not_authorized' : 'github_user_request_failed',
    response.status === 404 ? 'O GitHub App ou sua conta não possui acesso ao repositório selecionado.'
      : `O GitHub recusou a consulta (HTTP ${response.status}). Verifique as permissões do aplicativo.`, response.status
  );
  return response;
}

function repository(value: any): UserGithubRepository | null {
  if (!Number.isSafeInteger(value?.id) || !/^[A-Za-z0-9_.-]{1,100}$/.test(value?.name || '') ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(value?.owner?.login || '')) return null;
  return { id: value.id, owner: value.owner.login, name: value.name, private: value.private === true,
    defaultBranch: typeof value.default_branch === 'string' ? value.default_branch : 'main', canPush: value.permissions?.push === true };
}

export class GithubUserConnectionService {
  static configurationStatus() {
    const config = configuration();
    return { configured: config.missing.length === 0, missing: config.missing };
  }

  private static async pendingState(scope: Scope, pkce: boolean) {
    const config = configured();
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = pkce ? crypto.randomBytes(32).toString('base64url') : null;
    const digest = crypto.createHash('sha256').update(state).digest('hex');
    await adminDb.collection('github_oauth_states').doc(digest).set({
      ...scope, verifier, clientId: config.clientId, redirectUri: config.redirectUri,
      expiresAt: Date.now() + STATE_LIFETIME_MS, deleteAfter: new Date(Date.now() + STATE_LIFETIME_MS),
    });
    return { config, state, verifier };
  }

  static async installationState(scope: Scope) {
    return (await this.pendingState(scope, false)).state;
  }

  static async authorizationUrl(scope: Scope) {
    const { config, state, verifier } = await this.pendingState(scope, true);
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({ client_id: config.clientId!, redirect_uri: config.redirectUri, state,
      code_challenge: crypto.createHash('sha256').update(verifier!).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return { url: url.toString() };
  }

  static async completeAuthorization(scope: Scope, code: string, state: string) {
    const config = configured();
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{1,300}$/.test(code)) {
      throw new GithubUserConnectionError('invalid_github_oauth_callback', 'Retorno de autorização inválido. Inicie a conexão novamente.');
    }
    const ref = adminDb.collection('github_oauth_states').doc(crypto.createHash('sha256').update(state).digest('hex'));
    const pending = await adminDb.runTransaction(async (transaction) => {
      const data = (await transaction.get(ref)).data();
      if (!data || data.userId !== scope.userId || data.tenantId !== scope.tenantId ||
          data.expiresAt <= Date.now() || data.clientId !== config.clientId || data.redirectUri !== config.redirectUri) {
        throw new GithubUserConnectionError('invalid_github_oauth_state', 'A autorização expirou, já foi usada ou pertence a outra sessão. Conecte novamente.');
      }
      transaction.delete(ref);
      return data;
    });
    let response: Response;
    try {
      response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret,
          code, redirect_uri: config.redirectUri, ...(pending.verifier ? { code_verifier: pending.verifier } : {}) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new GithubUserConnectionError('github_oauth_exchange_failed', 'Não foi possível concluir a autorização. Inicie a conexão novamente.', 502);
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || typeof result?.access_token !== 'string' || !result.access_token || result.error) {
      throw new GithubUserConnectionError('github_oauth_exchange_failed', 'O GitHub não confirmou a autorização. Inicie a conexão novamente.', 502);
    }
    const user = await (await request('/user', result.access_token)).json();
    if (!Number.isSafeInteger(user.id) || !/^[A-Za-z0-9-]{1,100}$/.test(user.login || '')) {
      throw new GithubUserConnectionError('invalid_github_user', 'O GitHub não confirmou a identidade da conta.', 502);
    }
    const credentials: Credentials = { accessToken: result.access_token,
      expiresAt: typeof result.expires_in === 'number' ? Date.now() + result.expires_in * 1000 : null,
      ...(typeof result.refresh_token === 'string' ? { refreshToken: result.refresh_token } : {}),
      ...(typeof result.refresh_token_expires_in === 'number' ? { refreshExpiresAt: Date.now() + result.refresh_token_expires_in * 1000 } : {}) };
    // User tokens are used only to verify the intersection of user and App access.
    // Writes use short-lived installation tokens; no credentials reach the browser.
    await accountRef(scope).set({ ...scope, login: user.login, githubUserId: user.id,
      clientId: config.clientId, encrypted: seal(credentials, scope), refreshLease: null, updatedAt: new Date().toISOString() });
    return { connected: true, login: user.login };
  }

  static async accessToken(scope: Scope) {
    const config = configured();
    const account = (await accountRef(scope).get()).data() as Account | undefined;
    if (!account || account.userId !== scope.userId || account.tenantId !== scope.tenantId) {
      throw new GithubUserConnectionError('github_user_not_connected', 'Conecte sua conta do GitHub em Integrações.', 409);
    }
    if (account.clientId !== config.clientId) throw new GithubUserConnectionError('github_reconnect_required', 'O aplicativo foi alterado. Reconecte sua conta do GitHub.', 401);
    const credentials = unseal(account, scope);
    if (credentials.accessToken && credentials.expiresAt !== null && credentials.expiresAt <= Date.now() + 30_000 &&
        credentials.refreshToken && (credentials.refreshExpiresAt || 0) > Date.now()) {
      return this.refresh(scope, account, credentials);
    }
    if (!credentials.accessToken || (credentials.expiresAt !== null && credentials.expiresAt <= Date.now())) {
      throw new GithubUserConnectionError('github_reconnect_required', 'A autorização expirou. Reconecte sua conta do GitHub.', 401);
    }
    return credentials.accessToken;
  }

  private static async refresh(scope: Scope, previous: Account, credentials: Credentials): Promise<string> {
    const config = configured();
    const ref = accountRef(scope), leaseId = crypto.randomUUID();
    const claimed = await adminDb.runTransaction(async tx => {
      const current = (await tx.get(ref)).data() as Account | undefined;
      if (!current) throw new GithubUserConnectionError('github_user_not_connected', 'Conecte sua conta do GitHub.', 409);
      if (current.encrypted.ciphertext !== previous.encrypted.ciphertext) return current;
      if (current.refreshLease && current.refreshLease.expiresAt > Date.now()) throw new GithubUserConnectionError(
        'github_refresh_in_progress', 'A autorização está sendo renovada. Aguarde e tente novamente.', 503);
      tx.update(ref, { refreshLease: { id: leaseId, expiresAt: Date.now() + 30_000 } });
      return null;
    });
    if (claimed) return unseal(claimed, scope).accessToken;
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret,
          grant_type: 'refresh_token', refresh_token: credentials.refreshToken }), signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json();
      if (!response.ok || !result.access_token || !result.refresh_token || typeof result.expires_in !== 'number') {
        throw new GithubUserConnectionError('github_reconnect_required', 'Não foi possível renovar a autorização. Reconecte sua conta do GitHub.', 401);
      }
      const next: Credentials = { accessToken: result.access_token, expiresAt: Date.now() + result.expires_in * 1000,
        refreshToken: result.refresh_token, refreshExpiresAt: Date.now() + result.refresh_token_expires_in * 1000 };
      await adminDb.runTransaction(async tx => {
        const current = (await tx.get(ref)).data() as Account | undefined;
        if (!current || current.refreshLease?.id !== leaseId) throw new GithubUserConnectionError('github_reconnect_required', 'A conexão foi alterada. Reconecte o GitHub.', 409);
        tx.update(ref, { encrypted: seal(next, scope), refreshLease: null });
      });
      return next.accessToken;
    } catch (error) {
      await adminDb.runTransaction(async tx => {
        const current = (await tx.get(ref)).data() as Account | undefined;
        if (current?.refreshLease?.id === leaseId) tx.update(ref, { refreshLease: null });
      });
      if (error instanceof GithubUserConnectionError) throw error;
      throw new GithubUserConnectionError('github_unreachable', 'Não foi possível renovar o acesso ao GitHub. Tente novamente.', 502);
    }
  }

  static async status(scope: Scope) {
    const config = this.configurationStatus();
    if (!config.configured) return { ...config, connected: false };
    try {
      const user = await (await request('/user', await this.accessToken(scope))).json();
      return { ...config, connected: true, login: user.login };
    } catch (error) {
      if (error instanceof GithubUserConnectionError && ['github_user_not_connected', 'github_reconnect_required'].includes(error.code)) {
        return { ...config, connected: false, reconnectRequired: error.code === 'github_reconnect_required' };
      }
      throw error;
    }
  }

  static async installations(scope: Scope, page = 1) {
    const response = await request(`/user/installations?per_page=100&page=${page}`, await this.accessToken(scope));
    const data = await response.json();
    return { installations: (Array.isArray(data.installations) ? data.installations : []).flatMap((row: any) =>
      Number.isSafeInteger(row.id) && row.account?.login && !row.suspended_at
        ? [{ id: row.id, account: String(row.account.login) }] : []),
      hasNextPage: /rel="next"/.test(response.headers.get('link') || '') };
  }

  static async repositories(scope: Scope, installationId: number, page = 1) {
    if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new GithubUserConnectionError('invalid_github_installation', 'Instalação inválida.');
    const response = await request(`/user/installations/${installationId}/repositories?per_page=100&page=${page}`, await this.accessToken(scope));
    const data = await response.json();
    return { repositories: (Array.isArray(data.repositories) ? data.repositories : []).map(repository).filter(Boolean) as UserGithubRepository[],
      hasNextPage: /rel="next"/.test(response.headers.get('link') || '') };
  }

  static async assertRepositoryAccess(scope: Scope, owner: string, name: string, write = false) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name)) throw new GithubUserConnectionError('invalid_github_repository', 'Repositório inválido.');
    const data = await (await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, await this.accessToken(scope))).json();
    const selected = repository(data);
    if (!selected || selected.owner.toLowerCase() !== owner.toLowerCase() || selected.name.toLowerCase() !== name.toLowerCase()) throw new GithubUserConnectionError('github_repository_not_authorized', 'O GitHub não confirmou o repositório selecionado.', 403);
    if (write && !selected.canPush) throw new GithubUserConnectionError('github_write_not_authorized', 'Sua conta não tem permissão de escrita neste repositório.', 403);
    return selected;
  }

  static async createRepository(scope: Scope, name: string, isPrivate: boolean) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || ['.', '..'].includes(name)) throw new GithubUserConnectionError('invalid_github_repository', 'Informe um nome válido para o repositório.');
    const token = await this.accessToken(scope);
    let response: Response;
    try {
      response = await fetch(`${API}/user/repos`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ name, private: isPrivate, auto_init: true, description: 'Projeto criado pela Froc.IA' }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new GithubUserConnectionError('github_unreachable', 'Não foi possível criar o repositório. Atualize a lista antes de tentar novamente.', 502); }
    if (!response.ok) throw new GithubUserConnectionError('github_repository_create_failed',
      response.status === 422 ? 'Este nome já existe ou não é válido. Selecione o repositório existente.'
        : 'O GitHub não autorizou criar o repositório. Confira a permissão Administration: write do aplicativo.', response.status);
    const selected = repository(await response.json());
    if (!selected) throw new GithubUserConnectionError('invalid_github_repository', 'O GitHub não confirmou o repositório criado.', 502);
    return selected;
  }

  static async disconnect(scope: Scope) {
    // Remove only this platform connection. App installation and repositories are preserved.
    configured();
    await accountRef(scope).delete();
  }
}
