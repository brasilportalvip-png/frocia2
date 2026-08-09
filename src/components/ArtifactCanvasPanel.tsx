import React, { useEffect, useState } from 'react';
import {
  X,
  Maximize2,
  Minimize2,
  FileCode2,
  FileText,
  Layout,
  Table,
  Presentation,
  Check,
  Copy,
  Edit3
} from 'lucide-react';
import { ArtifactData } from '../types';

interface ArtifactCanvasPanelProps {
  isOpen: boolean;
  onClose: () => void;
  artifact: ArtifactData | null;
  onUpdateArtifact: (updated: ArtifactData) => void;
  onRequestPartialEdit: (
    selectedText: string,
    instruction: string
  ) => void;
}

export const ArtifactCanvasPanel: React.FC<
  ArtifactCanvasPanelProps
> = ({
  isOpen,
  onClose,
  artifact,
  onUpdateArtifact,
  onRequestPartialEdit
}) => {
  const [isFullscreen, setIsFullscreen] =
    useState<boolean>(false);
  const [activeTab, setActiveTab] =
    useState<'editor' | 'preview'>('editor');
  const [editableCode, setEditableCode] =
    useState<string>('');
  const [selectedText, setSelectedText] =
    useState<string>('');
  const [partialInstruction, setPartialInstruction] =
    useState<string>('');
  const [showPartialEditBox, setShowPartialEditBox] =
    useState<boolean>(false);
  const [copied, setCopied] =
    useState<boolean>(false);

  useEffect(() => {
    setEditableCode(artifact?.content || '');
    setSelectedText('');
    setPartialInstruction('');
    setShowPartialEditBox(false);
  }, [artifact?.id, artifact?.content]);

  if (!isOpen || !artifact) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editableCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleEditorSelection = (
    event: React.SyntheticEvent<HTMLTextAreaElement>
  ) => {
    const textarea = event.currentTarget;
    const selection = textarea.value
      .slice(
        textarea.selectionStart,
        textarea.selectionEnd
      )
      .trim();

    if (selection) {
      setSelectedText(selection);
      setShowPartialEditBox(true);
    }
  };

  const handleConfirmPartialEdit = () => {
    const instruction = partialInstruction.trim();

    if (!selectedText || !instruction) return;

    onRequestPartialEdit(selectedText, instruction);
    setShowPartialEditBox(false);
    setPartialInstruction('');
    setSelectedText('');
  };

  const handleCodeChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const content = event.target.value;

    setEditableCode(content);
    onUpdateArtifact({
      ...artifact,
      content,
      htmlPreview: content
    });
  };

  return (
    <div
      className={`fixed md:relative top-0 right-0 z-40 bg-slate-950 border-l border-white/10 flex flex-col transition-all duration-300 shadow-2xl ${
        isFullscreen
          ? 'fixed inset-0 z-50 w-full h-full'
          : 'w-full md:w-[600px] lg:w-[720px] h-full'
      }`}
    >
      <div className="h-14 bg-black/60 border-b border-white/10 px-4 flex items-center justify-between shrink-0 text-white">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-md">
            {artifact.type === 'code' ? (
              <FileCode2 className="w-4 h-4" />
            ) : artifact.type === 'site' ||
              artifact.type === 'app' ? (
              <Layout className="w-4 h-4" />
            ) : artifact.type === 'sheet' ? (
              <Table className="w-4 h-4" />
            ) : artifact.type === 'presentation' ? (
              <Presentation className="w-4 h-4" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
          </div>

          <div className="truncate">
            <h3 className="text-xs font-bold text-white truncate">
              {artifact.title}
            </h3>
            <span className="text-[10px] text-white/50 font-mono">
              Espaço de Trabalho / Artefato Froc.IA
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="hidden sm:flex items-center bg-white/5 p-1 rounded-xl border border-white/10 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('editor')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                activeTab === 'editor'
                  ? 'bg-blue-600 text-white font-bold'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Editor
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                activeTab === 'preview'
                  ? 'bg-blue-600 text-white font-bold'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Prévia
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="p-2 rounded-xl glass-button text-white/70 hover:text-white"
            title="Copiar conteúdo"
            aria-label="Copiar conteúdo"
          >
            {copied ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              setIsFullscreen((current) => !current)
            }
            className="p-2 rounded-xl glass-button text-white/70 hover:text-white"
            title={
              isFullscreen
                ? 'Sair da tela cheia'
                : 'Expandir tela cheia'
            }
            aria-label={
              isFullscreen
                ? 'Sair da tela cheia'
                : 'Expandir tela cheia'
            }
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl glass-button text-white/70 hover:text-white"
            title="Fechar"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col relative">
        {showPartialEditBox && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md bg-slate-900 border border-amber-500/40 rounded-2xl p-3 shadow-2xl space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-amber-300">
              <span className="flex items-center gap-1.5">
                <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  Pedir alteração neste trecho
                </span>
              </span>

              <button
                type="button"
                onClick={() =>
                  setShowPartialEditBox(false)
                }
                className="text-white/50 hover:text-white"
                aria-label="Fechar edição parcial"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-[11px] text-white/70 italic truncate bg-black/40 p-1.5 rounded-lg border border-white/5 font-mono">
              "{selectedText}"
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                value={partialInstruction}
                onChange={(event) =>
                  setPartialInstruction(
                    event.target.value
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleConfirmPartialEdit();
                  }
                }}
                placeholder="Descreva a alteração desejada..."
                className="flex-1 px-3 py-1.5 text-xs glass-input rounded-xl focus:outline-none"
              />

              <button
                type="button"
                onClick={handleConfirmPartialEdit}
                disabled={
                  !selectedText ||
                  !partialInstruction.trim()
                }
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-bold text-xs shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Refinar
              </button>
            </div>
          </div>
        )}

        {activeTab === 'editor' && (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col bg-slate-950 p-4 font-mono text-xs text-cyan-200 overflow-auto custom-scrollbar">
              <textarea
                value={editableCode}
                onChange={handleCodeChange}
                onSelect={handleEditorSelection}
                className="w-full h-full bg-transparent resize-none focus:outline-none leading-relaxed text-cyan-100"
                spellCheck={false}
                aria-label="Editor do artefato"
              />
            </div>
          </div>
        )}

        {activeTab === 'preview' && (
          <div className="flex-1 bg-white overflow-hidden relative">
            <iframe
              srcDoc={editableCode}
              title="Prévia segura do artefato"
              className="w-full h-full border-none"
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
      </div>
    </div>
  );
};