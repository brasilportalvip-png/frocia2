import React, { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';
export function DevelopmentAdminControl() {
  const [enabled, setEnabled] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { void apiClient<any>('/api/development/control').then(value => setEnabled(value.enabled)).catch(error => setMessage(error.message)); }, []);
  return <details className="rounded-lg border border-amber-500/30 p-3 text-xs"><summary className="cursor-pointer">Administrador: controle global do editor</summary>
    <p className="my-2">{enabled === null ? 'Estado não confirmado.' : enabled ? 'Desenvolvimento habilitado.' : 'Desenvolvimento pausado.'} Os controles de cada projeto permanecem independentes.</p>
    <button type="button" disabled={busy || enabled === null} className="rounded-lg border px-3 py-2 disabled:opacity-40" onClick={() => {
      setBusy(true); void apiClient<any>('/api/development/control', { method: 'PUT', body: JSON.stringify({ enabled: !enabled }) })
        .then(result => { setEnabled(result.enabled); setMessage(result.message); }).catch(error => setMessage(error.message)).finally(() => setBusy(false));
    }}>{enabled ? 'Pausar editor em todos os projetos' : 'Habilitar e retomar pedidos autorizados'}</button>
    {message && <p role="status" className="mt-2">{message}</p>}
  </details>;
}
