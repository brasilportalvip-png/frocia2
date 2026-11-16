import React, { useRef, useEffect } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  FileCode2,
  Loader2,
  Square,
  Wrench,
} from 'lucide-react';
import type {
  BuildMode,
  ChatMessage,
  DesignPreset,
  RuntimeErrorEvent,
} from '../types';
import { STARTER_BLUEPRINTS } from '../utils/starterTemplates';

interface ChatArchitectProps {
  messages: ChatMessage[];
  promptInput: string;
  onChangePrompt: (val: string) => void;
  onSubmitPrompt: (overridePrompt?: string) => void;
  onStopStreaming: () => void;
  isGenerating: boolean;
  buildMode: BuildMode;
  onChangeBuildMode: (mode: BuildMode) => void;
  designPreset: DesignPreset;
  onChangeDesignPreset: (preset: DesignPreset) => void;
  onInspectFile: (path: string) => void;
  runtimeError: RuntimeErrorEvent | null;
  onAutoFixRuntimeError: () => void;
  onDismissRuntimeError: () => void;
  /** Custo em créditos (criar / alterar), mostrado antes de enviar. */
  creditCost?: { create: number; edit: number } | null;
}

const PRESET_LABELS: Array<{ id: DesignPreset; label: string }> = [
  { id: 'auto', label: 'Estilo Automático' },
  { id: 'editorial-light', label: 'Editorial Claro' },
  { id: 'corporate-dark', label: 'Dark Corporativo' },
  { id: 'commerce-minimal', label: 'Comércio Minimalista' },
];

