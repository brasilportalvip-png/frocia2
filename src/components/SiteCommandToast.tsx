import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, HelpCircle, Mic, X } from 'lucide-react';
import { onSiteCommandOutcome, type SiteCommandOutcome } from '../services/siteCommandBus';

/** Recibo visual de cada comando executado pela voz (ou texto). */
export const SiteCommandToast: React.FC = () => {
  const [outcome, setOutcome] = useState<SiteCommandOutcome | null>(null);

  useEffect(() => onSiteCommandOutcome(setOutcome), []);

  useEffect(() => {
    if (!outcome || outcome.details || outcome.needsConfirmation) return;
    const timer = window.setTimeout(() => setOutcome(null), 6000);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  if (!outcome) return null;

  const Icon = outcome.needsConfirmation ? HelpCircle : outcome.ok ? CheckCircle2 : AlertTriangle;
  const tone = outcome.needsConfirmation
    ? 'border-amber-400/50 text-amber-100'
    : outcome.ok
      ? 'border-emerald-400/40 text-emerald-50'
      : 'border-rose-400/50 text-rose-100';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="site-command-toast"
      className={`fixed bottom-24 left-1/2 z-[80] w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border bg-[#0b0b0d]/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl ${tone}`}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/45">
            <Mic className="h-3 w-3" /> Comando do site{outcome.source === 'ai' ? ' · interpretado pela IA' : ''}
          </p>
          <p className="mt-1 text-sm font-semibold">{outcome.message}</p>
          {outcome.details && (
            <pre className="mt-2 max-h-[45vh] overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-white/75">
              {outcome.details}
            </pre>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOutcome(null)}
          className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="Fechar aviso do comando"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
