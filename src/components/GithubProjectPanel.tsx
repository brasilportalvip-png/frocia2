import React, { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';
import { GithubConnectionPanel } from './GithubConnectionPanel';

export function GithubProjectPanel({ projectId }: { projectId: string }) {
  const [snapshot, setSnapshot] = useState<{ branch: string; commitSha: string; repositoryUrl: string; files: Array<{ path: string; size: number }> } | null>(null);
  const [filter, setFilter] = useState(''), [content, setContent] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    window.addEventListener('froc:github-connection-updated', update);
    return () => window.removeEventListener('froc:github-connection-updated', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null); setContent(null); setError(''); setBusy(true);
    void apiClient<any>(`/api/github/projects/${encodeURIComponent(projectId)}/tree`, { signal: controller.signal })
      .then(setSnapshot).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [projectId, revision]);
  async function open(path: string) {
    if (!snapshot) return;
    setBusy(true); setError('');
    try { setContent(await apiClient(`/api/github/projects/${encodeURIComponent(projectId)}/file?${new URLSearchParams({ path, ref: snapshot.commitSha })}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 text-sm text-slate-200">
    <GithubConnectionPanel projectId={projectId} />
    {busy && <p role="status">Consultando arquivos…</p>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {snapshot && <>
      <a href={snapshot.repositoryUrl} target="_blank" rel="noopener noreferrer" className="underline">Abrir repositório no GitHub</a>
      <p>Árvore completa: {snapshot.files.length} arquivos · branch {snapshot.branch} · versão {snapshot.commitSha.slice(0, 12)}.</p>
      <p className="text-xs text-slate-400">Os arquivos continuam no repositório original. A lista completa não significa que todo o conteúdo foi anexado ao chat. A edição automatizada deste código ainda depende de um executor dedicado; esta conexão permite consultar o repositório e preserva a instalação existente.</p>
      <input aria-label="Filtrar arquivos do repositório" value={filter} onChange={e => setFilter(e.target.value)} className="w-full rounded-lg bg-slate-800 p-2" />
      <ul className="max-h-64 space-y-1 overflow-y-auto">{snapshot.files.filter(file => file.path.toLowerCase().includes(filter.toLowerCase())).map(file => <li key={file.path}><button type="button" disabled={busy} onClick={() => void open(file.path)} className="break-all rounded px-2 py-1 text-left text-xs underline">{file.path}</button></li>)}</ul>
      {content && <div><h3 className="font-semibold">{content.path}</h3><pre className="max-h-96 overflow-auto rounded-lg bg-black/40 p-3 text-xs">{content.content}</pre></div>}
    </>}
  </section>;
}
