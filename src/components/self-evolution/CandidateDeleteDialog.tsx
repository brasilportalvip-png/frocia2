import React, { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../services/apiClient';

export function CandidateDeleteDialog({ candidate, onClose, onDeleted }: {
  candidate: { id: string; title: string }; onClose: () => void; onDeleted: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { requestRef.current?.abort(); dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const remove = async () => {
    setBusy(true); setError('');
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(() => {
      controller.abort();
      setError('A resposta demorou. Atualize a fila para conferir se a tarefa foi excluída antes de repetir.');
      setBusy(false);
    }, 20_000);
    try {
      await apiClient('/api/admin/self-evolution/candidates/' + encodeURIComponent(candidate.id), {
        method: 'DELETE', body: JSON.stringify({ confirmation: candidate.id }), signal: controller.signal,
      });
      if (!controller.signal.aborted) onDeleted(candidate.id);
    } catch (err) {
      setError(controller.signal.aborted
        ? 'A resposta demorou. Atualize a fila para conferir se a tarefa foi excluída antes de repetir.'
        : err instanceof Error ? err.message : 'Não foi possível excluir esta tarefa.');
    } finally { window.clearTimeout(timer); setBusy(false); }
  };
  return <dialog ref={dialogRef} aria-labelledby="delete-candidate-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-white/20 bg-slate-950 p-6 text-white backdrop:bg-black/80">
    <h2 id="delete-candidate-title" className="text-lg font-bold">Excluir tarefa da fila?</h2>
    <p className="mt-3">{candidate.title}</p>
    <p className="mt-2 break-all font-mono text-xs text-white/70">{candidate.id}</p>
    <p className="mt-3 text-sm text-white/80">Esta tarefa será retirada da fila de autoevolução. O histórico de auditoria será preservado.</p>
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
    <div className="mt-5 flex justify-end gap-3">
      <button type="button" autoFocus disabled={busy} onClick={onClose} className="rounded-lg bg-white/10 px-3 py-2">Cancelar</button>
      <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg bg-rose-600 px-3 py-2 font-bold">{busy ? 'Excluindo…' : 'Excluir tarefa'}</button>
    </div>
  </dialog>;
}
