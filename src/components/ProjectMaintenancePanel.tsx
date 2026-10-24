import React, { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';
interface Policy {
  revision: number; enabled: boolean; dailyCreditLimit: number;
  usedCredits: number; activeBuildId: string | null;
  lastResult: string | { buildId: string; status: string; consumedCredits: number } | null;
}
export function ProjectMaintenancePanel({ projectId }: { projectId: string }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const url = `/api/professional-factory/projects/${encodeURIComponent(projectId)}/maintenance`;
  useEffect(() => {
    const controller = new AbortController();
    setPolicy(null); setError(''); setSaved(false);
    apiClient<Policy>(url, { signal: controller.signal }).then(setPolicy).catch(e => {
      if (!controller.signal.aborted) setError(e.message || 'Não foi possível consultar a manutenção.');
    });
    return () => controller.abort();
  }, [url]);
  async function save() {
    if (!policy) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const result = await apiClient<Policy>(url, { method: 'PUT', body: JSON.stringify({
        revision: policy.revision, enabled: policy.enabled, dailyCreditLimit: policy.dailyCreditLimit,
      }) });
      setPolicy(result); setSaved(true);
    } catch (e: any) { setError(e.message || 'Não foi possível salvar a manutenção.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 text-sm text-slate-300" aria-label="Manutenção automática do projeto">
    <h3 className="font-semibold text-white">Manutenção após a publicação</h3>
    <p>A Froc acompanha a versão publicada e a saúde das integrações. Com sua autorização,
      falhas confirmadas em duas verificações iniciam uma correção pelos agentes, com revisão,
      testes, prévia e nova verificação de produção.</p>
    <p>Cada rodada pode usar até 95 créditos da sua conta e reaproveita a mídia já entregue.
      O limite diário abaixo controla novas rodadas. Uma rodada em andamento pode ser cancelada no painel de construção.</p>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {saved && <p role="status" className="text-emerald-300">Configuração de manutenção salva.</p>}
    {!policy && !error && <p role="status">Carregando configuração…</p>}
    {policy && <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={policy.enabled} onChange={e => { setSaved(false); setPolicy({ ...policy, enabled: e.target.checked }); }} />
        <span>Autorizar correções e republicação automáticas após os testes, dentro do limite de créditos.</span>
      </label>
      <label className="block space-y-2">Limite diário de créditos para manutenção
        <input type="number" min={95} max={9500} step={1} value={policy.dailyCreditLimit}
          onChange={e => { setSaved(false); setPolicy({ ...policy, dailyCreditLimit: Number(e.target.value) }); }}
          className="block w-full max-w-xs rounded-lg border border-white/20 bg-slate-900 p-2" />
      </label>
      <p>Créditos de manutenção contabilizados no dia: {policy.usedCredits || 0}.
        {policy.activeBuildId ? ' Há uma rodada autorizada em andamento.' : ' Nenhuma rodada em andamento.'}</p>
      {policy.lastResult && <p>Último estado: {typeof policy.lastResult === 'string' ? policy.lastResult : policy.lastResult.status}.</p>}
      <button type="button" onClick={save} disabled={busy || !Number.isInteger(policy.dailyCreditLimit) || policy.dailyCreditLimit < 95 || policy.dailyCreditLimit > 9500}
        className="rounded-lg bg-violet-700 px-4 py-2 font-semibold text-white hover:bg-violet-800 disabled:opacity-50">
        {busy ? 'Salvando…' : 'Salvar manutenção'}
      </button>
    </fieldset>}
  </section>;
}
