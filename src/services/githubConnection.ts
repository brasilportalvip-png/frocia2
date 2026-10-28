import { apiClient } from './apiClient';

export interface GithubOAuthCallback { code: string | null; state: string | null; error: string | null }

export function githubCallbackFromHref(href: string): GithubOAuthCallback | null {
  const params = new URL(href).searchParams;
  if (params.get('github') !== 'callback') return null;
  return { code: params.get('code'), state: params.get('state'), error: params.get('error') };
}

export function removeGithubCallback(href: string) {
  const url = new URL(href);
  for (const key of ['code', 'state', 'error', 'error_description', 'github']) url.searchParams.delete(key);
  url.searchParams.set('view', 'integrations');
  return url.toString();
}

const callbacks = new Map<string, Promise<unknown>>();
export function completeGithubCallback(userId: string, callback: GithubOAuthCallback) {
  if (callback.error) return Promise.reject(new Error('A autorização do GitHub foi cancelada. Você pode conectar novamente.'));
  if (!callback.code || !callback.state) return Promise.reject(new Error('O retorno do GitHub está incompleto. Conecte novamente.'));
  const key = `${userId}:${callback.state}`;
  if (!callbacks.has(key)) {
    const promise = apiClient('/api/github/oauth/callback', { method: 'POST', body: JSON.stringify({ code: callback.code, state: callback.state }) });
    callbacks.set(key, promise);
    void promise.catch(() => { callbacks.delete(key); });
  }
  return callbacks.get(key)!;
}

export const requestGithubLogin = () => window.dispatchEvent(new Event('froc:request-login'));
export const openImportedGithubProject = (projectId: string) => window.dispatchEvent(new CustomEvent('froc:github-project', { detail: { projectId } }));
