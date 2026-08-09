import React, {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
  Zap
} from 'lucide-react';
import { apiClient } from '../services/apiClient';

type ExecutionStatus =
  | 'created'
  | 'running'
  | 'waiting_tool'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface FirestoreTimestampLike {
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
}

interface ExecutionTrace {
  executionId: string;
  userId: string;
  conversationId: string | null;
  projectId: string | null;
  mode: string;
  selectedModel: string;
  fallbackModels: string[];
  attemptedModels: string[];
  status: ExecutionStatus;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  estimatedCredits: number;
  consumedCredits: number | null;
  reservationId: string;
  latencyMs: number | null;
  fallbackUsed: boolean;
  correlationId: string;
  errorCode: string | null;
  createdAt: string | FirestoreTimestampLike;
  startedAt: string | null;
  completedAt: string | null;
}

interface ExecutionTracesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STATUS_LABELS: Record<ExecutionStatus, string> = {
  created: 'Criada',
  running: 'Executando',
  waiting_tool: 'Aguardando ferramenta',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada'
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Não foi possível carregar as execuções.';
}

function timestampToDate(
  value: string | FirestoreTimestampLike | null | undefined
): Date | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const seconds =
    typeof value.seconds === 'number'
      ? value.seconds
      : value._seconds;

  if (typeof seconds !== 'number') {
    return null;
  }

  return new Date(seconds * 1000);
}

function formatDate(
  value: string | FirestoreTimestampLike | null | undefined
): string {
  const date = timestampToDate(value);
  return date ? date.toLocaleString('pt-BR') : 'Não informado';
}

function formatNumber(value: number | null | undefined): string {
  return typeof value === 'number'
    ? value.toLocaleString('pt-BR')
    : '—';
}

function statusStyle(status: ExecutionStatus): string {
  if (status === 'completed') {
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300';
  }

  if (status === 'failed' || status === 'cancelled') {
    return 'border-red-400/25 bg-red-500/10 text-red-300';
  }

  return 'border-amber-400/25 bg-amber-500/10 text-amber-300';
}

export const ExecutionTracesModal: React.FC<
  ExecutionTracesModalProps
