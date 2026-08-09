import React, {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  Clock3,
  Cpu,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  X,
  Zap
} from 'lucide-react';
import { apiClient } from '../services/apiClient';

type EvaluationCategory =
  | 'accuracy'
  | 'rag'
  | 'tool_calling'
  | 'safety'
  | 'code'
  | 'latency';

interface EvaluationResult {
  id: string;
  testName: string;
  category: EvaluationCategory;
  input: string;
  expectedBehavior: string;
  actualOutput: string;
  score: number;
  model: string;
  promptVersion: string;
  latencyMs: number;
  costCredits: number;
  status: 'passed' | 'failed';
  evaluatedAt: string;
}

interface ModelDefinition {
  id: string;
  enabled: boolean;
}

interface EvaluationSuiteSummary {
  runId: string;
  model: string;
  promptVersion: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  averageScore: number;
  totalLatencyMs: number;
  totalCostCredits: number;
  results: EvaluationResult[];
}

interface EvaluationsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<
  EvaluationCategory,
  string
> = {
  accuracy: 'Precisão e instruções',
  rag: 'Base de conhecimento (RAG)',
  tool_calling: 'Uso de ferramentas',
  safety: 'Segurança',
  code: 'Código e dados estruturados',
  latency: 'Latência'
};

const CATEGORY_ICONS: Record<
  EvaluationCategory,
  React.ReactNode
> = {
  accuracy: <Activity className="h-4 w-4" />,
  rag: <BarChart2 className="h-4 w-4" />,
  tool_calling: <Zap className="h-4 w-4" />,
  safety: <ShieldCheck className="h-4 w-4" />,
  code: <Cpu className="h-4 w-4" />,
  latency: <Clock3 className="h-4 w-4" />
};

function formatDate(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('pt-BR');
}

function formatScore(score: number): string {
  const normalized = Math.max(0, Math.min(1, score));
  return `${(normalized * 100).toFixed(1)}%`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Ocorreu um erro inesperado.';
}

export const EvaluationsModal: React.FC<
  EvaluationsModalProps
