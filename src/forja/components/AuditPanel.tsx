import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { AuditCheck } from '../types';

interface AuditPanelProps {
  checks: AuditCheck[];
  hasFiles: boolean;
  isGenerating: boolean;
  onFixAuditIssues: (prompts: string[]) => void;
  onExportZip: () => void;
}

export const AuditPanel: React.FC<AuditPanelProps> = ({
  checks,
  hasFiles,
  isGenerating,
  onFixAuditIssues,
  onExportZip,
}) => {
  const passedCount = checks.filter((c) => c.status === 'pass').length;
  const issueChecks = checks.filter((c) => c.status !== 'pass' && c.fixPrompt);

  if (!hasFiles) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center bg-slate-50 dark:bg-[#0B0F17]">
        <div className="max-w-md space-y-2">
          <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto" />
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Auditoria de Produção
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Gere um site primeiro para executar a verificação automática de SEO, semântica, responsividade, interatividade e pacote de deploy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-slate-50 dark:bg-[#0B0F17] p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header Summary */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111723] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
              Verificação Real de Prontidão para Produção
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 tabular-nums">
              {passedCount} de {checks.length} critérios técnicos aprovados no código atual.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {issueChecks.length > 0 && (
              <button
                type="button"
                disabled={isGenerating}
                onClick={() =>
                  onFixAuditIssues(
                    issueChecks
                      .map((c) => c.fixPrompt)
                      .filter((p): p is string => Boolean(p))
                  )
                }
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Corrigir Pendências com IA</span>
              </button>
            )}

            <button
              type="button"
              onClick={onExportZip}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar ZIP</span>
            </button>
          </div>
        </div>

        {/* Deterministic Check List */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111723] divide-y divide-slate-200 dark:divide-slate-800 overflow-hidden">
          {checks.map((check) => {
            return (
              <div
                key={check.id}
                className="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {check.category}
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {check.title}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {check.description}
                  </p>
                  <p className="text-xs text-slate-700 dark:text-slate-300 pt-1">
                    {check.detail}
                  </p>
                </div>

                <div className="shrink-0 flex items-center gap-1.5 text-xs font-medium pt-0.5">
                  {check.status === 'pass' && (
                    <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Aprovado</span>
                    </span>
                  )}
                  {check.status === 'warn' && (
                    <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4" />
                      <span>Atenção</span>
                    </span>
                  )}
                  {check.status === 'fail' && (
                    <span className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                      <XCircle className="w-4 h-4" />
                      <span>Pendente</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
