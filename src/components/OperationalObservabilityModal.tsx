import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Coins,
  RefreshCw,
  ServerCrash,
  X,
} from 'lucide-react';
import { apiClient } from '../services/apiClient';

interface MetricValue {
  status: 'available' | 'absent';
  value: number | null;
  unit: 'count' | 'ms' | 'ratio' | 'tokens' | 'micros' | 'credits' | 'score';
  sampleCount: number;
}

interface OperationalSnapshot {
  window: { start: string; end: string; durationMinutes: number };
  metrics: Record<string, MetricValue>;
  costBreakdown: Array<{
    tenantId: string | null;
    userId: string | null;
    resource: string;
    costMicros: number;
    costCredits: number;
    samples: number;
  }>;
  truncated: boolean;
}

interface OperationalAlert {
  alertId: string;
  code: string;
  severity: 'warning' | 'critical';
  metric: string;
  observedValue: number;
  threshold: number;
  runbook: string;
  createdAt: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function formatMetric(metric: MetricValue | undefined): string {
  if (!metric || metric.status === 'absent' || metric.value === null) {
    return 'Sem dados';
  }
  if (metric.unit === 'ratio') return `${(metric.value * 100).toFixed(1)}%`;
  if (metric.unit === 'ms') return `${Math.round(metric.value)} ms`;
  if (metric.unit === 'credits') return `${metric.value.toFixed(1)} cr`;
  if (metric.unit === 'score') return metric.value.toFixed(2);
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(
    metric.value
  );
}

export const OperationalObservabilityModal: React.FC<Props> = ({
  isOpen,
  onClose,
}) => {
  const [snapshot, setSnapshot] = useState<OperationalSnapshot | null>(null);
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient<{
        snapshot: OperationalSnapshot;
        alerts: OperationalAlert[];
      }>('/api/admin/observability/snapshot?durationMinutes=60');
      setSnapshot(response.snapshot);
      setAlerts(response.alerts);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar a observabilidade.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const cards = [
    ['Latência P95', 'latencyP95', Clock3],
    ['Taxa de erro', 'errorRate', ServerCrash],
    ['Disponibilidade', 'availability', CheckCircle2],
    ['Tokens de entrada', 'inputTokens', Activity],
    ['Custo em créditos', 'totalCostCredits', Coins],
    ['Taxa de retry', 'retryRate', RefreshCw],
    ['Jobs presos', 'stuckJobs', AlertTriangle],
    ['Falhas de deploy', 'deploymentFailures', ServerCrash],
  ] as const;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-slate-950/85 backdrop-blur-md p-3 sm:p-6 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="operational-observability-title"
    >
      <div className="w-full max-w-6xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] overflow-hidden rounded-3xl border border-white/15 bg-slate-950 shadow-2xl flex flex-col">
        <header className="shrink-0 flex items-start justify-between gap-4 p-5 border-b border-white/10">
          <div>
            <h2
              id="operational-observability-title"
              className="text-xl font-black text-white"
            >
              Observabilidade operacional
            </h2>
            <p className="mt-1 text-xs text-white/55">
              Janela real de 60 minutos. Métricas sem amostras aparecem como “Sem dados”.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="p-2.5 rounded-xl border border-white/10 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-50"
              aria-label="Atualizar métricas"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2.5 rounded-xl border border-white/10 text-white/70 hover:text-white hover:bg-white/10"
              aria-label="Fechar observabilidade"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {error && (
            <div className="mb-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map(([label, key, Icon]) => {
              const metric = snapshot?.metrics[key];
              const absent = !metric || metric.status === 'absent';
              return (
                <section
                  key={key}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <div className="flex items-center justify-between gap-3 text-xs text-white/55">
                    <span>{label}</span>
                    <Icon className="w-4 h-4 text-cyan-300" />
                  </div>
                  <div className={`mt-3 text-2xl font-black ${absent ? 'text-white/45' : 'text-white'}`}>
                    {loading && !snapshot ? 'Carregando…' : formatMetric(metric)}
                  </div>
                  <div className="mt-1 text-[10px] text-white/40">
                    {metric?.sampleCount
                      ? `${metric.sampleCount} amostra(s)`
                      : 'Nenhuma amostra observada'}
                  </div>
                </section>
              );
            })}
          </div>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <h3 className="text-sm font-bold text-white">Alertas ativos</h3>
              <div className="mt-3 space-y-2">
                {alerts.length === 0 ? (
                  <p className="text-xs text-white/45">
                    Nenhum limite observado foi violado nesta consulta.
                  </p>
                ) : (
                  alerts.map((alert) => (
                    <div
                      key={alert.alertId}
                      className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs"
                    >
                      <div className="font-bold text-rose-200">{alert.code}</div>
                      <div className="mt-1 text-white/60">
                        Observado {alert.observedValue.toFixed(3)} · limite {alert.threshold}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-white/40 break-all">
                        {alert.runbook}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <h3 className="text-sm font-bold text-white">Custo por recurso</h3>
              <div className="mt-3 space-y-2">
                {!snapshot || snapshot.costBreakdown.length === 0 ? (
                  <p className="text-xs text-white/45">Sem custo observado na janela.</p>
                ) : (
                  snapshot.costBreakdown.slice(0, 10).map((item, index) => (
                    <div
                      key={`${item.resource}-${item.userId}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-xl bg-black/20 p-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-white/80">{item.resource}</div>
                        <div className="truncate text-[10px] text-white/35">
                          {item.tenantId || 'sem tenant'} · {item.userId || 'sem usuário'}
                        </div>
                      </div>
                      <div className="shrink-0 font-bold text-amber-300">
                        {item.costCredits > 0
                          ? `${item.costCredits.toFixed(1)} cr`
                          : `${item.costMicros} µ`}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
