import React, { useState } from 'react';
import { zipSync, type Zippable } from 'fflate';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../services/apiClient';
import { openDevelopmentWorkspace, uploadProjectZip } from '../services/development';
import { requestGithubLogin } from '../services/githubConnection';
import { DevelopmentAdminControl } from './DevelopmentAdminControl';

export function DevelopmentImporter({ onImported }: { onImported?: () => void }) {
  const { user, isAdmin } = useAuth(); const [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState('');
  const run = async (operation: () => Promise<any>) => {
    if (!user) { requestGithubLogin(); return; }
    setBusy(true); setError('');
    try { const ws = await operation(); openDevelopmentWorkspace(ws.id); onImported?.(); }
    catch (error) { setError(error instanceof Error ? error.message : 'A importação não foi concluída.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Importação integral do projeto" className="space-y-3 rounded-xl border border-violet-500/40 bg-slate-950 p-4 text-white">
    <h2 className="font-semibold">Importar projeto completo</h2>
    <p className="text-xs text-slate-300">Repositório público, ZIP ou pasta: código e assets originais em um workspace privado. A importação pública não exige instalar GitHub App.</p>
    <input aria-label="Repositório público para desenvolvimento" type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/conta/repositorio" disabled={busy} className="w-full rounded-lg bg-slate-800 p-2 text-sm" />
    <button type="button" disabled={busy || !url.trim()} onClick={() => void run(async () => {
      setProgress('Importando arquivos e verificando integridade…');
      return (await apiClient<any>('/api/development/imports/github', { method: 'POST', body: JSON.stringify({ url }) })).workspace;
    })} className="rounded-lg bg-violet-700 px-3 py-2 text-xs disabled:opacity-40">Importar do GitHub público</button>
    <div className="flex flex-wrap gap-3 text-xs">
      <label className="cursor-pointer rounded-lg border border-white/25 px-3 py-2">Importar ZIP<input aria-label="Importar ZIP completo" type="file" accept=".zip,application/zip" disabled={busy} className="sr-only" onChange={event => {
        const file = event.target.files?.[0]; if (file) void run(() => uploadProjectZip(file, setProgress)); event.target.value = '';
      }} /></label>
      <label className="cursor-pointer rounded-lg border border-white/25 px-3 py-2">Importar pasta<input aria-label="Importar pasta completa" type="file" multiple {...({ webkitdirectory: '' } as any)} disabled={busy} className="sr-only" onChange={event => {
        const files = Array.from(event.target.files || []); event.target.value = '';
        if (files.length) void run(async () => {
          if (files.length > 20_000 || files.reduce((sum, file) => sum + file.size, 0) > 250 * 1024 * 1024 || files.some(file => file.size > 20 * 1024 * 1024)) throw new Error('A pasta excede a quota de 20 mil arquivos, 250 MiB totais ou 20 MiB por arquivo.');
          const zip: Zippable = Object.create(null); setProgress('Preparando a pasta com arquivos originais…');
          for (const file of files) {
            const relative = file.webkitRelativePath.split('/').slice(1).join('/');
            if (!relative || relative.split('/').some(p => p === '..' || p === '.git' || p === 'node_modules')) throw new Error('Selecione uma pasta de código sem .git ou node_modules. Nenhum arquivo foi removido silenciosamente.');
            zip[relative] = new Uint8Array(await file.arrayBuffer());
          }
          return uploadProjectZip(new File([zipSync(zip).slice().buffer], 'projeto.zip', { type: 'application/zip' }), setProgress);
        });
      }} /></label>
    </div>
    {busy && <p role="status" className="text-xs text-violet-200">{progress}</p>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    {isAdmin && <DevelopmentAdminControl />}
  </section>;
}
