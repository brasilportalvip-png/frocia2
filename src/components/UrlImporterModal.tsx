import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Github,
  Globe,
  Loader2,
  ShieldCheck,
  X
} from 'lucide-react';
import { getIdToken } from '../lib/firebase';
import { createTextAttachment } from '../services/attachmentService';
import { UploadedFile } from '../types';

interface UrlImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (file: UploadedFile) => void;
  defaultType?: 'url' | 'github';
}

interface ImportedContent {
  type: 'url' | 'github';
  sourceUrl: string;
  finalUrl: string;
  title: string;
  summary: string;
  content: string;
  mimeType: 'text/plain' | 'application/json';
  structure: string[];
  fetchedAt: string;
}

interface ImportResponse {
  imported: ImportedContent;
}

function safeFilenamePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'conteudo-importado';
}

function filenameForImport(imported: ImportedContent): string {
  if (imported.type === 'github') {
    return `github-${safeFilenamePart(imported.title)}.json`;
  }

  try {
    const hostname = new URL(imported.finalUrl).hostname;
    return `pagina-${safeFilenamePart(hostname)}.txt`;
  } catch {
    return `pagina-${safeFilenamePart(imported.title)}.txt`;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as
    | { error?: string | { message?: string } }
    | null;

  if (typeof payload?.error === 'string') return payload.error;
  if (payload?.error && typeof payload.error.message === 'string') {
    return payload.error.message;
  }
  return `Não foi possível importar o endereço (${response.status}).`;
}

export const UrlImporterModal: React.FC<UrlImporterModalProps> = ({
  isOpen,
  onClose,
  onImport,
  defaultType = 'url'
}) => {
  const [importType, setImportType] = useState<'url' | 'github'>(defaultType);
  const [urlInput, setUrlInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPreparingFile, setIsPreparingFile] = useState(false);
  const [previewData, setPreviewData] = useState<ImportedContent | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  const resetModal = () => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setImportType(defaultType);
    setUrlInput('');
    setIsLoading(false);
    setIsPreparingFile(false);
    setPreviewData(null);
    setImportError(null);
  };

  useEffect(() => {
    if (isOpen) {
      setImportType(defaultType);
    } else {
      resetModal();
    }

    return () => requestControllerRef.current?.abort();
  }, [isOpen, defaultType]);

  const handleClose = () => {
    resetModal();
    onClose();
  };

  const handleTypeChange = (type: 'url' | 'github') => {
    requestControllerRef.current?.abort();
    setImportType(type);
    setUrlInput('');
    setPreviewData(null);
    setImportError(null);
    setIsLoading(false);
  };

  const handleFetchUrl = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedUrl = urlInput.trim();
    if (!normalizedUrl || isLoading) return;

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setIsLoading(true);
    setPreviewData(null);
    setImportError(null);

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error('Faça login para importar páginas ou repositórios.');
      }

      const response = await fetch('/api/imports/external', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ type: importType, url: normalizedUrl }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = await response.json() as ImportResponse;
      if (!payload.imported?.content) {
        throw new Error('O servidor não retornou conteúdo para anexar.');
      }

      setPreviewData(payload.imported);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setImportError(
        error instanceof Error
          ? error.message
          : 'Não foi possível analisar o endereço informado.'
      );
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const handleConfirmImport = async () => {
    if (!previewData || isPreparingFile) return;

    setIsPreparingFile(true);
    setImportError(null);

    try {
      const file = await createTextAttachment({
        name: filenameForImport(previewData),
        content: previewData.content,
        mimeType: previewData.mimeType,
        source: previewData.type,
        type: previewData.type
      });

      const importedFile: UploadedFile = {
        ...file,
        url: previewData.finalUrl,
        extractedSummary: previewData.summary,
        insights: {
          docType:
            previewData.type === 'github'
              ? 'Repositório público do GitHub'
              : 'Página pública da web',
          keyTopics: previewData.structure.slice(0, 20)
        }
      };

      onImport(importedFile);
      handleClose();
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar o conteúdo importado.'
      );
    } finally {
      setIsPreparingFile(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xl">
      <div className="relative w-full max-w-lg space-y-5 rounded-[32px] border border-amber-400/20 bg-zinc-950 p-6 text-white shadow-2xl shadow-amber-500/10">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-200 text-black shadow-lg shadow-amber-500/20">
              {importType === 'github' ? (
                <Github className="h-5 w-5" />
              ) : (
                <Globe className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold">
                {importType === 'github'
                  ? 'Importar repositório público'
                  : 'Importar página pública'}
              </h3>
              <p className="text-xs text-white/60">
                Conteúdo real validado pelo backend da Froc.IA
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isPreparingFile}
            aria-label="Fechar importador"
            className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => handleTypeChange('url')}
            disabled={isLoading || isPreparingFile}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 transition-all ${
              importType === 'url'
                ? 'bg-amber-400 font-bold text-black'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Globe className="h-3.5 w-3.5" /> Página web
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('github')}
            disabled={isLoading || isPreparingFile}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 transition-all ${
              importType === 'github'
                ? 'bg-amber-400 font-bold text-black'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Github className="h-3.5 w-3.5" /> GitHub público
          </button>
        </div>

        <form onSubmit={(event) => void handleFetchUrl(event)} className="space-y-3">
          <div>
            <label
              htmlFor="external-import-url"
              className="mb-1.5 block text-xs font-semibold text-white/80"
            >
              {importType === 'github'
                ? 'URL do repositório público'
                : 'URL da página pública'}
            </label>
            <div className="flex gap-2">
              <input
                id="external-import-url"
                type="url"
                value={urlInput}
                maxLength={2048}
                onChange={(event) => {
                  setUrlInput(event.target.value);
                  setPreviewData(null);
                  setImportError(null);
                }}
                placeholder={
                  importType === 'github'
                    ? 'https://github.com/usuario/repositorio'
                    : 'https://exemplo.com/pagina'
                }
                required
                disabled={isLoading || isPreparingFile}
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white outline-none transition placeholder:text-white/30 focus:border-amber-400/50 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || isPreparingFile || !urlInput.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-300 px-5 py-3 text-xs font-extrabold text-black shadow-lg shadow-amber-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {isLoading ? 'Analisando...' : 'Analisar'}
              </button>
            </div>
          </div>
        </form>

        {previewData && (
          <div className="space-y-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
            <div className="flex items-start gap-2 text-xs font-bold text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{previewData.title}</span>
            </div>
            <p className="text-xs leading-relaxed text-white/70">
              {previewData.summary}
            </p>

            {previewData.structure.length > 0 && (
              <div className="border-t border-white/10 pt-2">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/40">
                  Estrutura encontrada
                </span>
                <div className="max-h-28 space-y-1 overflow-y-auto">
                  {previewData.structure.slice(0, 12).map((item) => (
                    <div
                      key={item}
                      className="truncate rounded-lg bg-white/5 px-2.5 py-1 font-mono text-[10px] text-white/75"
                      title={item}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 border-t border-white/10 pt-3 text-[11px] text-white/55">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span>
                Fonte verificada pelo backend. O conteúdo e o SHA-256 serão anexados somente após sua confirmação.
              </span>
            </div>
          </div>
        )}

        {importError && (
          <p role="alert" className="text-xs font-medium text-red-300">
            {importError}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPreparingFile}
            className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleConfirmImport()}
            disabled={!previewData || isLoading || isPreparingFile}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-300 px-5 py-2.5 text-xs font-extrabold text-black shadow-lg shadow-amber-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPreparingFile ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {isPreparingFile ? 'Validando...' : 'Anexar ao projeto'}
          </button>
        </div>
      </div>
    </div>
  );
};