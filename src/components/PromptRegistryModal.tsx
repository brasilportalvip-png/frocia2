import React, {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileCode,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  X
} from 'lucide-react';
import {
  ApiClientError,
  apiClient
} from '../services/apiClient';

type PromptStatus =
  | 'draft'
  | 'candidate'
  | 'beta'
  | 'production'
  | 'retired';

interface PromptVersion {
  id: string;
  promptId: string;
  version: string;
  status: PromptStatus;
  compatibleModels: string[];
  content: string;
  variables: string[];
  authorUid: string;
  evalScore: number | null;
  distributionPercentage: number;
  createdAt: string;
}

interface PromptDefinition {
  id: string;
  name: string;
  agent: string;
  mode: string;
  activeVersionId: string;
  createdAt: string;
  updatedAt: string;
  versions: PromptVersion[];
  activeVersion: PromptVersion | null;
}

interface PromptListResponse {
  prompts: PromptDefinition[];
  correlationId?: string;
}

interface PromptRegistryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PromptFormState {
  name: string;
  agent: string;
  mode: string;
  content: string;
  variables: string;
  compatibleModels: string;
}

const EMPTY_FORM: PromptFormState = {
  name: '',
  agent: '',
  mode: 'smart',
  content: '',
  variables: '',
  compatibleModels: ''
};

const AI_MODES = [
  { value: 'fast', label: 'Rápido' },
  { value: 'smart', label: 'Inteligente' },
  { value: 'deep', label: 'Profundo' },
  { value: 'code', label: 'Programação' },
  { value: 'research', label: 'Pesquisa' },
  { value: 'site-builder', label: 'Criador de projetos' },
  { value: 'image', label: 'Imagem' },
  { value: 'video', label: 'Vídeo' },
  { value: 'document', label: 'Documento' }
];

