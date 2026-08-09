import React, { useEffect, useMemo, useState } from 'react';
import { Check, Code2, FileCode2, Loader2, ShieldCheck, X } from 'lucide-react';
import { createTextAttachment } from '../services/attachmentService';
import { UploadedFile } from '../types';

interface CodeSnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddCode: (file: UploadedFile) => void;
}

const LANGUAGES = [
  { id: 'html', name: 'HTML5 / Web', mime: 'text/html', extension: 'html' },
  { id: 'tsx', name: 'React TSX', mime: 'text/plain', extension: 'tsx' },
  { id: 'jsx', name: 'React JSX', mime: 'text/plain', extension: 'jsx' },
  { id: 'typescript', name: 'TypeScript', mime: 'text/plain', extension: 'ts' },
  { id: 'javascript', name: 'JavaScript', mime: 'text/plain', extension: 'js' },
  { id: 'css', name: 'CSS / Tailwind', mime: 'text/css', extension: 'css' },
  { id: 'json', name: 'JSON', mime: 'application/json', extension: 'json' },
  { id: 'sql', name: 'SQL', mime: 'text/plain', extension: 'sql' },
  { id: 'python', name: 'Python', mime: 'text/plain', extension: 'py' },
  { id: 'yaml', name: 'YAML', mime: 'text/plain', extension: 'yaml' },
  { id: 'markdown', name: 'Markdown', mime: 'text/markdown', extension: 'md' },
  { id: 'text', name: 'Texto simples', mime: 'text/plain', extension: 'txt' }
] as const;

const DEFAULT_LANGUAGE = 'tsx';
const DEFAULT_FILENAME = 'snippet-codigo.tsx';

function filenameWithoutExtension(filename: string): string {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf('.');
  return lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
}

export const CodeSnippetModal: React.FC<CodeSnippetModalProps> = ({
  isOpen,
  onClose,
  onAddCode
}) => {
  const [snippetTitle, setSnippetTitle] = useState(DEFAULT_FILENAME);
  const [selectedLanguage, setSelectedLanguage] = useState(DEFAULT_LANGUAGE);
  const [codeContent, setCodeContent] = useState('');
  const [isPreparingFile, setIsPreparingFile] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const language = useMemo(
    () =>
      LANGUAGES.find((item) => item.id === selectedLanguage) ?? LANGUAGES[0],
    [selectedLanguage]
  );

  const resetForm = () => {
    setSnippetTitle(DEFAULT_FILENAME);
    setSelectedLanguage(DEFAULT_LANGUAGE);
    setCodeContent('');
    setIsPreparingFile(false);
    setFormError(null);
  };

  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen]);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleLanguageChange = (languageId: string) => {
    const nextLanguage =
      LANGUAGES.find((item) => item.id === languageId) ?? LANGUAGES[0];
    const baseName = filenameWithoutExtension(snippetTitle) || 'snippet-codigo';

    setSelectedLanguage(nextLanguage.id);
    setSnippetTitle(`${baseName}.${nextLanguage.extension}`);
    setFormError(null);
  };

  const handleConfirm = async () => {
    if (!codeContent.trim() || isPreparingFile) return;

    setIsPreparingFile(true);
    setFormError(null);

    try {
      const baseName = filenameWithoutExtension(snippetTitle) || 'snippet-codigo';
      const filename = `${baseName}.${language.extension}`;
      const file = await createTextAttachment({
        name: filename,
        content: codeContent,
        mimeType: language.mime,
        source: 'code',
        type: 'code'
      });

      onAddCode(file);
      handleClose();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar o código para envio.'
      );
    } finally {
      setIsPreparingFile(false);
    }
  };

  if (!isOpen) return null;

  const lineCount = codeContent ? codeContent.split('\n').length : 0;
  const byteCount = new TextEncoder().encode(codeContent).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xl">
      <div className="relative w-full max-w-xl space-y-5 rounded-[32px] border border-amber-400/20 bg-zinc-950 p-6 text-white shadow-2xl shadow-amber-500/10">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-200 text-black shadow-lg shadow-amber-500/20">
              <Code2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Adicionar código</h3>
              <p className="text-xs text-white/60">
                Envie código ou configuração real para análise da Froc.IA
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isPreparingFile}
            aria-label="Fechar editor de código"
            className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="snippet-filename"
              className="mb-1.5 block text-xs font-semibold text-white/80"
            >
              Nome do arquivo
            </label>
            <div className="relative">
              <FileCode2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-300/70" />
              <input
                id="snippet-filename"
                type="text"
                value={snippetTitle}
                maxLength={170}
                onChange={(event) => {
                  setSnippetTitle(event.target.value);
                  setFormError(null);
                }}
                placeholder="ComponenteHero.tsx"
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-3.5 text-xs text-white outline-none transition placeholder:text-white/30 focus:border-amber-400/50"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="snippet-language"
              className="mb-1.5 block text-xs font-semibold text-white/80"
            >
              Linguagem
            </label>
            <select
              id="snippet-language"
              value={selectedLanguage}
              onChange={(event) => handleLanguageChange(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-white outline-none transition focus:border-amber-400/50"
            >
              {LANGUAGES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label
              htmlFor="snippet-content"
              className="text-xs font-semibold text-white/80"
            >
              Código ou configuração
            </label>
            <span className="text-[11px] text-white/40">
              {lineCount} linhas · {byteCount.toLocaleString('pt-BR')} bytes
            </span>
          </div>
          <textarea
            id="snippet-content"
            value={codeContent}
            onChange={(event) => {
              setCodeContent(event.target.value);
              setFormError(null);
            }}
            placeholder="// Cole aqui o conteúdo que deseja analisar..."
            rows={12}
            spellCheck={false}
            className="w-full resize-y rounded-2xl border border-white/10 bg-black/60 p-4 font-mono text-xs leading-relaxed text-amber-100 outline-none transition placeholder:text-white/25 focus:border-amber-400/50"
          />
        </div>

        <div className="flex items-start gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs text-emerald-100">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p>
            O conteúdo completo será enviado com tamanho real, codificação Base64 e hash SHA-256 verificado.
          </p>
        </div>

        {formError && (
          <p role="alert" className="text-xs font-medium text-red-300">
            {formError}
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
            onClick={() => void handleConfirm()}
            disabled={!codeContent.trim() || isPreparingFile}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-300 px-5 py-2.5 text-xs font-extrabold text-black shadow-lg shadow-amber-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPreparingFile ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {isPreparingFile ? 'Validando...' : 'Anexar código'}
          </button>
        </div>
      </div>
    </div>
  );
};