export const ChatArchitect: React.FC<ChatArchitectProps> = ({
  messages,
  promptInput,
  onChangePrompt,
  onSubmitPrompt,
  onStopStreaming,
  isGenerating,
  buildMode,
  onChangeBuildMode,
  designPreset,
  onChangeDesignPreset,
  onInspectFile,
  runtimeError,
  onAutoFixRuntimeError,
  onDismissRuntimeError,
  creditCost,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating && promptInput.trim()) {
        onSubmitPrompt();
      }
    }
  };

  return (
    <aside className="flex flex-col h-full bg-white dark:bg-[#0E131D] border-r border-slate-200 dark:border-slate-800/90">
      {/* Scrollable Conversation & Build Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {messages.length === 0 ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                O que vamos construir para produção hoje?
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Descreva o site, sistema ou loja que precisa. O arquiteto gera componentes React + TypeScript + Tailwind completos, compila automaticamente e entrega o projeto pronto para publicar sem precisar editar.
              </p>
            </div>

            <div className="space-y-2.5">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Modelos prontos para iniciar
              </div>
              <div className="space-y-2">
                {STARTER_BLUEPRINTS.map((bp) => (
                  <button
                    key={bp.id}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => onSubmitPrompt(bp.prompt)}
                    className="w-full text-left p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-blue-500/60 dark:hover:border-blue-500/60 bg-slate-50/70 dark:bg-slate-900/50 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors group"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                      {bp.category}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {bp.title}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      {bp.summary}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[90%] rounded-lg px-3.5 py-2.5 bg-blue-600 text-white text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="space-y-3">
                {/* Active Phase / Status Header */}
                {msg.phase && msg.phase !== 'done' && msg.phase !== 'error' && (
                  <div className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>{msg.phaseLabel || 'Construindo aplicação...'}</span>
                  </div>
                )}

                {msg.phase === 'done' && (
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Projeto pronto para produção</span>
                  </div>
                )}

                {/* Architect Plan */}
                {msg.plan && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3 text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                      Plano de Arquitetura
                    </div>
                    {msg.plan}
                  </div>
                )}

                {/* Streamed Files List */}
                {msg.files && msg.files.length > 0 && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800 overflow-hidden bg-white dark:bg-[#111723]">
                    {msg.files.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => onInspectFile(file.path)}
                        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {file.status === 'writing' ? (
                            <Loader2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                          ) : (
                            <FileCode2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          )}
                          <span className="font-mono text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                            {file.path}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                          {file.lines} linhas
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Revisão dos especialistas */}
                {msg.review && msg.review.length > 0 && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3 text-xs text-slate-700 dark:text-slate-300 space-y-2">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">Revisão dos especialistas</div>
                    {msg.review.map((r) => (
                      <div key={r.id} className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          {r.status === 'ok' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : r.status === 'issues' ? (
                            <Wrench className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                          <span className="font-medium">{r.name}</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {r.status === 'ok' ? '· tudo certo' : r.status === 'issues' ? `· ${r.issues.length} ponto(s)` : '· não respondeu a tempo'}
                          </span>
                        </div>
                        {r.issues.length > 0 && (
                          <ul className="pl-5 space-y-0.5 list-disc text-slate-600 dark:text-slate-400">
                            {r.issues.map((i, n) => (
                              <li key={n}>
                                {i.problem}
                                {i.severity === 'baixa' ? ' (sugestão)' : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Summary Prose */}
                {(msg.summary || msg.content) && (
                  <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {msg.summary || msg.content}
                  </div>
                )}

                {/* Error Message */}
                {msg.error && (
                  <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="leading-relaxed">{msg.error}</div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Live Preview Runtime Error Auto-Fix Banner */}
      {runtimeError && (
        <div className="mx-4 mb-2 rounded-lg border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Erro detectado na pré-visualização</div>
                <div className="font-mono text-[11px] mt-0.5 break-all">
                  {runtimeError.message}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onDismissRuntimeError}
              className="text-xs text-amber-700 dark:text-amber-400 hover:underline shrink-0"
            >
              Ignorar
            </button>
          </div>
          <button
            type="button"
            disabled={isGenerating}
            onClick={onAutoFixRuntimeError}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Wrench className="w-3.5 h-3.5" />
            Corrigir Automaticamente com IA
          </button>
        </div>
      )}

      {/* Prompt Composer */}
      <div className="p-3.5 border-t border-slate-200 dark:border-slate-800/90 bg-slate-50/60 dark:bg-[#0B0F17]">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111723] focus-within:border-blue-500 dark:focus-within:border-blue-500 transition-colors p-2.5 space-y-2.5">
          <textarea
            ref={textareaRef}
            rows={3}
            value={promptInput}
            onChange={(e) => onChangePrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating}
            placeholder={
              messages.length === 0
                ? 'Descreva o site completo que deseja criar (ex: loja de cafés especiais com carrinho e assinatura)...'
                : 'Peça uma nova seção, ajuste de layout ou nova funcionalidade...'
            }
            aria-label="Descreva o site ou ajuste desejado"
            className="w-full resize-none bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none leading-relaxed"
          />

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-1.5 min-w-0">
              {/* Build Depth Mode */}
              <div className="flex items-center p-0.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={() => onChangeBuildMode('full')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    buildMode === 'full'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  Completo
                </button>
                <button
                  type="button"
                  onClick={() => onChangeBuildMode('quick')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    buildMode === 'quick'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  Rápido
                </button>
              </div>

              {/* Aesthetic Preset Select */}
              <select
                value={designPreset}
                onChange={(e) => onChangeDesignPreset(e.target.value as DesignPreset)}
                aria-label="Direção visual"
                className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-300 outline-none max-w-[130px] truncate"
              >
                {PRESET_LABELS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {isGenerating ? (
              <button
                type="button"
                onClick={onStopStreaming}
                aria-label="Parar geração"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-medium transition-colors shrink-0"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Parar</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!promptInput.trim()}
                onClick={() => onSubmitPrompt()}
                aria-label="Construir site"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-semibold transition-colors shrink-0"
              >
                <span>Gerar Site</span>
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        {creditCost && (
          <p className="mt-2 px-1 text-[11px] text-slate-500 dark:text-slate-400">
            {messages.length === 0 ? `Criar o site: ${creditCost.create} créditos` : `Cada alteração: ${creditCost.edit} créditos`} · se der erro, os créditos voltam.
          </p>
        )}
      </div>
    </aside>
  );
};
