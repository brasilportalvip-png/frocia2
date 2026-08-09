import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { ApiClientError, apiClient } from '../services/apiClient';
import { KnowledgeBase } from '../types';

interface KnowledgeBaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  knowledgeBases?: KnowledgeBase[];
  onCreateKnowledgeBase?: (knowledgeBase: KnowledgeBase) => void;
  onSelectBaseForChat?: (knowledgeBase: KnowledgeBase) => void;
}

interface KnowledgeBaseApi {
  id: string;
  name: string;
  description: string;
  owner: string;
  status: string;
  documentCount: number;
  chunksCount: number;
  lastIndexedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeDocumentApi {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  chunkCount: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeBaseDetailsResponse {
  knowledgeBase: KnowledgeBaseApi;
  documents: KnowledgeDocumentApi[];
}

const MAX_DOCUMENT_BYTES = 750_000;

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript-jsx',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  sql: 'text/x-sql',
  py: 'text/x-python',
  json: 'application/json',
  xml: 'application/xml'
};

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }

  return 'Ocorreu um erro inesperado. Tente novamente.';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string | null): string {
  if (!value) return 'Ainda não indexada';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function toLegacyKnowledgeBase(base: KnowledgeBaseApi): KnowledgeBase {
  return {
    id: base.id,
    name: base.name,
    description: base.description,
    owner: base.owner,
    files: [],
    chunksCount: base.chunksCount,
    indexStatus: base.status === 'active' ? 'ready' : 'indexing',
    costEstimate: 'Calculado pelo uso real',
    updatedAt: new Date(base.updatedAt).getTime() || Date.now()
  };
}

export const KnowledgeBaseModal: React.FC<KnowledgeBaseModalProps> = ({
  isOpen,
  onClose,
  onCreateKnowledgeBase,
  onSelectBaseForChat
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bases, setBases] = useState<KnowledgeBaseApi[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocumentApi[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedBase = useMemo(
    () => bases.find((base) => base.id === selectedBaseId) ?? null,
    [bases, selectedBaseId]
  );

  const filteredBases = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    if (!query) return bases;

    return bases.filter(
      (base) =>
        base.name.toLocaleLowerCase('pt-BR').includes(query) ||
        base.description.toLocaleLowerCase('pt-BR').includes(query)
    );
  }, [bases, search]);

  const loadBases = async (preferredId?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient<{ knowledgeBases: KnowledgeBaseApi[] }>(
        '/api/knowledge-bases'
      );
      const nextBases = response.knowledgeBases ?? [];
      setBases(nextBases);
      setSelectedBaseId((current) => {
        const desired = preferredId ?? current;
        if (desired && nextBases.some((base) => base.id === desired)) return desired;
        return nextBases[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(getErrorMessage(loadError));
      setBases([]);
      setSelectedBaseId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDetails = async (baseId: string) => {
    setIsLoadingDetails(true);
    setError(null);

    try {
      const response = await apiClient<KnowledgeBaseDetailsResponse>(
        `/api/knowledge-bases/${encodeURIComponent(baseId)}`
      );
      setDocuments(response.documents ?? []);
      setBases((current) =>
        current.map((base) =>
          base.id === response.knowledgeBase.id ? response.knowledgeBase : base
        )
      );
    } catch (detailsError) {
      setError(getErrorMessage(detailsError));
      setDocuments([]);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    setNotice(null);
    setError(null);
    void loadBases();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedBaseId) {
      setDocuments([]);
      return;
    }

    void loadDetails(selectedBaseId);
  }, [isOpen, selectedBaseId]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving && !isUploading && !deletingId) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, isUploading, deletingId, onClose]);

  if (!isOpen) return null;

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (normalizedName.length < 2 || isSaving) return;

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await apiClient<{ knowledgeBase: KnowledgeBaseApi }>(
        '/api/knowledge-bases',
        {
          method: 'POST',
          body: JSON.stringify({
            name: normalizedName,
            description: description.trim()
          })
        }
      );

      onCreateKnowledgeBase?.(toLegacyKnowledgeBase(response.knowledgeBase));
      setName('');
      setDescription('');
      setIsCreating(false);
      setNotice('Base criada com segurança. Agora adicione seus documentos.');
      await loadBases(response.knowledgeBase.id);
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setIsSaving(false);
    }
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedBase || isUploading) return;

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = MIME_BY_EXTENSION[extension];

    if (!mimeType) {
      setError('Formato não aceito. Use TXT, MD, CSV, JSON, HTML, CSS, JS, JSX, TS, TSX, YAML, SQL, PY ou XML.');
      return;
    }

    if (file.size === 0) {
      setError('O arquivo selecionado está vazio.');
      return;
    }

    if (file.size > MAX_DOCUMENT_BYTES) {
      setError('O documento excede o limite de 750 KB.');
      return;
    }

    setIsUploading(true);
    setError(null);
    setNotice(null);

    try {
      const contentText = await file.text();
      if (!contentText.trim()) throw new Error('O documento não possui texto indexável.');

      const response = await apiClient<{
        document: KnowledgeDocumentApi;
        duplicate: boolean;
      }>(`/api/knowledge-bases/${encodeURIComponent(selectedBase.id)}/documents`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentText, mimeType })
      });

      setNotice(
        response.duplicate
          ? 'Este conteúdo já estava indexado nesta base.'
          : `Documento indexado em ${response.document.chunkCount} parte(s).`
      );
      await loadDetails(selectedBase.id);
      await loadBases(selectedBase.id);
    } catch (uploadError) {
      setError(getErrorMessage(uploadError));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (document: KnowledgeDocumentApi) => {
    if (!selectedBase || deletingId) return;
    if (!window.confirm(`Excluir definitivamente o documento “${document.filename}” e seus vetores?`)) return;

    setDeletingId(document.id);
    setError(null);
    setNotice(null);

    try {
      await apiClient(
        `/api/knowledge-bases/${encodeURIComponent(selectedBase.id)}/documents/${encodeURIComponent(document.id)}`,
        { method: 'DELETE' }
      );
      setNotice('Documento e índice vetorial excluídos.');
      await loadDetails(selectedBase.id);
      await loadBases(selectedBase.id);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteBase = async () => {
    if (!selectedBase || deletingId) return;
    if (!window.confirm(`Excluir definitivamente a base “${selectedBase.name}”, todos os documentos e vetores?`)) return;

    setDeletingId(selectedBase.id);
    setError(null);
    setNotice(null);

    try {
      await apiClient(`/api/knowledge-bases/${encodeURIComponent(selectedBase.id)}`, {
        method: 'DELETE'
      });
      setDocuments([]);
      setNotice('Base de Conhecimento excluída.');
      await loadBases();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  const handleUseInChat = () => {
    if (!selectedBase || !onSelectBaseForChat) return;
    if (selectedBase.documentCount < 1 || selectedBase.chunksCount < 1) {
      setError('Adicione ao menos um documento indexado antes de usar esta base no chat.');
      return;
    }

    onSelectBaseForChat(toLegacyKnowledgeBase(selectedBase));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/90 p-3 backdrop-blur-xl sm:p-5">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-amber-400/25 bg-[#090909] text-white shadow-[0_30px_120px_rgba(0,0,0,0.95)]">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-2.5 text-amber-300">
              <Database className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black sm:text-lg">Base de Conhecimento</h2>
              <p className="truncate text-[11px] text-white/45">Documentos privados, indexação real e respostas com RAG</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-white/55 hover:bg-white/10 hover:text-white" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="flex min-h-[14rem] flex-col border-b border-white/10 bg-[#060606] p-4 md:min-h-0 md:border-b-0 md:border-r">
            <div className="mb-3 flex gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3">
                <Search className="h-4 w-4 text-white/35" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar base" className="min-w-0 flex-1 bg-transparent py-2.5 text-xs outline-none placeholder:text-white/30" />
              </label>
              <button type="button" onClick={() => void loadBases(selectedBaseId ?? undefined)} disabled={isLoading} className="rounded-xl border border-white/10 p-2.5 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-50" title="Atualizar">
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <button type="button" onClick={() => setIsCreating(true)} className="mb-3 flex items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 py-2.5 text-xs font-bold text-amber-200 hover:bg-amber-400/15">
              <Plus className="h-4 w-4" /> Nova base
            </button>

            <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-white/45"><Loader2 className="h-4 w-4 animate-spin" /> Carregando bases...</div>
              ) : filteredBases.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs text-white/40">Nenhuma base encontrada.</div>
              ) : (
                filteredBases.map((base) => (
                  <button key={base.id} type="button" onClick={() => setSelectedBaseId(base.id)} className={`w-full rounded-2xl border p-3 text-left transition ${selectedBaseId === base.id ? 'border-amber-400/35 bg-amber-400/10' : 'border-white/10 bg-white/[0.035] hover:bg-white/[0.07]'}`}>
                    <div className="truncate text-xs font-bold text-white">{base.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-white/40"><span>{base.documentCount} documento(s)</span><span>•</span><span>{base.chunksCount} partes</span></div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <main className="custom-scrollbar min-h-0 overflow-y-auto p-4 sm:p-6">
            {isCreating ? (
              <form onSubmit={handleCreate} className="mx-auto max-w-xl space-y-4">
                <div><h3 className="text-lg font-black">Criar Base de Conhecimento</h3><p className="mt-1 text-xs text-white/45">A base será privada e vinculada à sua conta.</p></div>
                <label className="block"><span className="mb-1.5 block text-xs font-bold text-white/70">Nome</span><input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Documentação da minha empresa" className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none focus:border-amber-400/40" /></label>
                <label className="block"><span className="mb-1.5 block text-xs font-bold text-white/70">Descrição</span><textarea maxLength={500} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Explique quais conhecimentos serão guardados nesta base." className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none focus:border-amber-400/40" /></label>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setIsCreating(false)} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white/65 hover:bg-white/10">Cancelar</button><button type="submit" disabled={isSaving || name.trim().length < 2} className="froc-gold-button flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black disabled:opacity-50">{isSaving && <Loader2 className="h-4 w-4 animate-spin" />} Criar base</button></div>
              </form>
            ) : selectedBase ? (
              <div className="space-y-5">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-lg font-black">{selectedBase.name}</h3><span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-300">Ativa</span></div><p className="mt-1 text-xs leading-relaxed text-white/55">{selectedBase.description || 'Sem descrição.'}</p><p className="mt-2 text-[10px] text-white/35">Atualizada em {formatDate(selectedBase.updatedAt)}</p></div>
                  <button type="button" onClick={() => void handleDeleteBase()} disabled={Boolean(deletingId)} className="flex shrink-0 items-center gap-2 rounded-xl border border-red-400/20 px-3 py-2 text-[11px] font-bold text-red-300 hover:bg-red-400/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Excluir base</button>
                </div>

                <div className="grid grid-cols-3 gap-2"><div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xl font-black text-amber-300">{selectedBase.documentCount}</div><div className="text-[10px] text-white/40">Documentos</div></div><div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xl font-black text-amber-300">{selectedBase.chunksCount}</div><div className="text-[10px] text-white/40">Partes indexadas</div></div><div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="truncate text-xs font-bold text-emerald-300">{selectedBase.chunksCount > 0 ? 'Pronta' : 'Vazia'}</div><div className="mt-1 text-[10px] text-white/40">Situação RAG</div></div></div>

                {error && <div className="flex items-start gap-2 rounded-2xl border border-red-400/25 bg-red-400/10 p-3 text-xs text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
                {notice && <div className="flex items-start gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{notice}</span></div>}

                <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.json,.html,.htm,.css,.js,.jsx,.ts,.tsx,.yaml,.yml,.sql,.py,.xml" onChange={(event) => void handleFile(event)} className="hidden" />
                <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-amber-400/25 bg-amber-400/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-bold text-white">Adicionar documento textual</div><div className="mt-1 text-[10px] text-white/40">TXT, MD, CSV, JSON, código, YAML, SQL ou XML — máximo 750 KB</div></div><button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="froc-gold-button flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black disabled:opacity-50">{isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{isUploading ? 'Indexando...' : 'Selecionar arquivo'}</button></div>

                <section><div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-black uppercase tracking-wider text-white/55">Documentos indexados</h4>{isLoadingDetails && <Loader2 className="h-4 w-4 animate-spin text-amber-300" />}</div><div className="space-y-2">{!isLoadingDetails && documents.length === 0 ? <div className="rounded-2xl border border-white/10 p-6 text-center text-xs text-white/35">Adicione o primeiro documento para ativar esta base no chat.</div> : documents.map((document) => <div key={document.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3"><span className="rounded-xl bg-white/5 p-2 text-amber-300"><FileText className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold">{document.filename}</div><div className="mt-1 text-[10px] text-white/40">{formatBytes(document.sizeBytes)} • {document.chunkCount} parte(s) • {formatDate(document.createdAt)}</div></div><button type="button" onClick={() => void handleDeleteDocument(document)} disabled={Boolean(deletingId)} className="rounded-xl p-2 text-red-300/70 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-40" title="Excluir documento">{deletingId === document.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button></div>)}</div></section>

                {onSelectBaseForChat && <button type="button" onClick={handleUseInChat} disabled={isUploading || selectedBase.chunksCount < 1} className="froc-gold-button flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-45"><Sparkles className="h-4 w-4" /> Usar esta base no chat</button>}
              </div>
            ) : (
              <div className="flex min-h-[22rem] flex-col items-center justify-center text-center"><Database className="mb-3 h-10 w-10 text-amber-300/60" /><h3 className="text-sm font-black">Crie sua primeira Base de Conhecimento</h3><p className="mt-2 max-w-sm text-xs leading-relaxed text-white/40">Adicione documentos privados para a Froc.IA consultar informações reais durante a conversa.</p><button type="button" onClick={() => setIsCreating(true)} className="froc-gold-button mt-5 flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black"><Plus className="h-4 w-4" /> Criar primeira base</button></div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};