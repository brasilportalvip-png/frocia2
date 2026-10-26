import React, { useState } from 'react';
import { Power, LoaderCircle } from 'lucide-react';

type Props = {
  enabled: boolean | null;
  getAuthHeader: () => Promise<Record<string, string>>;
  onChanged: () => Promise<void>;
};

export function AutomationControl({ enabled, getAuthHeader, onChanged }: Props) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [warning, setWarning] = useState(false);
  const [retryPause, setRetryPause] = useState(false);
  const change = async (next: boolean) => {
    setSaving(true); setNotice(''); setRetryPause(false);
    try {
      const response = await fetch('/api/admin/self-evolution/control/enabled', {
        method: 'POST', headers: { ...(await getAuthHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const receipt = await response.json();
      if (!response.ok) throw new Error(receipt.error || receipt.message || 'Não foi possível confirmar a alteração.');
      const incomplete = !receipt.workflowControl?.success || receipt.workflowControl?.cancellationIncomplete === true;
      setWarning(incomplete);
      setRetryPause(!next && incomplete);
      setNotice(receipt.message || 'Controle salvo.');
      await onChanged();
    } catch (error) {
      setWarning(true);
      setRetryPause(!next);
      setNotice(error instanceof Error ? error.message : 'Não foi possível confirmar a alteração.');
      // Uma falha de rede pode ocorrer depois de salvar. Releia o estado real.
      await onChanged();
    } finally { setSaving(false); }
  };
  return <section aria-labelledby="automation-control-title" className="rounded-2xl border border-cyan-400/25 bg-cyan-400/5 p-5 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h3 id="automation-control-title" className="font-bold">Autoevolução diária</h3>
        <p className="text-sm mt-1 text-white/70">{enabled === null ? 'Consultando estado…' : enabled ? 'Ligada — execução diária autorizada.' : 'Desligada — novas etapas de manutenção estão pausadas.'}</p>
      </div>
      <button type="button" role="switch" aria-label="Autoevolução diária" aria-checked={enabled === true}
        disabled={saving || enabled === null} onClick={() => void change(!enabled)}
        className={`flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-colors disabled:opacity-50 ${enabled ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-white/10 hover:bg-white/20'}`}>
        {saving ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
        {saving ? 'Salvando…' : enabled ? 'Desligar' : 'Ligar'}
      </button>
    </div>
    <p className="text-xs text-white/60">Ligada: permite a rodada diária e as retomadas, com consumo dos serviços utilizados. Desligar salva a pausa, desabilita o agendamento no GitHub e solicita o cancelamento das execuções existentes.</p>
    <p className="text-xs text-white/50">Ligar não inicia um teste imediatamente. Chamadas já enviadas a um provedor podem terminar e ser cobradas. Este controle não desliga o site, o chat nem os testes normais dos seus PRs.</p>
    {notice && <p role={warning ? 'alert' : 'status'} className={`text-sm ${warning ? 'text-amber-300' : 'text-emerald-300'}`}>{notice}</p>}
    {retryPause && <button type="button" disabled={saving} onClick={() => void change(false)} className="rounded-lg border border-amber-400/30 px-3 py-2 text-xs text-amber-200 disabled:opacity-50">Concluir desligamento no GitHub</button>}
  </section>;
}