function splitCommaSeparated(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function formatDate(value?: string): string {
  if (!value) {
    return 'Não informado';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('pt-BR');
}

function statusLabel(status?: PromptStatus): string {
  switch (status) {
    case 'production':
      return 'Produção';
    case 'retired':
      return 'Arquivada';
    case 'candidate':
      return 'Candidata';
    case 'beta':
      return 'Beta';
    default:
      return 'Rascunho';
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.correlationId
      ? `${error.message} Código: ${error.correlationId}`
      : error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Ocorreu um erro inesperado.';
}

export const PromptRegistryModal: React.FC<
  PromptRegistryModalProps
> = ({ isOpen, onClose }) => {
  const [prompts, setPrompts] = useState<
    PromptDefinition[]
  >([]);
  const [selectedPromptId, setSelectedPromptId] =
    useState('');
  const [selectedVersionId, setSelectedVersionId] =
    useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [templateDraft, setTemplateDraft] =
    useState('');
  const [variablesDraft, setVariablesDraft] =
    useState('');
  const [modelsDraft, setModelsDraft] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] =
    useState<PromptFormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedPrompt = useMemo(
    () =>
      prompts.find(
        (prompt) => prompt.id === selectedPromptId
      ) ?? null,
    [prompts, selectedPromptId]
  );

  const selectedVersion = useMemo(
    () =>
      selectedPrompt?.versions.find(
        (version) => version.id === selectedVersionId
      ) ??
      selectedPrompt?.activeVersion ??
      selectedPrompt?.versions[0] ??
      null,
    [selectedPrompt, selectedVersionId]
  );

  const filteredPrompts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return prompts;
    }

    return prompts.filter((prompt) =>
      [prompt.name, prompt.agent, prompt.mode]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [prompts, searchQuery]);

  const loadPrompts = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await apiClient<PromptListResponse>(
        '/api/admin/ai/prompts'
      );

      const nextPrompts = Array.isArray(response.prompts)
        ? response.prompts
        : [];

      setPrompts(nextPrompts);
      setSelectedPromptId((current) => {
        if (
          current &&
          nextPrompts.some((prompt) => prompt.id === current)
        ) {
          return current;
        }

        return nextPrompts[0]?.id ?? '';
      });
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadPrompts();
    }
  }, [isOpen, loadPrompts]);

  useEffect(() => {
    if (!selectedPrompt) {
      setSelectedVersionId('');
      setTemplateDraft('');
      setVariablesDraft('');
      setModelsDraft('');
      return;
    }

    const nextVersion =
      selectedPrompt.activeVersion ??
      selectedPrompt.versions[0] ??
      null;

    setSelectedVersionId(nextVersion?.id ?? '');
  }, [selectedPromptId, selectedPrompt]);

  useEffect(() => {
    setTemplateDraft(selectedVersion?.content ?? '');
    setVariablesDraft(
      selectedVersion?.variables.join(', ') ?? ''
    );
    setModelsDraft(
      selectedVersion?.compatibleModels.join(', ') ?? ''
    );
  }, [selectedVersion]);

  if (!isOpen) {
    return null;
  }

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleCreatePrompt = async () => {
    clearMessages();

    if (
      !form.name.trim() ||
      !form.agent.trim() ||
      !form.content.trim()
    ) {
      setError(
        'Preencha o nome, o agente e o conteúdo do prompt.'
      );
      return;
    }

    setIsSaving(true);

    try {
      await apiClient('/api/admin/ai/prompts', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          agent: form.agent.trim(),
          mode: form.mode,
          content: form.content.trim(),
          variables: splitCommaSeparated(form.variables),
          compatibleModels: splitCommaSeparated(
            form.compatibleModels
          )
        })
      });

      setForm(EMPTY_FORM);
      setIsCreating(false);
      setSuccess('Prompt criado como rascunho.');
      await loadPrompts();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateVersion = async () => {
    if (!selectedPrompt) {
      return;
    }

    clearMessages();

    if (!templateDraft.trim()) {
      setError('O conteúdo do prompt não pode ficar vazio.');
      return;
    }

    setIsSaving(true);

    try {
      const response = await apiClient<{
        version: PromptVersion;
      }>(
        `/api/admin/ai/prompts/${encodeURIComponent(
          selectedPrompt.id
        )}/versions`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: templateDraft.trim(),
            variables: splitCommaSeparated(variablesDraft),
            compatibleModels:
              splitCommaSeparated(modelsDraft)
          })
        }
      );

      await loadPrompts();
      setSelectedVersionId(response.version.id);
      setSuccess('Nova versão imutável criada como rascunho.');
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const handleActivateVersion = async (
    versionId: string
  ) => {
    if (!selectedPrompt || !versionId) {
      return;
    }

    clearMessages();
    setIsSaving(true);

    try {
      await apiClient(
        `/api/admin/ai/prompts/${encodeURIComponent(
          selectedPrompt.id
        )}/activate`,
        {
          method: 'POST',
          body: JSON.stringify({ versionId })
        }
      );

      await loadPrompts();
      setSelectedVersionId(versionId);
      setSuccess(
        versionId === selectedPrompt.activeVersionId
          ? 'Versão de produção confirmada.'
          : 'Versão ativada em produção com sucesso.'
      );
    } catch (activateError) {
      setError(getErrorMessage(activateError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 text-white backdrop-blur-xl">
      <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-amber-400/20 bg-[#070707] shadow-[0_0_70px_rgba(245,158,11,0.10)]">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-black/70 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
              <FileCode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold">
                Registro Real de Prompts
              </h3>
              <p className="text-xs text-white/45">
                Versões imutáveis, ativação e rollback controlado
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadPrompts()}
              disabled={isLoading || isSaving}
              className="rounded-xl border border-white/10 p-2 text-white/60 transition hover:border-amber-400/30 hover:text-amber-300 disabled:opacity-50"
              title="Atualizar"
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

        {(error || success) && (
          <div
            className={`mx-4 mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-xs ${
              error
                ? 'border-red-400/25 bg-red-500/10 text-red-200'
                : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            {error ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{error || success}</span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex w-80 shrink-0 flex-col border-r border-white/10 bg-black/35 p-4">
            <div className="mb-3 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-white/35" />
                <input
                  value={searchQuery}
                  onChange={(event) =>
                    setSearchQuery(event.target.value)
                  }
                  placeholder="Buscar prompts..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-xs outline-none focus:border-amber-400/40"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  clearMessages();
                  setIsCreating(true);
                }}
                className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-2 text-amber-300 transition hover:bg-amber-400/20"
                title="Novo prompt"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto">
              {isLoading && prompts.length === 0 ? (
                <div className="flex h-36 items-center justify-center text-white/45">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  <span className="text-xs">Carregando...</span>
                </div>
              ) : filteredPrompts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs text-white/40">
                  Nenhum prompt real cadastrado.
                </div>
              ) : (
                filteredPrompts.map((prompt) => {
                  const version =
                    prompt.activeVersion ?? prompt.versions[0];

                  return (
                    <button
                      type="button"
                      key={prompt.id}
                      onClick={() => {
                        clearMessages();
                        setIsCreating(false);
                        setSelectedPromptId(prompt.id);
                      }}
                      className={`w-full rounded-2xl border p-3 text-left transition ${
                        selectedPromptId === prompt.id
                          ? 'border-amber-400/35 bg-amber-400/10'
                          : 'border-white/5 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[10px] text-amber-300">
                          {version?.version ?? 'Sem versão'}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                            version?.status === 'production'
                              ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                              : 'border-white/10 bg-white/5 text-white/45'
                          }`}
                        >
                          {statusLabel(version?.status)}
                        </span>
                      </div>
                      <div className="truncate text-xs font-bold">
                        {prompt.name}
                      </div>
                      <div className="mt-1 truncate text-[10px] text-white/35">
                        {prompt.agent} · {prompt.mode}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <main className="custom-scrollbar flex-1 overflow-y-auto bg-[#090909] p-6">
            {isCreating ? (
              <section className="mx-auto max-w-3xl space-y-5">
                <div>
                  <h2 className="text-xl font-black">
                    Criar novo prompt
                  </h2>
                  <p className="mt-1 text-xs text-white/45">
                    O primeiro conteúdo será salvo como versão v1.0.0 em rascunho.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-bold text-white/65">
                    Nome
                    <input
                      value={form.name}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          name: event.target.value
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2.5 text-white outline-none focus:border-amber-400/40"
                    />
                  </label>

                  <label className="space-y-1.5 text-xs font-bold text-white/65">
                    Agente responsável
                    <input
                      value={form.agent}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          agent: event.target.value
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2.5 text-white outline-none focus:border-amber-400/40"
                    />
                  </label>

                  <label className="space-y-1.5 text-xs font-bold text-white/65">
                    Modo da IA
                    <select
                      value={form.mode}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          mode: event.target.value
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-black px-3 py-2.5 text-white outline-none focus:border-amber-400/40"
                    >
                      {AI_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5 text-xs font-bold text-white/65">
                    Modelos compatíveis, separados por vírgula
                    <input
                      value={form.compatibleModels}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          compatibleModels: event.target.value
                        }))
                      }
                      placeholder="gemini-3.6-flash, gemini-3.1-pro"
                      className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2.5 text-white outline-none focus:border-amber-400/40"
                    />
                  </label>
                </div>

                <label className="block space-y-1.5 text-xs font-bold text-white/65">
                  Variáveis, separadas por vírgula
                  <input
                    value={form.variables}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        variables: event.target.value
                      }))
                    }
                    placeholder="userPrompt, context, userCredits"
                    className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2.5 text-white outline-none focus:border-amber-400/40"
                  />
                </label>

                <label className="block space-y-1.5 text-xs font-bold text-white/65">
                  Conteúdo do prompt
                  <textarea
                    value={form.content}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        content: event.target.value
                      }))
                    }
                    className="h-64 w-full resize-y rounded-2xl border border-white/10 bg-black/60 p-4 font-mono text-xs leading-relaxed text-amber-100 outline-none focus:border-amber-400/40"
                  />
                </label>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-white/60 hover:text-white"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreatePrompt()}
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-400 px-4 py-2 text-xs font-black text-black transition hover:bg-amber-300 disabled:opacity-50"
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Criar prompt
                  </button>
                </div>
              </section>
            ) : selectedPrompt && selectedVersion ? (
              <section className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
                  <div>
                    <h2 className="text-xl font-black">
                      {selectedPrompt.name}
                    </h2>
                    <p className="mt-1 text-xs text-white/45">
                      {selectedPrompt.agent} · modo {selectedPrompt.mode} · atualizado em {formatDate(selectedPrompt.updatedAt)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      void handleActivateVersion(selectedVersion.id)
                    }
                    disabled={
                      isSaving ||
                      selectedVersion.id ===
                        selectedPrompt.activeVersionId
                    }
                    className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {selectedVersion.id ===
                    selectedPrompt.activeVersionId
                      ? 'Versão em produção'
                      : 'Ativar esta versão'}
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <span className="block text-[10px] font-bold uppercase text-white/35">
                      Versão selecionada
                    </span>
                    <select
                      value={selectedVersion.id}
                      onChange={(event) =>
                        setSelectedVersionId(event.target.value)
                      }
                      className="mt-1 w-full bg-transparent text-xs font-bold text-amber-300 outline-none"
                    >
                      {selectedPrompt.versions.map((version) => (
                        <option
                          key={version.id}
                          value={version.id}
                          className="bg-black text-white"
                        >
                          {version.version} — {statusLabel(version.status)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <span className="block text-[10px] font-bold uppercase text-white/35">
                      Criada em
                    </span>
                    <span className="mt-1 block text-xs font-bold text-white/75">
                      {formatDate(selectedVersion.createdAt)}
                    </span>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <span className="block text-[10px] font-bold uppercase text-white/35">
                      Avaliação
                    </span>
                    <span className="mt-1 block text-xs font-bold text-white/75">
                      {selectedVersion.evalScore === null
                        ? 'Ainda não avaliada'
                        : `${selectedVersion.evalScore}%`}
                    </span>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-bold text-white/60">
                    Modelos compatíveis
                    <input
                      value={modelsDraft}
                      onChange={(event) =>
                        setModelsDraft(event.target.value)
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2.5 text-white outline-none focus:border-amber-400/40"
                    />
                  </label>

                  <label className="space-y-1.5 text-xs font-bold text-white/60">
                    Variáveis
                    <input
                      value={variablesDraft}
                      onChange={(event) =>
                        setVariablesDraft(event.target.value)
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2.5 text-white outline-none focus:border-amber-400/40"
                    />
                  </label>
                </div>

                <label className="block space-y-1.5 text-xs font-bold text-white/60">
                  Corpo do prompt
                  <textarea
                    value={templateDraft}
                    onChange={(event) =>
                      setTemplateDraft(event.target.value)
                    }
                    className="h-64 w-full resize-y rounded-2xl border border-white/10 bg-black/60 p-4 font-mono text-xs leading-relaxed text-amber-100 outline-none focus:border-amber-400/40"
                  />
                </label>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleCreateVersion()}
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-400 px-4 py-2 text-xs font-black text-black transition hover:bg-amber-300 disabled:opacity-50"
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Salvar como nova versão
                  </button>
                </div>
              </section>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-white/40">
                <FileCode className="mb-3 h-10 w-10 text-amber-300/50" />
                <p className="text-sm font-bold">
                  Nenhum prompt selecionado
                </p>
                <p className="mt-1 max-w-sm text-xs">
                  Crie o primeiro prompt real ou selecione um item do registro.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};