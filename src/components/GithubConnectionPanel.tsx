import React, { useCallback, useEffect, useState } from 'react';
import { Github } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/apiClient';
import { completeGithubCallback, openImportedGithubProject, requestGithubLogin, type GithubOAuthCallback } from '../services/githubConnection';
import type { ProjectGithubTarget } from '../services/requestIntent';

interface Repository { id: number; owner: string; name: string; private: boolean; defaultBranch: string; canPush: boolean }
interface Status { configured: boolean; connected: boolean; appConfigured: boolean; login?: string; reconnectRequired?: boolean }
interface Props {
  purpose?: 'create' | 'import' | 'manage';
  onSelect?(target: ProjectGithubTarget): void;
  onImported?(): void;
  callback?: GithubOAuthCallback | null;
  projectId?: string;
}

export function GithubConnectionPanel({ purpose = 'manage', onSelect, onImported, callback, projectId }: Props) {
  const { user, loading, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [installations, setInstallations] = useState<Array<{ id: number; account: string }>>([]);
  const [installationId, setInstallationId] = useState('');
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState(1), [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [newName, setNewName] = useState(''), [isPrivate, setIsPrivate] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const selectedRepository = repositories.find(repository => String(repository.id) === selected);

  useEffect(() => {
    setStatus(null); setRepositories([]); setSelected(''); setInstallations([]); setInstallationId('');
    if (loading || !isAuthenticated) return;
    let current = true;
    const controller = new AbortController();
    setBusy(true); setError('');
    async function load() {
      try {
        if (callback && user) {
          try { await completeGithubCallback(user.id, callback); }
          catch (e) { if (current) setError(e instanceof Error ? e.message : 'Não foi possível concluir a autorização.'); }
        }
        const next = await apiClient<Status>('/api/github/account', { signal: controller.signal });
        if (!current) return;
        setStatus(next);
        if (next.connected) {
          const all: Array<{ id: number; account: string }> = [];
          for (let nextPage = 1; nextPage <= 100; nextPage++) {
            const result = await apiClient<{ installations: typeof all; hasNextPage: boolean }>(`/api/github/installations?page=${nextPage}`, { signal: controller.signal });
            all.push(...result.installations);
            if (!result.hasNextPage) break;
          }
          if (current) { setInstallations(all); setInstallationId(all[0] ? String(all[0].id) : ''); }
        }
      } catch (e) { if (current) setError(e instanceof Error ? e.message : 'Não foi possível consultar o GitHub.'); }
      finally { if (current) setBusy(false); }
    }
    void load();
    return () => { current = false; controller.abort(); };
  }, [loading, isAuthenticated, user?.id, callback, refresh]);

  const loadRepositories = useCallback(async (id: string, nextPage: number, signal?: AbortSignal) => {
    const result = await apiClient<{ repositories: Repository[]; hasNextPage: boolean }>(
      `/api/github/installations/${encodeURIComponent(id)}/repositories?page=${nextPage}`, { signal });
    if (signal?.aborted) return;
    setRepositories(previous => nextPage === 1 ? result.repositories : [...previous, ...result.repositories]);
    setMore(result.hasNextPage); setPage(nextPage);
  }, []);
  useEffect(() => {
    setSelected(''); setRepositories([]); setMore(false);
    if (!installationId) return;
    const controller = new AbortController();
    setBusy(true);
    void loadRepositories(installationId, 1, controller.signal).catch(e => {
      if (!controller.signal.aborted) setError(e.message);
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [installationId, loadRepositories]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir a conexão.'); }
    finally { setBusy(false); }
  }
  async function authorize() {
    await action(async () => {
      const result = await apiClient<{ url: string }>('/api/github/authorize-url', { method: 'POST', body: '{}' });
      const url = new URL(result.url);
      if (url.origin !== 'https://github.com' || url.pathname !== '/login/oauth/authorize') throw new Error('Endereço de autorização inválido.');
      window.location.assign(result.url);
    });
  }
  async function install() {
    await action(async () => {
      const result = await apiClient<{ url: string }>('/api/github/install-url');
      const url = new URL(result.url);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/apps/')) throw new Error('Endereço de instalação inválido.');
      window.open(result.url, '_blank', 'noopener,noreferrer');
      setMessage('Depois de autorizar os repositórios no GitHub, volte e clique em Atualizar conexão.');
    });
  }
  async function useRepository() {
    if (!selectedRepository) return;
    const target = { owner: selectedRepository.owner, repository: selectedRepository.name, installationId: Number(installationId) };
    if (purpose === 'create') { onSelect?.(target); setMessage(`Destino escolhido: ${target.owner}/${target.repository}.`); return; }
    await action(async () => {
      if (projectId) {
        await apiClient('/api/github/connections', { method: 'POST', body: JSON.stringify({ ...target, projectId, humanConfirmed: true }) });
        window.dispatchEvent(new Event('froc:github-connection-updated'));
        setMessage('Repositório conectado ao projeto.');
      } else {
        const result = await apiClient<{ projectId: string }>('/api/github/imports', { method: 'POST', body: JSON.stringify({ ...target, humanConfirmed: true }) });
        openImportedGithubProject(result.projectId); onImported?.();
      }
    });
  }

  return <section className="space-y-3 rounded-2xl border border-white/15 bg-slate-950 p-4 text-white" aria-label="Conexão GitHub">
    <h2 className="flex items-center gap-2 text-sm font-semibold"><Github className="h-4 w-4" />{purpose === 'create' ? 'Salvar o projeto no GitHub' : purpose === 'import' ? 'Conectar projeto existente' : 'Sua conta GitHub'}</h2>
    <p className="text-xs text-slate-300">{purpose === 'create' ? 'Escolha um repositório novo ou vazio para receber o código. Repositórios com código existente devem ser importados.' : 'Autorize sua conta e escolha os repositórios que a Froc.IA pode acessar.'}</p>
    {loading ? <p role="status" className="text-xs">Verificando sessão…</p> : !isAuthenticated ?
      <button type="button" onClick={requestGithubLogin} className="rounded-lg bg-violet-700 px-3 py-2 text-xs">Entrar para conectar GitHub</button> : <>
      {busy && <p role="status" className="text-xs">Consultando o GitHub…</p>}
      {status && !status.configured && <p className="text-xs text-amber-200">A conexão de usuários precisa ser habilitada pelo administrador da Froc.IA.</p>}
      {status?.connected ? <>
        <p className="text-xs text-emerald-300">Conectado como {status.login}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)} className="rounded-lg border border-white/25 px-3 py-2 text-xs disabled:opacity-50">Atualizar conexão</button>
          <button type="button" disabled={busy || !status.appConfigured} onClick={() => void install()} className="rounded-lg border border-white/25 px-3 py-2 text-xs disabled:opacity-50">Autorizar repositórios</button>
          <button type="button" disabled={busy} onClick={() => void action(async () => { await apiClient('/api/github/account', { method: 'DELETE' }); setRefresh(value => value + 1); })} className="rounded-lg border border-white/25 px-3 py-2 text-xs">Desconectar da Froc.IA</button>
        </div>
        <p className="text-[11px] text-slate-400">Desconectar preserva seus repositórios e a instalação no GitHub.</p>
        {installations.length ? <>
          <label className="block text-xs">Conta ou organização<select aria-label="Conta ou organização GitHub" value={installationId} onChange={e => setInstallationId(e.target.value)} disabled={busy} className="mt-1 block w-full rounded-lg bg-slate-800 p-2">
            {installations.map(installation => <option key={installation.id} value={installation.id}>{installation.account}</option>)}
          </select></label>
          <label className="block text-xs">Repositório<select aria-label="Repositório GitHub" value={selected} onChange={e => { setSelected(e.target.value); setMessage(''); }} disabled={busy} className="mt-1 block w-full rounded-lg bg-slate-800 p-2">
            <option value="">Selecione um repositório</option>
            {repositories.map(repository => <option key={repository.id} value={repository.id}>{repository.owner}/{repository.name} · {repository.private ? 'privado' : 'público'}</option>)}
          </select></label>
          {more && <button type="button" disabled={busy} onClick={() => void action(() => loadRepositories(installationId, page + 1))} className="text-xs underline">Carregar mais repositórios</button>}
          <button type="button" disabled={busy || !selectedRepository || (purpose === 'create' && !selectedRepository.canPush)} onClick={() => void useRepository()} className="rounded-lg bg-violet-700 px-3 py-2 text-xs disabled:opacity-50">{purpose === 'create' ? 'Usar este destino' : 'Conectar este projeto'}</button>
        </> : <p className="text-xs text-amber-200">Nenhuma instalação autorizada foi encontrada. Use Autorizar repositórios e atualize a conexão.</p>}
        {purpose === 'create' && <details><summary className="cursor-pointer text-xs">Criar um repositório na minha conta</summary><div className="mt-3 space-y-2">
          <input aria-label="Nome do novo repositório" value={newName} onChange={e => setNewName(e.target.value)} maxLength={100} className="w-full rounded-lg bg-slate-800 p-2 text-xs" />
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />Repositório privado</label>
          <button type="button" disabled={busy || !newName.trim()} onClick={() => void action(async () => {
            const result = await apiClient<{ repository: Repository }>('/api/github/repositories', { method: 'POST', body: JSON.stringify({ name: newName.trim(), private: isPrivate }) });
            setMessage(`Repositório ${result.repository.owner}/${result.repository.name} criado. Atualize a conexão e selecione o destino. Se não aparecer, use Autorizar repositórios.`);
            setNewName('');
          })} className="rounded-lg border border-white/25 px-3 py-2 text-xs disabled:opacity-50">Criar repositório</button>
        </div></details>}
      </> : status?.configured && <button type="button" disabled={busy} onClick={() => void authorize()} className="rounded-lg bg-violet-700 px-3 py-2 text-xs disabled:opacity-50">{status.reconnectRequired ? 'Reconectar GitHub' : 'Conectar GitHub'}</button>}
    </>}
    {error && <p role="alert" className="text-xs text-red-300">{error}<button type="button" className="ml-2 underline" onClick={() => { setError(''); setRefresh(value => value + 1); }}>Tentar novamente</button></p>}
    {message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
  </section>;
}
