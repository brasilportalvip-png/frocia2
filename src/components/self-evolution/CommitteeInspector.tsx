import React, { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../services/apiClient';
import { committeeLink } from '../../services/committeeNavigation';
import { parseCommitteeInspection, type CommitteeInspection } from '../../services/committeeInspection';

export interface CommitteeTarget { id: string; title: string; simulation?: boolean }

export function CommitteeInspector({ target, roleLabels, onClose }: {
  target: CommitteeTarget; roleLabels: Record<string, string>; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [committee, setCommittee] = useState<CommitteeInspection | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCommittee(null); setError(''); setBusy(true);
    const timer = window.setTimeout(() => {
      controller.abort();
      setError('A consulta demorou mais que o esperado. Tente novamente.');
      setBusy(false);
    }, 15_000);
    const endpoint = target.simulation
      ? '/api/admin/self-evolution/committee/simulation'
      : '/api/admin/self-evolution/committee/' + encodeURIComponent(target.id) + '/reviews';
    void apiClient<unknown>(endpoint, {
      method: target.simulation ? 'POST' : 'GET', signal: controller.signal,
    }).then(payload => {
      if (!controller.signal.aborted) setCommittee(parseCommitteeInspection(payload));
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Não foi possível consultar o comitê.');
    }).finally(() => {
      window.clearTimeout(timer);
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [target.id, target.simulation, attempt]);

  const shareUrl = !target.simulation ? committeeLink(window.location.href, target.id) : null;
  return (
    <dialog ref={dialogRef} aria-labelledby="committee-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      className="m-auto w-[min(64rem,calc(100vw-2rem))] max-h-[90dvh] overflow-y-auto rounded-2xl border border-cyan-400/30 bg-slate-950 p-5 text-white shadow-2xl backdrop:bg-black/80">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="committee-title" className="text-lg font-bold">Comitê de Agentes{target.simulation ? ' — Simulação Segura' : ''}</h2>
          <p className="mt-1 text-sm text-white/80">{target.title}</p>
          {!target.simulation && <p className="mt-1 break-all font-mono text-xs text-white/60">Tarefa: {target.id}</p>}
        </div>
        <button type="button" onClick={onClose} className="rounded-lg bg-white/10 px-3 py-2 text-sm">Fechar comitê</button>
      </div>
      {shareUrl && <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-cyan-300 underline">Abrir este comitê por link</a>}
      {busy && <p role="status" className="mt-5">Carregando pareceres desta tarefa…</p>}
      {error && (
        <div className="mt-5 space-y-3">
          <p role="alert" className="text-rose-200">{error}</p>
          <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded-lg bg-white/10 px-3 py-2">Tentar novamente</button>
        </div>
      )}
      {committee && (
        <section className="mt-5 space-y-4" aria-label="Inspeção do Comitê de Agentes">
          <p className="break-all font-mono text-xs text-white/70">Commit: {committee.commitSha || 'não informado'}</p>
          <p className={committee.gate.approved ? 'font-bold text-emerald-300' : 'font-bold text-amber-200'}>{committee.gate.status.toUpperCase()}</p>
          <p className="text-sm">{committee.gate.reason}</p>
          {committee.reviews.length === 0 && <p className="rounded-lg bg-white/5 p-3 text-sm">
            {committee.commitSha ? 'Nenhum parecer registrado para este commit.' : 'Esta tarefa ainda não tem um commit para revisão. Os pareceres aparecem quando a execução chegar à etapa do comitê.'}
          </p>}
          {committee.verifierControl && <p className="text-sm text-emerald-200">Controle independente: sem o verificador, o gate ficou {committee.verifierControl.status} — {committee.verifierControl.reason}</p>}
          <div className="grid gap-3 lg:grid-cols-2">
            {committee.reviews.map((review, index) => (
              <article key={review.id || index} className="space-y-2 rounded-xl border border-white/15 p-4">
                <h3 className="font-bold">{roleLabels[review.role] || review.role}</h3>
                <p className={review.verdict === 'approved' ? 'font-bold text-emerald-300' : 'font-bold text-amber-200'}>{review.verdict.toUpperCase()}</p>
                <p className="text-sm">{review.summary}</p>
                <p className="break-all text-xs text-white/70">Identidade: {review.actorUid}</p>
                <p className="break-all text-xs text-white/70">Arquivos: {review.fileRefs.join(', ') || 'nenhum'}</p>
                <p className="break-all text-xs text-white/70">Testes: {review.testRefs.join(', ') || 'nenhum'}</p>
                <p className="break-all text-xs text-white/70">Evidências: {review.evidenceRefs.join(', ') || 'nenhuma'}</p>
                <p className="break-all text-xs text-amber-200">Riscos: {review.risks.join(', ') || 'nenhum registrado'}</p>
              </article>
            ))}
          </div>
          {committee.sideEffects && <p className="text-xs text-white/70">Efeitos: {committee.sideEffects.credits} créditos · {committee.sideEffects.aiCalls} IA · {committee.sideEffects.pullRequests} PRs · {committee.sideEffects.deployments} deploys</p>}
        </section>
      )}
    </dialog>
  );
}