> = ({ isOpen, onClose }) => {
  const [evaluations, setEvaluations] = useState<
    EvaluationResult[]
  >([]);
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [promptVersion, setPromptVersion] = useState(
    'benchmark-v1'
  );
  const [selectedEvaluation, setSelectedEvaluation] =
    useState<EvaluationResult | null>(null);
  const [lastSummary, setLastSummary] =
    useState<EvaluationSuiteSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const [evaluationResponse, modelResponse] =
        await Promise.all([
          apiClient<{ evaluations: EvaluationResult[] }>(
            '/api/admin/ai/evaluations'
          ),
          apiClient<{ models: ModelDefinition[] }>(
            '/api/admin/ai/models'
          )
        ]);

      const nextEvaluations = Array.isArray(
        evaluationResponse.evaluations
      )
        ? evaluationResponse.evaluations
        : [];
      const nextModels = Array.isArray(modelResponse.models)
        ? modelResponse.models.filter((model) => model.enabled)
        : [];

      setEvaluations(nextEvaluations);
      setModels(nextModels);
      setSelectedModel((current) =>
        nextModels.some((model) => model.id === current)
          ? current
          : nextModels[0]?.id ?? ''
      );
      setSelectedEvaluation((current) => {
        if (
          current &&
          nextEvaluations.some(
            (evaluation) => evaluation.id === current.id
          )
        ) {
          return current;
        }

        return nextEvaluations[0] ?? null;
      });
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadData();
    }
  }, [isOpen, loadData]);

  const categoryMetrics = useMemo(() => {
    const grouped = new Map<
      EvaluationCategory,
      EvaluationResult[]
    >();

    for (const evaluation of evaluations) {
      const current = grouped.get(evaluation.category) ?? [];
      current.push(evaluation);
      grouped.set(evaluation.category, current);
    }

    return Array.from(grouped.entries()).map(
      ([category, results]) => {
        const score =
          results.reduce(
            (sum, result) => sum + result.score,
            0
          ) / results.length;
        const passed = results.filter(
          (result) => result.status === 'passed'
        ).length;

        return {
          category,
          score,
          total: results.length,
          passed
        };
      }
    );
  }, [evaluations]);

  const globalMetrics = useMemo(() => {
    const total = evaluations.length;
    const passed = evaluations.filter(
      (evaluation) => evaluation.status === 'passed'
    ).length;
    const averageScore = total
      ? evaluations.reduce(
          (sum, evaluation) => sum + evaluation.score,
          0
        ) / total
      : 0;
    const averageLatency = total
      ? evaluations.reduce(
          (sum, evaluation) => sum + evaluation.latencyMs,
          0
        ) / total
      : 0;

    return {
      total,
      passed,
      failed: total - passed,
      averageScore,
      averageLatency
    };
  }, [evaluations]);

  if (!isOpen) {
    return null;
  }

  const runSuite = async () => {
    if (!selectedModel) {
      setError('Nenhum modelo habilitado está disponível.');
      return;
    }

    setIsRunning(true);
    setError('');
    setLastSummary(null);

    try {
      const response = await apiClient<{
        summary: EvaluationSuiteSummary;
      }>('/api/admin/ai/evaluations/run', {
        method: 'POST',
        body: JSON.stringify({
          model: selectedModel,
          promptVersion: promptVersion.trim() || 'benchmark-v1'
        })
      });

      setLastSummary(response.summary);
      await loadData();
      setSelectedEvaluation(response.summary.results[0] ?? null);
    } catch (runError) {
      setError(errorMessage(runError));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 text-white backdrop-blur-xl">
      <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-amber-400/20 bg-[#070707] shadow-[0_0_70px_rgba(245,158,11,0.10)]">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-black/70 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
              <BarChart2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold">
                Avaliações Reais da IA
              </h3>
              <p className="text-xs text-white/45">
                Homologação registrada, segurança, precisão e latência
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={isLoading || isRunning}
              className="rounded-xl border border-white/10 p-2 text-white/60 transition hover:border-amber-400/30 hover:text-amber-300 disabled:opacity-40"
              title="Atualizar dados"
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

        <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto bg-[#090909] p-6">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <section className="flex flex-col gap-4 rounded-3xl border border-amber-400/25 bg-amber-400/[0.04] p-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <h4 className="flex items-center gap-2 text-sm font-bold">
                <ShieldCheck className="h-4 w-4 text-amber-300" />
                Suíte oficial de homologação
              </h4>
              <p className="max-w-2xl text-xs leading-relaxed text-white/50">
                Executa chamadas reais no modelo selecionado e verifica formato, português, JSON, latência e bloqueio de prompt injection. Os resultados são gravados no Firestore.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="space-y-1 text-[10px] font-bold uppercase text-white/45">
                Modelo habilitado
                <select
                  value={selectedModel}
                  onChange={(event) =>
                    setSelectedModel(event.target.value)
                  }
                  disabled={isRunning}
                  className="block min-w-52 rounded-xl border border-white/10 bg-black px-3 py-2.5 text-xs normal-case text-white outline-none focus:border-amber-400/40"
                >
                  {models.length === 0 && (
                    <option value="">Nenhum modelo disponível</option>
                  )}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-[10px] font-bold uppercase text-white/45">
                Versão avaliada
                <input
                  value={promptVersion}
                  onChange={(event) =>
                    setPromptVersion(event.target.value)
                  }
                  maxLength={120}
                  disabled={isRunning}
                  className="block w-40 rounded-xl border border-white/10 bg-black px-3 py-2.5 text-xs normal-case text-white outline-none focus:border-amber-400/40"
                />
              </label>

              <button
                type="button"
                onClick={() => void runSuite()}
                disabled={
                  isRunning || isLoading || !selectedModel
                }
                className="flex items-center justify-center gap-2 rounded-xl border border-amber-300/40 bg-amber-400 px-5 py-2.5 text-xs font-black text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
                {isRunning
                  ? 'Executando testes reais...'
                  : 'Executar avaliação'}
              </button>
            </div>
          </section>

          {lastSummary && (
            <section className="rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.07] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Avaliação concluída e registrada
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-5">
                <span>{lastSummary.passedTests}/{lastSummary.totalTests} aprovados</span>
                <span>Score: {lastSummary.averageScore.toFixed(1)}%</span>
                <span>Latência: {lastSummary.totalLatencyMs} ms</span>
                <span>Custo: {lastSummary.totalCostCredits} créditos</span>
                <span className="truncate">Run: {lastSummary.runId}</span>
              </div>
            </section>
          )}

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="Avaliações registradas"
              value={String(globalMetrics.total)}
            />
            <MetricCard
              label="Score médio real"
              value={formatScore(globalMetrics.averageScore)}
            />
            <MetricCard
              label="Testes aprovados"
              value={`${globalMetrics.passed}/${globalMetrics.total}`}
            />
            <MetricCard
              label="Latência média"
              value={`${Math.round(globalMetrics.averageLatency)} ms`}
            />
          </section>

          <section className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white/50">
              Métricas calculadas do histórico real
            </h4>

            {categoryMetrics.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-xs text-white/40">
                Ainda não existem avaliações registradas. Execute a primeira suíte real.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {categoryMetrics.map((metric) => (
                  <div
                    key={metric.category}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-white/75">
                        <span className="text-amber-300">
                          {CATEGORY_ICONS[metric.category]}
                        </span>
                        {CATEGORY_LABELS[metric.category]}
                      </div>
                      <strong
                        className={
                          metric.score >= 0.75
                            ? 'text-emerald-300'
                            : 'text-red-300'
                        }
                      >
                        {formatScore(metric.score)}
                      </strong>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full ${
                          metric.score >= 0.75
                            ? 'bg-emerald-400'
                            : 'bg-red-400'
                        }`}
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(100, metric.score * 100)
                          )}%`
                        }}
                      />
                    </div>
                    <p className="mt-2 text-[10px] text-white/35">
                      {metric.passed} de {metric.total} aprovados · meta mínima 75%
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white/50">
                Histórico recente
              </h4>
              <div className="custom-scrollbar max-h-80 space-y-2 overflow-y-auto pr-1">
                {evaluations.map((evaluation) => (
                  <button
                    type="button"
                    key={evaluation.id}
                    onClick={() =>
                      setSelectedEvaluation(evaluation)
                    }
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      selectedEvaluation?.id === evaluation.id
                        ? 'border-amber-400/30 bg-amber-400/[0.07]'
                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-xs font-bold">
                        {evaluation.testName}
                      </span>
                      <span
                        className={`shrink-0 text-xs font-black ${
                          evaluation.status === 'passed'
                            ? 'text-emerald-300'
                            : 'text-red-300'
                        }`}
                      >
                        {formatScore(evaluation.score)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[10px] text-white/35">
                      {evaluation.model} · {formatDate(evaluation.evaluatedAt)}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
              {selectedEvaluation ? (
                <div className="space-y-4 text-xs">
                  <div>
                    <h4 className="font-bold">
                      {selectedEvaluation.testName}
                    </h4>
                    <p className="mt-1 text-[10px] text-white/40">
                      {CATEGORY_LABELS[selectedEvaluation.category]} · {selectedEvaluation.model} · {selectedEvaluation.latencyMs} ms
                    </p>
                  </div>
                  <DetailBlock
                    label="Entrada usada"
                    value={selectedEvaluation.input}
                  />
                  <DetailBlock
                    label="Comportamento esperado"
                    value={selectedEvaluation.expectedBehavior}
                  />
                  <DetailBlock
                    label="Saída real"
                    value={selectedEvaluation.actualOutput}
                  />
                </div>
              ) : (
                <div className="flex h-full min-h-52 items-center justify-center text-center text-xs text-white/35">
                  Selecione uma avaliação para conferir entrada, resultado esperado e saída real.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

const MetricCard: React.FC<{
  label: string;
  value: string;
}> = ({ label, value }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
    <span className="block text-[10px] font-bold uppercase text-white/35">
      {label}
    </span>
    <strong className="mt-1 block text-lg text-amber-300">
      {value}
    </strong>
  </div>
);

const DetailBlock: React.FC<{
  label: string;
  value: string;
}> = ({ label, value }) => (
  <div>
    <span className="text-[10px] font-bold uppercase text-white/35">
      {label}
    </span>
    <pre className="custom-scrollbar mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-white/70">
      {value || 'Sem conteúdo registrado.'}
    </pre>
  </div>
);