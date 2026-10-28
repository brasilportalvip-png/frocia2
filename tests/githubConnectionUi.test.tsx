// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ user: { id: 'user-a' }, authenticated: true, configured: true }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: fixture.user, loading: false, isAuthenticated: fixture.authenticated }) }));
vi.mock('../src/services/apiClient', () => ({ apiClient: vi.fn() }));
import { apiClient } from '../src/services/apiClient';
import { GithubConnectionPanel } from '../src/components/GithubConnectionPanel';
import { completeGithubCallback, githubCallbackFromHref, removeGithubCallback } from '../src/services/githubConnection';
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.authenticated = true; fixture.configured = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.mocked(apiClient).mockImplementation(async (path: string) => {
    if (path === '/api/github/account') return { configured: fixture.configured, connected: fixture.configured, appConfigured: true, login: 'owner-a' } as any;
    if (path.startsWith('/api/github/installations?')) return { installations: [{ id: 17, account: 'owner-a' }], hasNextPage: false } as any;
    if (path.includes('/repositories?page=')) return { repositories: [{ id: path.endsWith('2') ? 18 : 8, owner: 'owner-a', name: path.endsWith('2') ? 'second-page' : 'existing-repo', private: true, canPush: true }], hasNextPage: !path.endsWith('2') } as any;
    if (path === '/api/github/imports') return { projectId: 'imported-project' } as any;
    return {} as any;
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); });
const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent === text)!;
async function selectRepository() {
  const select = container.querySelector('[aria-label="Repositório GitHub"]') as HTMLSelectElement;
  await act(async () => { select.value = '8'; select.dispatchEvent(new Event('change', { bubbles: true })); });
}

describe('GitHub dentro das jornadas reais', () => {
  it('mostra acesso pendente com ação de login e não consulta conta privada como visitante', async () => {
    fixture.authenticated = false;
    await act(async () => root.render(<GithubConnectionPanel purpose="create" />));
    expect(button('Entrar para conectar GitHub')).toBeDefined(); expect(apiClient).not.toHaveBeenCalled();
  });
  it('não afirma conexão operacional quando faltam credenciais do servidor', async () => {
    fixture.configured = false;
    await act(async () => root.render(<GithubConnectionPanel />));
    expect(container.textContent).toContain('precisa ser habilitada'); expect(container.textContent).not.toContain('Conectado como');
  });
  it('seleciona o destino real na criação, sem publicar nem usar a conta global', async () => {
    const select = vi.fn();
    await act(async () => root.render(<GithubConnectionPanel purpose="create" onSelect={select} />));
    await selectRepository(); await act(async () => button('Usar este destino').click());
    expect(select).toHaveBeenCalledWith({ owner: 'owner-a', repository: 'existing-repo', installationId: 17 });
    expect(vi.mocked(apiClient).mock.calls.some(([path]) => String(path).includes('/deploy'))).toBe(false);
  });
  it('importa o repositório selecionado com vínculo e abre o projeto retornado pelo backend', async () => {
    const imported = vi.fn(); window.addEventListener('froc:github-project', imported);
    await act(async () => root.render(<GithubConnectionPanel purpose="import" />));
    await selectRepository(); await act(async () => button('Conectar este projeto').click());
    expect(apiClient).toHaveBeenCalledWith('/api/github/imports', expect.objectContaining({ method: 'POST', body: JSON.stringify({ owner: 'owner-a', repository: 'existing-repo', installationId: 17, humanConfirmed: true }) }));
    expect(imported.mock.calls[0][0].detail.projectId).toBe('imported-project');
    window.removeEventListener('froc:github-project', imported);
  });
  it('oferece a próxima página de repositórios', async () => {
    await act(async () => root.render(<GithubConnectionPanel purpose="create" />));
    await act(async () => button('Carregar mais repositórios').click());
    expect(container.querySelector('[aria-label="Repositório GitHub"]')?.textContent).toContain('second-page');
  });
  it('não troca o mesmo código duas vezes no StrictMode e remove código/estado da URL', async () => {
    const href = 'https://froc.example/?github=callback&code=oauth-code&state=state-one';
    const callback = githubCallbackFromHref(href)!;
    await Promise.all([completeGithubCallback('user-a', callback), completeGithubCallback('user-a', callback)]);
    expect(vi.mocked(apiClient).mock.calls.filter(([path]) => path === '/api/github/oauth/callback')).toHaveLength(1);
    const sanitized = new URL(removeGithubCallback(href));
    expect(sanitized.searchParams.get('view')).toBe('integrations');
    expect(sanitized.searchParams.has('code')).toBe(false); expect(sanitized.searchParams.has('state')).toBe(false);
  });
});