> = ({ isOpen, onClose }) => {
  const [traces, setTraces] = useState<ExecutionTrace[]>([]);
  const [selectedTraceId, setSelectedTraceId] =
    useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<'all' | ExecutionStatus>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedTrace = useMemo(
    () =>
      traces.find(
        (trace) => trace.executionId === selectedTraceId
      ) ?? null,
    [traces, selectedTraceId]
  );

  const filteredTraces = useMemo(() => {
    const query = search.trim().toLowerCase();

    return traces.filter((trace) => {
      if (
        statusFilter !== 'all' &&
        trace.status !== statusFilter
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        trace.executionId,
        trace.userId,
        trace.projectId ?? '',
        trace.conversationId ?? '',
        trace.selectedModel,
        trace.mode,
        trace.correlationId,
        trace.errorCode ?? ''
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [traces, search, statusFilter]);

  const metrics = useMemo(() => {
    const completed = traces.filter(
      (trace) => trace.status === 'completed'
    ).length;
    const failed = traces.filter(
      (trace) => trace.status === 'failed'
    ).length;
    const withLatency = traces.filter(
      (trace) => typeof trace.latencyMs === 'number'
    );
    const averageLatency = withLatency.length
      ? withLatency.reduce(
          (sum, trace) => sum + (trace.latencyMs ?? 0),
          0
        ) / withLatency.length
      : 0;
    const consumedCredits = traces.reduce(
      (sum, trace) => sum + (trace.consumedCredits ?? 0),
      0
    );

    return {
      total: traces.length,
      completed,
      failed,
      averageLatency,
      consumedCredits,
      fallbackCount: traces.filter(
        (trace) => trace.fallbackUsed
      ).length
    };
  }, [traces]);

  const loadTraces = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await apiClient<{
        executions: ExecutionTrace[];
      }>('/api/admin/ai/executions');
      const nextTraces = Array.isArray(response.executions)
        ? response.executions
        : [];

      setTraces(nextTraces);
      setSelectedTraceId((current) =>
        nextTraces.some(
          (trace) => trace.executionId === current
        )
          ? current
          : nextTraces[0]?.executionId ?? ''
      );
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadTraces();
    }
  }, [isOpen, loadTraces]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 text-white backdrop-blur-xl">
      <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-amber-400/20 bg-[#070707] shadow-[0_0_70px_rgba(245,158,11,0.10)]">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-black/70 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold">
                Rastreamento Real de Execuções
              </h3>
              <p className="text-xs text-white/45">
                Tokens, créditos, modelos, latência, falhas e fallback
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadTraces()}
              disabled={isLoading}
              className="rounded-xl border border-white/10 p-2 text-white/60 transition hover:border-amber-400/30 hover:text-amber-300 disabled:opacity-40"
              title="Atualizar registros"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  isLoading ? 'animate-spin' : ''
                }`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 p-2 text-white/60 transition hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {error && (
          <div className="mx-4 mt-4 flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 border-b border-white/10 p-4 md:grid-cols-3 lg:grid-cols-6">
          <Metric label="Execuções" value={formatNumber(metrics.total)} />
          <Metric label="Concluídas" value={formatNumber(metrics.completed)} tone="success" />
          <Metric label="Falhas" value={formatNumber(metrics.failed)} tone={metrics.failed ? 'danger' : 'default'} />
          <Metric label="Latência média" value={`${Math.round(metrics.averageLatency)} ms`} />
          <Metric label="Créditos usados" value={formatNumber(metrics.consumedCredits)} />
          <Metric label="Fallbacks" value={formatNumber(metrics.fallbackCount)} />
        </section>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex w-80 shrink-0 flex-col border-r border-white/10 bg-black/35 p-4">
            <div className="space-y-2 pb-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-white/35" />
                <input
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="ID, usuário, modelo, projeto..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-xs outline-none focus:border-amber-400/40"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as
                      | 'all'
                      | ExecutionStatus
                  )
                }
                className="w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-xs text-white outline-none focus:border-amber-400/40"
              >
                <option value="all">Todos os status</option>
                {Object.entries(STATUS_LABELS).map(
                  ([status, label]) => (
                    <option key={status} value={status}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </div>

            <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto">
              {isLoading && traces.length === 0 ? (
                <div className="flex h-36 items-center justify-center text-xs text-white/40">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Carregando...
                </div>
              ) : filteredTraces.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs text-white/40">
                  Nenhuma execução real encontrada.
                </div>
              ) : (
                filteredTraces.map((trace) => (
                  <button
                    type="button"
                    key={trace.executionId}
                    onClick={() =>
                      setSelectedTraceId(trace.executionId)
                    }
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      selectedTraceId === trace.executionId
                        ? 'border-amber-400/35 bg-amber-400/10'
                        : 'border-white/5 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate font-mono text-amber-300">
                        {trace.executionId}
                      </span>
                      <span className="shrink-0 text-white/35">
                        {formatNumber(trace.latencyMs)} ms
                      </span>
                    </div>
                    <div className="truncate text-xs font-bold">
                      {trace.mode || 'Modo não informado'}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] text-white/35">
                        {trace.selectedModel || 'Modelo não informado'}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusStyle(trace.status)}`}>
                        {STATUS_LABELS[trace.status] ?? trace.status}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <main className="custom-scrollbar flex-1 overflow-y-auto bg-[#090909] p-6">
            {selectedTrace ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
                  <div>
                    <h2 className="font-mono text-sm font-black text-amber-300">
                      {selectedTrace.executionId}
                    </h2>
                    <p className="mt-1 text-xs text-white/40">
                      Criada em {formatDate(selectedTrace.createdAt)}
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusStyle(selectedTrace.status)}`}>
                    {STATUS_LABELS[selectedTrace.status] ?? selectedTrace.status}
                  </span>
                </div>

                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <InfoCard icon={<Cpu />} label="Modelo selecionado" value={selectedTrace.selectedModel} />
                  <InfoCard icon={<Clock3 />} label="Latência" value={`${formatNumber(selectedTrace.latencyMs)} ms`} />
                  <InfoCard icon={<Zap />} label="Créditos consumidos" value={formatNumber(selectedTrace.consumedCredits)} />
                  <InfoCard icon={<Database />} label="Versão do prompt" value={selectedTrace.promptVersion || 'Não informada'} />
                </section>

                <section className="grid gap-3 sm:grid-cols-3">
                  <TokenCard label="Tokens de entrada" value={selectedTrace.inputTokens} />
                  <TokenCard label="Tokens de saída" value={selectedTrace.outputTokens} />
                  <TokenCard label="Tokens em cache" value={selectedTrace.cachedTokens} />
                </section>

                <section className="grid gap-4 lg:grid-cols-2">
                  <Detail label="Usuário" value={selectedTrace.userId} />
                  <Detail label="Modo" value={selectedTrace.mode} />
                  <Detail label="Projeto" value={selectedTrace.projectId ?? 'Sem projeto vinculado'} />
                  <Detail label="Conversa" value={selectedTrace.conversationId ?? 'Sem conversa vinculada'} />
                  <Detail label="Reserva de créditos" value={selectedTrace.reservationId} />
                  <Detail label="Correlation ID" value={selectedTrace.correlationId} />
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <span className="text-[10px] font-bold uppercase text-white/35">
                    Caminho dos modelos
                  </span>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(selectedTrace.attemptedModels?.length
                      ? selectedTrace.attemptedModels
                      : [selectedTrace.selectedModel]
                    ).map((model, index) => (
                      <React.Fragment key={`${model}-${index}`}>
                        {index > 0 && (
                          <span className="text-white/25">→</span>
                        )}
                        <span className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1.5 font-mono text-xs text-amber-200">
                          {model}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-white/45">
                    Fallback utilizado: {' '}
                    <strong className={selectedTrace.fallbackUsed ? 'text-amber-300' : 'text-emerald-300'}>
                      {selectedTrace.fallbackUsed ? 'Sim' : 'Não'}
                    </strong>
                  </p>
                </section>

                <section className={`rounded-2xl border p-4 ${selectedTrace.errorCode ? 'border-red-400/25 bg-red-500/[0.07]' : 'border-emerald-400/25 bg-emerald-500/[0.06]'}`}>
                  <div className="flex items-center gap-2 text-xs font-bold">
                    {selectedTrace.errorCode ? (
                      <AlertTriangle className="h-4 w-4 text-red-300" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 text-emerald-300" />
                    )}
                    Evidência registrada
                  </div>
                  <p className="mt-2 break-words font-mono text-xs text-white/65">
                    {selectedTrace.errorCode
                      ? `Erro: ${selectedTrace.errorCode}`
                      : selectedTrace.status === 'completed'
                        ? 'Execução concluída pelo backend sem código de erro registrado.'
                        : 'Execução ainda não possui erro registrado.'}
                  </p>
                </section>

                <section className="grid gap-3 sm:grid-cols-3">
                  <Detail label="Início" value={formatDate(selectedTrace.startedAt)} />
                  <Detail label="Conclusão" value={formatDate(selectedTrace.completedAt)} />
                  <Detail label="Créditos estimados" value={formatNumber(selectedTrace.estimatedCredits)} />
                </section>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-white/35">
                <Activity className="mb-3 h-10 w-10 text-amber-300/50" />
                <p className="text-sm font-bold">
                  Nenhuma execução selecionada
                </p>
                <p className="mt-1 max-w-sm text-xs">
                  Quando a IA for utilizada, os registros reais aparecerão aqui.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

const Metric: React.FC<{
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'danger';
}> = ({ label, value, tone = 'default' }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
    <span className="block text-[9px] font-bold uppercase text-white/35">
      {label}
    </span>
    <strong
      className={`mt-1 block text-base ${
        tone === 'success'
          ? 'text-emerald-300'
          : tone === 'danger'
            ? 'text-red-300'
            : 'text-amber-300'
      }`}
    >
      {value}
    </strong>
  </div>
);

const InfoCard: React.FC<{
  icon: React.ReactElement;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
    <div className="flex items-center gap-2 text-amber-300 [&>svg]:h-4 [&>svg]:w-4">
      {icon}
      <span className="text-[9px] font-bold uppercase text-white/35">
        {label}
      </span>
    </div>
    <strong className="mt-2 block truncate text-xs text-white/75">
      {value || 'Não informado'}
    </strong>
  </div>
);

const TokenCard: React.FC<{
  label: string;
  value: number | null;
}> = ({ label, value }) => (
  <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-center">
    <span className="block text-[9px] font-bold uppercase text-white/35">
      {label}
    </span>
    <strong className="mt-1 block text-sm text-amber-200">
      {formatNumber(value)}
    </strong>
  </div>
);

const Detail: React.FC<{
  label: string;
  value: string;
}> = ({ label, value }) => (
  <div className="rounded-xl border border-white/10 bg-black/35 p-3">
    <span className="block text-[9px] font-bold uppercase text-white/35">
      {label}
    </span>
    <span className="mt-1 block break-all font-mono text-[11px] text-white/65">
      {value || 'Não informado'}
    </span>
  </div>
);