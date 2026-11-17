import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Code2,
  Download,
  Eye,
  FileCode2,
  FolderPlus,
  Maximize2,
  Monitor,
  Moon,
  RotateCw,
  ShieldCheck,
  Smartphone,
  Sun,
  Tablet,
  Trash2,
  Check,
  Copy,
  ArrowLeft,
  Loader2,
  Rocket,
  ExternalLink,
  ClipboardList,
} from 'lucide-react';
import type {
  DeviceViewport,
  StudioProject,
  WorkspaceView,
} from '../types';

interface TopBarProps {
  projects: StudioProject[];
  activeProject: StudioProject;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  workspaceView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  deviceViewport: DeviceViewport;
  onChangeDevice: (device: DeviceViewport) => void;
  onReloadPreview: () => void;
  onToggleFullscreen: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  hasFiles: boolean;
  auditIssuesCount: number;
  onExportZip: () => void;
  onExportSingleHtml: () => void;
  onCopyHtml: () => Promise<boolean>;
  /** Volta para a conversa da Froc.IA (o projeto continua salvo). */
  onClose?: () => void;
  /** Situação do salvamento automático. */
  saveState?: 'idle' | 'saving' | 'saved' | 'error';
  /** Publicar o site com link próprio. */
  onPublish?: () => void;
  publishState?: 'idle' | 'publishing' | 'error';
  productionUrl?: string | null;
  /** Janela "Dados do site" (WhatsApp, endereço, redes...). */
  onOpenSiteData?: () => void;
  siteDataMissing?: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
  workspaceView,
  onChangeView,
  deviceViewport,
  onChangeDevice,
  onReloadPreview,
  onToggleFullscreen,
  isDark,
  onToggleTheme,
  hasFiles,
  auditIssuesCount,
  onExportZip,
  onExportSingleHtml,
  onCopyHtml,
  onClose,
  saveState = 'idle',
  onPublish,
  publishState = 'idle',
  productionUrl,
  onOpenSiteData,
  siteDataMissing = 0,
}) => {
  const [projectsMenuOpen, setProjectsMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(activeProject.name);
  const [copiedHtml, setCopiedHtml] = useState(false);

  const projectsMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNameDraft(activeProject.name);
  }, [activeProject.id, activeProject.name]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        projectsMenuRef.current &&
        !projectsMenuRef.current.contains(e.target as Node)
      ) {
        setProjectsMenuOpen(false);
      }
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(e.target as Node)
      ) {
        setExportMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const commitRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== activeProject.name) {
      onRenameProject(activeProject.id, trimmed);
    } else {
      setNameDraft(activeProject.name);
    }
    setEditingName(false);
  };

  const handleCopyHtmlClick = async () => {
    const ok = await onCopyHtml();
    if (ok) {
      setCopiedHtml(true);
      setTimeout(() => {
        setCopiedHtml(false);
        setExportMenuOpen(false);
      }, 1200);
    }
  };

  return (
    <header className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E131D] px-4 flex items-center justify-between gap-4 z-30">
      {/* Left Zone: Brand + Project Switcher */}
      <div className="flex items-center gap-3 min-w-0">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Voltar para a Froc.IA (o projeto fica salvo)"
            aria-label="Voltar para a Froc.IA"
            className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-md bg-blue-600 text-white flex items-center justify-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h16" />
              <path d="M4 12h10" />
              <path d="M4 17h16" />
              <path d="M18 10l3 2-3 2" />
            </svg>
          </div>
          <span className="font-display font-semibold text-base tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            Froc.IA Studio
          </span>
        </div>

        <span
          className="text-slate-300 dark:text-slate-700 select-none hidden sm:inline"
          aria-hidden="true"
        >
          /
        </span>

        {/* Project Selector / Inline Rename */}
        <div className="relative min-w-0" ref={projectsMenuRef}>
          {editingName ? (
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setNameDraft(activeProject.name);
                  setEditingName(false);
                }
              }}
              autoFocus
              aria-label="Nome do projeto"
              className="px-2.5 py-1 text-sm font-medium rounded-md border border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 outline-none w-44 sm:w-56"
            />
          ) : (
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setProjectsMenuOpen((v) => !v)}
                onDoubleClick={() => setEditingName(true)}
                title="Alternar projeto (duplo clique para renomear)"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors max-w-[180px] sm:max-w-[240px]"
              >
                <span className="truncate">{activeProject.name}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
            </div>
          )}

          {projectsMenuOpen && (
            <div className="absolute left-0 mt-1.5 w-72 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121824] shadow-lg py-1.5 z-50">
              <div className="px-3 py-1.5 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Projetos salvos ({projects.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onCreateProject();
                    setProjectsMenuOpen(false);
                  }}
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  Novo Projeto
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {projects.map((p) => {
                  const isActive = p.id === activeProject.id;
                  const fileCount = Object.keys(p.files).length;
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectProject(p.id);
                          setProjectsMenuOpen(false);
                        }}
                        className="flex-1 text-left min-w-0 pr-2"
                      >
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          {fileCount > 0
                            ? `${fileCount} arquivos`
                            : 'Projeto vazio'}
                        </div>
                      </button>
                      {projects.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteProject(p.id);
                          }}
                          aria-label={`Excluir projeto ${p.name}`}
                          className="p-1.5 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="px-3 pt-1.5 pb-1 border-t border-slate-100 dark:border-slate-800/80">
                <button
                  type="button"
                  onClick={() => {
                    setProjectsMenuOpen(false);
                    setEditingName(true);
                  }}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                >
                  Renomear projeto atual
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center Zone: Segmented Workspace View Switcher */}
      <nav
        aria-label="Modo de visualização do estúdio"
        className="hidden md:flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800"
      >
        <button
          type="button"
          onClick={() => onChangeView('preview')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
            workspaceView === 'preview'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          Visualização
        </button>
        <button
          type="button"
          onClick={() => onChangeView('code')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
            workspaceView === 'code'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          Código
        </button>
        <button
          type="button"
          onClick={() => onChangeView('audit')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
            workspaceView === 'audit'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Auditoria{hasFiles && auditIssuesCount > 0 ? ` (${auditIssuesCount})` : ''}
        </button>
      </nav>

      {/* Right Zone: Device Viewport + Theme + Export */}
      <div className="flex items-center gap-2 shrink-0">
        {saveState !== 'idle' && (
          <span
            className={`hidden sm:flex items-center gap-1 text-xs whitespace-nowrap ${
              saveState === 'error' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
            }`}
            aria-live="polite"
          >
            {saveState === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {saveState === 'saving' ? 'Salvando' : saveState === 'saved' ? 'Salvo' : 'Não salvou'}
          </span>
        )}
        {workspaceView === 'preview' && hasFiles && (
          <div className="hidden lg:flex items-center gap-0.5 p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80">
            <button
              type="button"
              onClick={() => onChangeDevice('desktop')}
              title="Visualização Desktop"
              aria-label="Visualização Desktop"
              className={`p-1.5 rounded transition-colors ${
                deviceViewport === 'desktop'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChangeDevice('tablet')}
              title="Visualização Tablet (768px)"
              aria-label="Visualização Tablet"
              className={`p-1.5 rounded transition-colors ${
                deviceViewport === 'tablet'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Tablet className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChangeDevice('mobile')}
              title="Visualização Mobile (390px)"
              aria-label="Visualização Mobile"
              className={`p-1.5 rounded transition-colors ${
                deviceViewport === 'mobile'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-slate-200 dark:bg-slate-800 mx-0.5" />
            <button
              type="button"
              onClick={onReloadPreview}
              title="Recarregar pré-visualização"
              aria-label="Recarregar pré-visualização"
              className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleFullscreen}
              title="Tela cheia"
              aria-label="Abrir pré-visualização em tela cheia"
              className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleTheme}
          title={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {onOpenSiteData && (
          <button
            type="button"
            onClick={onOpenSiteData}
            title={siteDataMissing > 0 ? `${siteDataMissing} dado(s) do site ainda em branco` : 'Dados do site (WhatsApp, endereço, redes)'}
            className="relative flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Dados do site</span>
            {siteDataMissing > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-[10px] font-bold leading-[18px] text-white text-center tabular-nums">
                {siteDataMissing}
              </span>
            )}
          </button>
        )}

        {/* Primary Export Action */}
        <div className="relative" ref={exportMenuRef}>
          <button
            type="button"
            disabled={!hasFiles}
            onClick={() => setExportMenuOpen((v) => !v)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-45 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0 ${
              onPublish
                ? 'border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span className={onPublish ? 'hidden xl:inline' : ''}>Exportar Produção</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-80" />
          </button>

          {exportMenuOpen && hasFiles && (
            <div className="absolute right-0 mt-1.5 w-72 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121824] shadow-xl p-1.5 z-50">
              <button
                type="button"
                onClick={() => {
                  onExportZip();
                  setExportMenuOpen(false);
                }}
                className="w-full text-left px-3 py-2.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors flex items-start gap-2.5"
              >
                <Download className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Baixar Pacote Completo (.zip)
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    Inclui HTML, CSS, JS, vercel.json, netlify.toml, SEO e README prontos para deploy.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onExportSingleHtml();
                  setExportMenuOpen(false);
                }}
                className="w-full text-left px-3 py-2.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors flex items-start gap-2.5"
              >
                <FileCode2 className="w-4 h-4 text-slate-600 dark:text-slate-300 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Baixar HTML Único (.html)
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    Arquivo único autocontido para abrir no navegador ou subir direto no Netlify Drop.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={handleCopyHtmlClick}
                className="w-full text-left px-3 py-2.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors flex items-start gap-2.5"
              >
                {copiedHtml ? (
                  <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-600 dark:text-slate-300 mt-0.5 shrink-0" />
                )}
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {copiedHtml ? 'HTML copiado!' : 'Copiar HTML Completo'}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Copia o código de produção unificado para a área de transferência.
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Publicar: coloca o site no ar com link próprio (publicar de novo atualiza o mesmo link). */}
        {productionUrl && (
          <a
            href={productionUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Site no ar: ${productionUrl}`}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">No ar</span>
          </a>
        )}
        {onPublish && (
          <button
            type="button"
            disabled={!hasFiles || publishState === 'publishing'}
            onClick={onPublish}
            title={productionUrl ? 'Atualizar o site no ar (mesmo link)' : 'Colocar o site no ar com link próprio'}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-45 disabled:pointer-events-none text-white transition-colors whitespace-nowrap shrink-0"
          >
            {publishState === 'publishing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
            <span>{publishState === 'publishing' ? 'Publicando…' : productionUrl ? 'Atualizar' : 'Publicar'}</span>
          </button>
        )}
      </div>
    </header>
  );
};
