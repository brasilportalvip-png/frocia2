import React, { useCallback, useEffect, useState } from 'react';
import {
  Brain,
  Check,
  Download,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { apiClient } from '../services/apiClient';

interface ManagedMemory {
  id: string;
  tenantId: string;
  scope: 'user' | 'organization' | 'project' | 'conversation';
  scopeId: string | null;
  category: string;
  content: string;
  source: string;
  purpose: 'personalization' | 'project_continuity' | 'conversation_context' | 'user_note';
  sensitivity: 'standard' | 'personal';
  retentionDays: number;
  consentVersion: string;
  consentedAt: string;
  userApproved: boolean;
  validUntil: string | null;
  status: 'active' | 'superseded' | 'deleted';
  updatedAt: string;
  retrievalReason?: string;
}

interface MemoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Não foi possível concluir esta ação.';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('pt-BR');
}

export const MemoryManagerModal: React.FC<
  MemoryManagerModalProps
> = ({ isOpen, onClose }) => {
  const [memories, setMemories] = useState<ManagedMemory[]>([]);
  const [category, setCategory] = useState('preferência');
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<'user' | 'organization'>('user');
  const [purpose, setPurpose] = useState<ManagedMemory['purpose']>('personalization');
  const [retentionDays, setRetentionDays] = useState(365);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadMemories = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await apiClient<{ memories: ManagedMemory[] }>(
        '/api/memories?manage=true'
      );
      let audit: {
        events: Array<{
          memoryId: string;
          action: string;
          reason: string;
        }>;
      } = { events: [] };
      try {
        audit = await apiClient<{
          events: Array<{
            memoryId: string;
            action: string;
            reason: string;
          }>;
        }>('/api/memories/audit');
      } catch {
        // O painel continua utilizável se o índice de auditoria estiver sendo criado.
      }
      const latestReason = new Map<string, string>();
      audit.events.forEach((event) => {
        if (event.action === 'retrieved' && !latestReason.has(event.memoryId)) {
          latestReason.set(event.memoryId, event.reason);
        }
      });
      setMemories(
        response.memories.map((memory) => ({
          ...memory,
          retrievalReason: latestReason.get(memory.id),
        }))
      );
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void loadMemories();
  }, [isOpen, loadMemories]);

  if (!isOpen) return null;

  const resetEditor = () => {
    setEditingId(null);
    setCategory('preferência');
    setContent('');
    setScope('user');
    setPurpose('personalization');
    setRetentionDays(365);
    setConsentConfirmed(false);
  };

  const saveMemory = async () => {
    const normalizedContent = content.trim();
    const normalizedCategory = category.trim() || 'geral';

    if (!normalizedContent) {
      setError('Escreva a informação que a Froc.IA deve lembrar.');
      return;
    }
    if (!editingId && !consentConfirmed) {
      setError('Confirme o consentimento antes de adicionar a memória.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      if (editingId) {
        await apiClient(`/api/memories/${encodeURIComponent(editingId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            category: normalizedCategory,
            content: normalizedContent,
            purpose,
            retentionDays,
          }),
        });
      } else {
        await apiClient('/api/memories', {
          method: 'POST',
          body: JSON.stringify({
            scope,
            category: normalizedCategory,
            content: normalizedContent,
            purpose,
            retentionDays,
            sensitivity: 'standard',
            consentConfirmed: true,
          }),
        });
      }

      resetEditor();
      await loadMemories();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleApproval = async (memory: ManagedMemory) => {
    setPendingId(memory.id);
    setError('');

    try {
      await apiClient(`/api/memories/${encodeURIComponent(memory.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ userApproved: !memory.userApproved }),
      });
      setMemories((current) =>
        current.map((item) =>
          item.id === memory.id
            ? { ...item, userApproved: !item.userApproved }
            : item
        )
      );
    } catch (toggleError) {
      setError(errorMessage(toggleError));
    } finally {
      setPendingId(null);
    }
  };

  const deleteMemory = async (memory: ManagedMemory) => {
    if (!window.confirm('Excluir esta memória permanentemente?')) return;

    setPendingId(memory.id);
    setError('');

    try {
      await apiClient(`/api/memories/${encodeURIComponent(memory.id)}`, {
        method: 'DELETE',
      });
      setMemories((current) =>
        current.filter((item) => item.id !== memory.id)
      );
      if (editingId === memory.id) resetEditor();
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setPendingId(null);
    }
  };

  const exportMemories = async () => {
    setError('');
    const response = await apiClient<{
      exportedAt: string;
      memories: ManagedMemory[];
    }>('/api/memories/export');
    const payload = JSON.stringify(response, null, 2);
    const url = URL.createObjectURL(
      new Blob([payload], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `frocia-memorias-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const deleteAllMemories = async () => {
    if (!window.confirm('Excluir permanentemente todas as suas memórias?')) return;
    setIsLoading(true);
    setError('');
    try {
      await apiClient('/api/memories?confirm=DELETE_ALL', { method: 'DELETE' });
      setMemories([]);
      resetEditor();
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4 text-white backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-manager-title"
    >
      <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-amber-400/20 bg-[#070707] shadow-[0_0_70px_rgba(245,158,11,0.10)]">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/70 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
              <Brain className="h-5 w-5" />
            </span>
            <div>
              <h2 id="memory-manager-title" className="text-base font-extrabold">
                Memórias da Froc.IA
              </h2>
              <p className="text-xs text-white/45">
                Você controla exatamente o que pode entrar no contexto.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-white/55 hover:bg-white/10 hover:text-white"
            aria-label="Fechar memórias"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_1fr]">
          <section className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
            <div className="mb-4 flex items-center gap-2 text-xs text-emerald-300">
              <ShieldCheck className="h-4 w-4" />
              <span>Somente memórias aprovadas são usadas pela IA.</span>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-white/45">
                Escopo
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as 'user' | 'organization')}
                  disabled={Boolean(editingId)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#111] px-3 py-2.5 text-sm normal-case outline-none"
                >
                  <option value="user">Usuário</option>
                  <option value="organization">Empresa</option>
                </select>
              </label>
              <label className="text-[11px] font-bold uppercase tracking-wider text-white/45">
                Retenção
                <select
                  value={retentionDays}
                  onChange={(event) => setRetentionDays(Number(event.target.value))}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#111] px-3 py-2.5 text-sm normal-case outline-none"
                >
                  <option value={30}>30 dias</option>
                  <option value={90}>90 dias</option>
                  <option value={180}>180 dias</option>
                  <option value={365}>1 ano</option>
                  <option value={730}>2 anos</option>
                </select>
              </label>
            </div>

            <label className="mb-3 block text-[11px] font-bold uppercase tracking-wider text-white/45">
              Finalidade
              <select
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as ManagedMemory['purpose'])}
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#111] px-3 py-2.5 text-sm normal-case outline-none"
              >
                <option value="personalization">Personalização</option>
                <option value="project_continuity">Continuidade de projeto</option>
                <option value="conversation_context">Contexto de conversa</option>
                <option value="user_note">Anotação do usuário</option>
              </select>
            </label>

            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/45">
              Categoria
            </label>
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              maxLength={50}
              className="mb-3 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm outline-none focus:border-amber-400/50"
              placeholder="Ex.: preferência, perfil, projeto"
            />

            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/45">
              Informação
            </label>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={2000}
              rows={7}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm outline-none focus:border-amber-400/50"
              placeholder="Ex.: Prefiro respostas diretas em português."
            />
            <div className="mt-1 text-right text-[10px] text-white/30">
              {content.length}/2000
            </div>

            {!editingId && (
              <label className="mt-3 flex items-start gap-2 text-xs text-white/60">
                <input
                  type="checkbox"
                  checked={consentConfirmed}
                  onChange={(event) => setConsentConfirmed(event.target.checked)}
                  className="mt-0.5"
                />
                Autorizo o uso desta informação somente para a finalidade e pelo prazo selecionados.
              </label>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void saveMemory()}
                disabled={isSaving}
                className="froc-gold-button flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : editingId ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {editingId ? 'Salvar correção' : 'Adicionar memória'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetEditor}
                  className="rounded-xl border border-white/10 px-3 text-xs text-white/65 hover:bg-white/10"
                >
                  Cancelar
                </button>
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-col p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-xs text-white/50">
                {memories.length} memória{memories.length === 1 ? '' : 's'}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void loadMemories()}
                  disabled={isLoading}
                  className="rounded-xl border border-white/10 p-2 text-white/55 hover:bg-white/10 disabled:opacity-40"
                  title="Atualizar"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => void exportMemories().catch((exportError) => setError(errorMessage(exportError)))}
                  disabled={memories.length === 0}
                  className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
                >
                  <Download className="h-4 w-4" />
                  Exportar
                </button>
                <button
                  type="button"
                  onClick={() => void deleteAllMemories()}
                  disabled={memories.length === 0 || isLoading}
                  className="rounded-xl border border-rose-400/20 px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/10 disabled:opacity-40"
                >
                  Excluir todas
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-3 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            )}

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {isLoading && memories.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-white/45">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : memories.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40">
                  Nenhuma memória cadastrada. A Froc.IA não salva tudo automaticamente.
                </div>
              ) : (
                memories.map((memory) => (
                  <article
                    key={memory.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-bold text-amber-300">
                            {memory.category}
                          </span>
                          <span className="text-[10px] uppercase text-white/30">
                            {memory.scope}
                          </span>
                          <span className="text-[10px] text-cyan-300/70">
                            {memory.purpose} · {memory.retentionDays} dias
                          </span>
                          {memory.sensitivity === 'personal' && (
                            <span className="text-[10px] text-violet-300">criptografada</span>
                          )}
                          <button
                            type="button"
                            onClick={() => void toggleApproval(memory)}
                            disabled={pendingId === memory.id}
                            className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                              memory.userApproved
                                ? 'bg-emerald-400/10 text-emerald-300'
                                : 'bg-white/8 text-white/45'
                            }`}
                          >
                            {memory.userApproved ? 'Aprovada' : 'Pausada'}
                          </button>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/82">
                          {memory.content}
                        </p>
                        <p className="mt-2 text-[10px] text-white/30">
                          Atualizada em {formatDate(memory.updatedAt)} · expira {memory.validUntil ? formatDate(memory.validUntil) : 'conforme política'}
                        </p>
                        {memory.retrievalReason && (
                          <p className="mt-1 text-[10px] text-emerald-300/60">{memory.retrievalReason}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(memory.id);
                            setCategory(memory.category);
                            setContent(memory.content);
                            setPurpose(memory.purpose);
                            setRetentionDays(memory.retentionDays);
                            setScope(memory.scope === 'organization' ? 'organization' : 'user');
                            setError('');
                          }}
                          className="rounded-lg p-2 text-cyan-300 hover:bg-cyan-400/10"
                          title="Corrigir"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteMemory(memory)}
                          disabled={pendingId === memory.id}
                          className="rounded-lg p-2 text-rose-300 hover:bg-rose-400/10 disabled:opacity-40"
                          title="Excluir permanentemente"
                        >
                          {pendingId === memory.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
