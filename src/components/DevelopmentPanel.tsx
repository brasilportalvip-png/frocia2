import React, { useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/apiClient';
import { loadDevelopmentArtifact, saveDevelopmentArtifact } from '../services/development';
import { GithubConnectionPanel } from './GithubConnectionPanel';
const states: Record<string, string> = { importing: 'Importando', imported: 'Origem integral disponível', awaiting_dispatch: 'Pedido persistido', awaiting_runner: 'Dispatch aceito; aguardando executor',
  running: 'Analisando', analyzing: 'Analisando', editing: 'Editando arquivos', validating: 'Executando validações', ready: 'Versão validada e prévia pronta', validated: 'Código validado; prévia pendente', blocked: 'Bloqueado', paused: 'Pausado', cancelling: 'Cancelando', cancelled: 'Cancelado' };
export function DevelopmentPanel({ workspaceId, initialInstruction = '', onClose }: { workspaceId: string; initialInstruction?: string; onClose(): void }) {
  const [workspace, setWorkspace] = useState<any>(null), [job, setJob] = useState<any>(null), [manifest, setManifest] = useState<any>(null);
  const [instruction, setInstruction] = useState(initialInstruction), [budget, setBudget] = useState(50), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [fileText, setFileText] = useState(''), [filter, setFilter] = useState(''), [preview, setPreview] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const revisionRef = useRef('');
  const base = `/api/development/workspaces/${encodeURIComponent(workspaceId)}`;
  const refresh = async () => {
    const ws = (await apiClient<any>(base)).workspace; setWorkspace(ws);
    if (ws.activeJobId || ws.lastJobId) setJob((await apiClient<any>(`/api/development/jobs/${ws.activeJobId || ws.lastJobId}`)).job);
    if (ws.revision && ws.revision !== revisionRef.current) { setManifest(await apiClient(base + '/manifest')); revisionRef.current = ws.revision; }
  };
  useEffect(() => { let active = true;
    const load = async () => { try { if (active) await refresh(); } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Consulta indisponível.'); } };
    void load(); const timer = setInterval(() => void load(), 5000); return () => { active = false; clearInterval(timer); };
  }, [workspaceId]);
  const action = async (operation: () => Promise<void>) => { setBusy(true); setError(''); try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : 'Operação não concluída.'); } finally { setBusy(false); } };
  return <div role="dialog" aria-modal="true" aria-label="Desenvolvimento do projeto existente" className="fixed inset-0 z-[90] overflow-auto bg-black/95 p-4 text-white">
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-bold">{workspace?.title || 'Projeto existente'}</h1><button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-xs">Fechar</button></div>
      <p role="status" className="text-sm text-violet-200">{states[job?.status || workspace?.status] || 'Consultando estado persistido…'}</p>
      {workspace?.source?.commitSha && <p className="break-all text-xs text-slate-300">Origem: {workspace.source.url} · commit {workspace.source.commitSha}</p>}
      {manifest && <p className="break-all text-xs">{manifest.fileCount} arquivos · {manifest.bytes} bytes · SHA-256 da árvore: {manifest.digest}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-950 p-3 text-sm">{error}</p>}
      {job?.diagnostic && <p className="rounded-lg border border-amber-700 p-3 text-xs">{job.diagnostic}</p>}
      <div className="flex flex-wrap gap-2 text-xs">
        <button disabled={busy || !workspace?.revision} onClick={() => void action(async () => saveDevelopmentArtifact(await loadDevelopmentArtifact(base + '/export'), `${workspace.title}-completo.zip`, 'application/zip'))} className="rounded-lg border px-3 py-2 disabled:opacity-40">Baixar ZIP completo da versão atual</button>
        <button disabled={busy || !workspace} onClick={() => void action(async () => { await apiClient(base + '/pause', { method: 'PUT', body: JSON.stringify({ paused: !workspace.paused }) }); await refresh(); })} className="rounded-lg border px-3 py-2">{workspace?.paused ? 'Habilitar projeto' : 'Pausar projeto'}</button>
        {job && !['ready', 'validated', 'cancelled'].includes(job.status) && <>
          <button disabled={busy} onClick={() => void action(async () => { setJob((await apiClient<any>(`/api/development/jobs/${job.id}/resume`, { method: 'POST', body: '{}' })).job); })} className="rounded-lg border px-3 py-2">Retomar pedido autorizado</button>
          <button disabled={busy} onClick={() => void action(async () => { setJob((await apiClient<any>(`/api/development/jobs/${job.id}/cancel`, { method: 'POST', body: '{}' })).job); })} className="rounded-lg border px-3 py-2">Cancelar execução</button>
        </>}
        {job?.commandLog && <button disabled={busy} onClick={() => void action(async () => saveDevelopmentArtifact(await loadDevelopmentArtifact(`/api/development/jobs/${job.id}/logs`), 'validacoes.json', 'application/json'))} className="rounded-lg border px-3 py-2">Baixar logs e exit codes</button>}
        {job?.diffBlob && <button disabled={busy} onClick={() => void action(async () => saveDevelopmentArtifact(await loadDevelopmentArtifact(`/api/development/jobs/${job.id}/diff`), 'alteracoes.patch', 'text/plain'))} className="rounded-lg border px-3 py-2">Baixar diff real</button>}
        {job?.previewHtml && <button disabled={busy} onClick={() => void action(async () => { const bytes = await loadDevelopmentArtifact(`/api/development/jobs/${job.id}/preview`); setPreview(new TextDecoder().decode(bytes)); })} className="rounded-lg border px-3 py-2">Abrir prévia isolada</button>}
      </div>
      {job?.runUrl && <a href={job.runUrl} target="_blank" rel="noopener noreferrer" className="block text-xs underline">Acompanhar execução registrada no GitHub Actions</a>}
      {job?.previewDiagnostic && <p className="text-xs text-amber-200">{job.previewDiagnostic}</p>}
      {job?.checks?.length > 0 && <ul className="space-y-1 text-xs">{job.checks.map((check: any) => <li key={check.command}>{check.command}: exit {check.exitCode} · {check.durationMs} ms · stdout SHA-256 {check.stdoutSha256}</li>)}</ul>}
      {job?.changes?.length > 0 && <ul className="text-xs">{job.changes.map((change: any) => <li key={change.path}>{change.operation}: {change.path}</li>)}</ul>}
      {workspace?.source?.kind === 'github' && job && ['ready', 'validated'].includes(job.status) && <details className="space-y-3 rounded-xl border border-white/20 p-3"><summary className="cursor-pointer text-sm">Entrega por GitHub (opcional)</summary>
        <p className="text-xs">Conecte o mesmo repositório de origem para autorizar uma branch e PR em rascunho. O ZIP está disponível independentemente dessa conexão.</p>
        <GithubConnectionPanel projectId={workspaceId} />
        <button disabled={busy} onClick={() => void action(async () => {
          const result = await apiClient<any>(`/api/development/jobs/${job.id}/pull-request`, { method: 'POST', body: JSON.stringify({ humanConfirmed: true }) });
          setJob({ ...job, githubDelivery: result.delivery });
        })} className="rounded-lg bg-violet-700 px-3 py-2 text-xs">Autorizar criação de branch e PR</button>
        {job.githubDelivery?.pullRequestUrl && <a className="block text-xs underline" href={job.githubDelivery.pullRequestUrl} target="_blank" rel="noopener noreferrer">Abrir PR criada</a>}
      </details>}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-2 rounded-xl border border-white/15 p-3"><h2 className="font-semibold">Arquivos originais e alterações</h2>
          <input aria-label="Filtrar arquivos do workspace" value={filter} onChange={e => setFilter(e.target.value)} className="w-full rounded bg-slate-800 p-2 text-xs" placeholder="Buscar caminho…" />
          <div className="max-h-64 overflow-auto">{manifest?.files?.filter((file: any) => file.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 500).map((file: any) => <button type="button" key={file.path} disabled={busy || file.protected} onClick={() => void action(async () => {
            const result = await apiClient<any>(base + '/file?path=' + encodeURIComponent(file.path)); const bytes = Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
            try { setFileText(`${result.path}\nSHA-256: ${result.sha256}\n\n${new TextDecoder('utf-8', { fatal: true }).decode(bytes)}`); } catch { setFileText(`${result.path}: arquivo binário preservado (${result.size} bytes).`); }
          })} className="block w-full truncate px-2 py-1 text-left text-xs disabled:text-slate-500">{file.path} · {file.size} bytes{file.protected ? ' · credencial protegida' : ''}</button>)}</div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-3 text-[11px]">{fileText || 'Selecione um arquivo para consultar os bytes da versão persistida.'}</pre>
        </section>
        <section className="space-y-3 rounded-xl border border-white/15 p-3"><h2 className="font-semibold">Alterar este projeto</h2>
          <textarea aria-label="Instrução de desenvolvimento" value={instruction} onChange={e => { setInstruction(e.target.value); setRequestKey(crypto.randomUUID()); setConfirmed(false); }} rows={6} className="w-full rounded bg-slate-800 p-2 text-sm" placeholder="Descreva a alteração no código existente…" />
          <label className="block text-xs">Limite total de créditos <input type="number" min={1} max={50} value={budget} onChange={e => { setBudget(Number(e.target.value)); setConfirmed(false); setRequestKey(crypto.randomUUID()); }} className="ml-2 w-20 rounded bg-slate-800 p-2" /></label>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Autorizo executar esta instrução até o limite informado. A entrega será por arquivos e prévia, com publicação separada.</label>
          <button type="button" disabled={busy || !confirmed || !instruction.trim() || workspace?.paused} onClick={() => void action(async () => {
            const result = await apiClient<any>(base + '/jobs', { method: 'POST', body: JSON.stringify({ instruction, authorizedCredits: budget, idempotencyKey: requestKey }) }); setJob(result.job); await refresh();
          })} className="rounded-lg bg-violet-700 px-3 py-2 text-sm disabled:opacity-40">Confirmar desenvolvimento</button>
          {job && <p className="text-xs text-slate-300">Tarefa: {job.id} · Consumo registrado: {job.consumedCredits || 0}/{job.authorizedCredits} créditos.</p>}
        </section>
      </div>
      {preview && <section><p className="mb-2 text-xs text-amber-200">Prévia do frontend isolada. Integrações externas estão bloqueadas para preservar dados e credenciais.</p><iframe title="Prévia funcional do projeto importado" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview} className="h-[70vh] w-full rounded-xl border bg-white" /></section>}
    </div>
  </div>;
}
