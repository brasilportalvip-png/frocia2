import React, {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  CreditCard,
  Database,
  FileArchive,
  FolderOpen,
  Github,
  Globe,
  Headphones,
  Home,
  LayoutDashboard,
  LayoutTemplate,
  MessageSquare,
  Mic,
  Paperclip,
  Plug,
  Plus,
  Search,
  Send,
  Sparkles,
  WandSparkles,
  Wrench,
  X
} from 'lucide-react';
import {
  AppNavigationMode,
  ChatMessage,
  Conversation,
  GeneratedSite,
  KnowledgeBase,
  SiteTemplate,
  UploadedFile
} from '../types';
import { STARTER_TEMPLATES } from '../data/templates';
import { AttachmentMenu } from './AttachmentMenu';
import { CameraScannerModal } from './CameraScannerModal';
import { VoiceRecorderModal } from './VoiceRecorderModal';
import { UrlImporterModal } from './UrlImporterModal';
import { CodeSnippetModal } from './CodeSnippetModal';
import { ZipInspectorModal } from './ZipInspectorModal';
import { KnowledgeBaseModal } from './KnowledgeBaseModal';
import { MascotWidget } from './MascotWidget';

const WHATSAPP_SUPPORT_URL =
  'https://chat.whatsapp.com/JqXdWPrCVxz1NC9dXyMdso?s=cl&p=a&ilr=2&amv=1';

const TELEGRAM_SUPPORT_URL =
  'https://t.me/+EOUhr0Xa2_00NDQ5';

type SidebarSection =
  | 'history'
  | 'create'
  | 'templates'
  | 'tools';

interface SidebarProps {
  onGenerateSite: (data: {
    prompt: string;
    category: string;
    colorPalette: string;
    tone: string;
    features: string[];
  }, files?: UploadedFile[]) => Promise<void>;
  onRefineSite: (instruction: string) => Promise<void>;
  onSelectTemplate: (template: SiteTemplate) => void;
  onLoadSavedSite: (site: GeneratedSite) => void;
  onNewChat: () => void;
  isGenerating: boolean;
  isRefining: boolean;
  savedSites: GeneratedSite[];
  activeSite: GeneratedSite | null;
  chatMessages: ChatMessage[];
  conversations?: Conversation[];
  currentConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  conversationsLoading?: boolean;
  conversationsError?: string | null;
  onRetryConversations?: () => void;
  errorMsg: string | null;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  onNavigate?: (mode: AppNavigationMode) => void;
  isAdmin?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  onGenerateSite,
  onSelectTemplate,
  onLoadSavedSite,
  onNewChat,
  isGenerating,
  isRefining,
  savedSites,
  activeSite,
  conversations = [],
  currentConversationId = null,
  onSelectConversation,
  onDeleteConversation,
  conversationsLoading = false,
  conversationsError = null,
  onRetryConversations,
  errorMsg,
  isOpenMobile = false,
  onCloseMobile,
  onNavigate
}) => {
  const [historyTab, setHistoryTab] = useState<'conversations' | 'projects'>('conversations');
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpenMobile) {
        onCloseMobile?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpenMobile, onCloseMobile]);
  const [activeSection, setActiveSection] =
    useState<SidebarSection>('history');
  const [searchQuery, setSearchQuery] = useState('');

  const [prompt, setPrompt] = useState('');
  const [category, setCategory] =
    useState('Software / Tecnologia');
  const [colorPalette, setColorPalette] =
    useState('Preto, branco e dourado');
  const [tone, setTone] = useState('Profissional');
  const [selectedFeatures, setSelectedFeatures] =
    useState<string[]>([
      'Design responsivo',
      'Formulário de contato',
      'Área de apresentação'
    ]);

  const [attachedFiles, setAttachedFiles] =
    useState<UploadedFile[]>([]);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] =
    useState(false);
  const [toolNotice, setToolNotice] =
    useState<string | null>(null);

  const [isSupportOpen, setIsSupportOpen] =
    useState(false);
  const supportRef = useRef<HTMLDivElement>(null);

  const [isCameraOpen, setIsCameraOpen] =
    useState(false);
  const [isVoiceOpen, setIsVoiceOpen] =
    useState(false);
  const [isUrlModalOpen, setIsUrlModalOpen] =
    useState(false);
  const [urlModalDefaultType, setUrlModalDefaultType] =
    useState<'url' | 'github'>('url');
  const [isCodeModalOpen, setIsCodeModalOpen] =
    useState(false);
  const [isZipModalOpen, setIsZipModalOpen] =
    useState(false);
  const [selectedZipForInspect, setSelectedZipForInspect] =
    useState<UploadedFile | null>(null);
  const [isKbModalOpen, setIsKbModalOpen] =
    useState(false);
  const [knowledgeBases, setKnowledgeBases] =
    useState<KnowledgeBase[]>([]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        supportRef.current &&
        !supportRef.current.contains(event.target as Node)
      ) {
        setIsSupportOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSupportOpen(false);
        setIsAttachmentMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener(
        'mousedown',
        handlePointerDown
      );
      document.removeEventListener(
        'keydown',
        handleKeyDown
      );
    };
  }, []);

  const filteredSites = useMemo(() => {
    const normalizedQuery =
      searchQuery.trim().toLocaleLowerCase('pt-BR');

    return [...savedSites]
      .filter((site) => {
        if (!normalizedQuery) {
          return true;
        }

        return (
          site.title
            .toLocaleLowerCase('pt-BR')
            .includes(normalizedQuery) ||
          site.prompt
            .toLocaleLowerCase('pt-BR')
            .includes(normalizedQuery)
        );
      })
      .sort(
        (first, second) =>
          second.updatedAt - first.updatedAt
      );
  }, [savedSites, searchQuery]);

  const openSection = (section: SidebarSection) => {
    setActiveSection(section);
    setIsSupportOpen(false);

    if (isCollapsed) {
      setIsCollapsed(false);
    }
  };

  const navigate = (mode: AppNavigationMode) => {
    onNavigate?.(mode);
    setIsSupportOpen(false);
    onCloseMobile?.();
  };

  const handleNewConversation = () => {
    if (isGenerating || isRefining) {
      return;
    }

    onNewChat();
    setActiveSection('history');
    onCloseMobile?.();
  };

  const toggleFeature = (feature: string) => {
    setSelectedFeatures((current) =>
      current.includes(feature)
        ? current.filter((item) => item !== feature)
        : [...current, feature]
    );
  };

  const handleGenerate = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const normalizedPrompt = prompt.trim();

    if (!normalizedPrompt || isGenerating) {
      return;
    }

    await onGenerateSite({
      prompt: normalizedPrompt,
      category,
      colorPalette,
      tone,
      features: selectedFeatures
    }, attachedFiles);

    setPrompt('');
    setAttachedFiles([]);
  };

  const processNativeFiles = (files: File[]) => {
    const newFiles: UploadedFile[] = files.map(
      (file, index) => {
        const normalizedName = file.name.toLowerCase();
        const isZip =
          normalizedName.endsWith('.zip') ||
          normalizedName.endsWith('.tar.gz');
        const isImage = file.type.startsWith('image/');
        const isAudio = file.type.startsWith('audio/');
        const isVideo = file.type.startsWith('video/');

        return {
          id: `file-${Date.now()}-${index}`,
          name: file.name,
          size: file.size,
          type: isZip
            ? 'zip'
            : isImage
              ? 'image'
              : isAudio
                ? 'audio'
                : isVideo
                  ? 'video'
                  : 'document',
          status: 'ready',
          progress: 100,
          mime: file.type || 'application/octet-stream',
          dataUrl: isImage
            ? URL.createObjectURL(file)
            : undefined
        };
      }
    );

    setAttachedFiles((current) => [
      ...current,
      ...newFiles
    ]);

    const zipFile = newFiles.find(
      (file) => file.type === 'zip'
    );

    if (zipFile) {
      setSelectedZipForInspect(zipFile);
      setIsZipModalOpen(true);
    }

    setToolNotice(
      `${newFiles.length} arquivo(s) preparado(s) no laboratório.`
    );
  };

  const handleAttachmentOption = (optionId: string) => {
    setToolNotice(null);

    if (optionId === 'camera') {
      setIsCameraOpen(true);
      return;
    }

    if (optionId === 'mic') {
      setIsVoiceOpen(true);
      return;
    }

    if (optionId === 'url') {
      setUrlModalDefaultType('url');
      setIsUrlModalOpen(true);
      return;
    }

    if (optionId === 'github') {
      setUrlModalDefaultType('github');
      setIsUrlModalOpen(true);
      return;
    }

    if (optionId === 'code') {
      setIsCodeModalOpen(true);
      return;
    }

    if (optionId === 'project_files') {
      setIsKbModalOpen(true);
      return;
    }

    setToolNotice(
      'Esta ferramenta está preservada no laboratório e será conectada ao processamento real.'
    );
  };

  const menuItems: Array<{
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    active?: boolean;
    action: () => void;
  }> = [
        {
      id: 'home',
      label: 'Início',
      icon: Home,
      action: () => navigate('studio')
    },
    {
      id: 'dashboard',
      label: 'Meus projetos',
      icon: LayoutDashboard,
      action: () => navigate('dashboard')
    },
    {
      id: 'history',
      label: 'Conversas',
      icon: MessageSquare,
      active: activeSection === 'history',
      action: () => openSection('history')
    },
    {
      id: 'create',
      label: 'Criar projeto',
      icon: WandSparkles,
      active: activeSection === 'create',
      action: () => openSection('create')
    },
    {
      id: 'templates',
      label: 'Modelos',
      icon: LayoutTemplate,
      active: activeSection === 'templates',
      action: () => openSection('templates')
    },
    {
      id: 'tools',
      label: 'Ferramentas de IA',
      icon: Wrench,
      active: activeSection === 'tools',
      action: () => openSection('tools')
    },
    {
      id: 'integrations',
      label: 'Integrações',
      icon: Plug,
      action: () => navigate('integrations')
    },
    {
      id: 'pricing',
      label: 'Planos e créditos',
      icon: CreditCard,
      action: () => navigate('pricing')
    }
  ];

  return (
    <>
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-full select-none flex-col overflow-visible border-r border-amber-300/15 bg-[#070707] text-white shadow-[12px_0_45px_rgba(0,0,0,0.28)] transition-all duration-300 lg:relative lg:z-30 lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${
          isCollapsed
            ? 'w-[72px]'
            : 'w-[88vw] max-w-[320px] lg:w-[330px]'
        }`}
        aria-label="Menu principal da Froc.IA"
      >
        <div className="pointer-events-none absolute right-0 top-0 h-48 w-px bg-gradient-to-b from-amber-300/50 via-amber-300/10 to-transparent" />

        <div
          className={`flex min-h-20 shrink-0 items-center border-b border-white/8 ${
            isCollapsed
              ? 'justify-center px-2'
              : 'justify-between px-4'
          }`}
        >
          {!isCollapsed && (
            <div className="flex min-w-0 items-center gap-3">
              <MascotWidget
                size="sm"
                quote=""
                showBadge={false}
              />

              <div className="min-w-0">
                <div className="froc-gold-gradient-text truncate text-lg font-black tracking-tight">
                  Froc.IA
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-white/45">
                  <span className="froc-status-dot h-1.5 w-1.5 rounded-full bg-amber-300" />
                  <span>Inteligência ativa</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1">
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="glass-button rounded-xl p-2.5 lg:hidden text-white/60 hover:text-white"
                title="Fechar menu"
                aria-label="Fechar menu"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setIsCollapsed((current) => !current);
                setIsSupportOpen(false);
              }}
              className="glass-button hidden lg:flex rounded-xl p-2.5"
              title={
                isCollapsed
                  ? 'Expandir menu'
                  : 'Recolher menu'
              }
              aria-label={
                isCollapsed
                  ? 'Expandir menu'
                  : 'Recolher menu'
              }
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 text-amber-300" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

      <div className="shrink-0 p-3">
        <button
          type="button"
          onClick={handleNewConversation}
          disabled={isGenerating || isRefining}
          className={`froc-gold-button flex w-full items-center justify-center rounded-xl font-black ${
            isCollapsed
              ? 'h-11 px-0'
              : 'gap-2 px-4 py-3 text-xs'
          }`}
          title="Nova conversa"
        >
          <Plus className="h-4 w-4 stroke-[3]" />
          {!isCollapsed && <span>Nova conversa</span>}
        </button>
      </div>

      <nav className="custom-scrollbar shrink-0 space-y-1 overflow-y-auto px-3 pb-3">
        {menuItems.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              onClick={item.action}
              title={isCollapsed ? item.label : undefined}
              className={`flex w-full items-center rounded-xl border border-transparent text-left text-xs font-semibold transition-all ${
                isCollapsed
                  ? 'h-11 justify-center px-0'
                  : 'gap-3 px-3 py-2.5'
              } ${
                item.active
                  ? 'froc-menu-active'
                  : 'text-white/62 hover:border-white/8 hover:bg-white/[0.045] hover:text-white'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${
                  item.active
                    ? 'text-amber-300'
                    : 'text-white/55'
                }`}
              />

              {!isCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {!isCollapsed && (
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto border-t border-white/8 px-3 py-4">
          {activeSection === 'history' && (
            <section className="space-y-3">
              {/* History Sub-tabs */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/10">
                <button
                  type="button"
                  onClick={() => setHistoryTab('conversations')}
                  className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                    historyTab === 'conversations'
                      ? 'bg-amber-300/15 text-amber-300 border border-amber-300/30'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  Conversas ({conversations.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTab('projects')}
                  className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                    historyTab === 'projects'
                      ? 'bg-amber-300/15 text-amber-300 border border-amber-300/30'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  Projetos ({savedSites.length})
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-white/35" />

                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                  }}
                  placeholder={historyTab === 'conversations' ? "Pesquisar conversas..." : "Pesquisar projetos..."}
                  className="glass-input w-full rounded-xl py-2 pl-9 pr-8 text-xs"
                />

                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-white/40 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {historyTab === 'conversations' ? (
                <div className="space-y-1">
                  {conversationsLoading ? (
                    <div className="flex items-center justify-center py-8 text-white/40 gap-2">
                      <span className="animate-spin text-amber-300">⏳</span>
                      <span className="text-xs">Carregando conversas...</span>
                    </div>
                  ) : conversationsError ? (
                    <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs space-y-2 text-center">
                      <p>{conversationsError}</p>
                      {onRetryConversations && (
                        <button
                          type="button"
                          onClick={onRetryConversations}
                          className="px-3 py-1 rounded-lg bg-rose-500/30 hover:bg-rose-500/40 text-white text-[10px] font-bold"
                        >
                          Tentar novamente
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {conversations
                        .filter((conv) => {
                          const norm = searchQuery.trim().toLowerCase();
                          return !norm || conv.title.toLowerCase().includes(norm);
                        })
                        .map((conv) => (
                          <div
                            key={conv.id}
                            className={`group flex items-center justify-between rounded-xl border p-2 text-left text-xs transition-all ${
                              currentConversationId === conv.id
                                ? 'froc-menu-active border-amber-300/30'
                                : 'border-transparent text-white/60 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                onSelectConversation?.(conv.id);
                                onCloseMobile?.();
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 pr-1"
                            >
                              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-amber-300/80" />
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {conv.title || 'Nova Conversa'}
                              </span>
                            </button>

                            {onDeleteConversation && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteConversation(conv.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-white/40 hover:text-rose-300 transition-all"
                                title="Excluir conversa"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        ))}

                      {conversations.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-7 text-center text-[11px] text-white/35 space-y-2">
                          <p>{searchQuery ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa salva ainda.'}</p>
                          <button
                            type="button"
                            onClick={handleNewConversation}
                            className="px-3 py-1.5 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 text-[10px] font-bold"
                          >
                            Nova conversa
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredSites.map((site) => (
                    <button
                      key={site.id}
                      type="button"
                      onClick={() => {
                        onLoadSavedSite(site);
                        onCloseMobile?.();
                      }}
                      className={`flex w-full items-center gap-2 rounded-xl border p-2.5 text-left text-xs transition-all ${
                        activeSite?.id === site.id
                          ? 'froc-menu-active'
                          : 'border-transparent text-white/58 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-300/75" />
                      <span className="min-w-0 flex-1 truncate">
                        {site.title || 'Projeto sem título'}
                      </span>
                      {site.isFavorite && (
                        <span className="text-amber-300">★</span>
                      )}
                    </button>
                  ))}

                  {filteredSites.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-7 text-center text-[11px] text-white/35">
                      {searchQuery
                        ? 'Nenhum projeto encontrado.'
                        : 'Seus projetos aparecerão aqui.'}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {activeSection === 'create' && (
            <form
              onSubmit={(event) => {
                void handleGenerate(event);
              }}
              className="space-y-3"
            >
              <div>
                <h2 className="text-sm font-black text-white">
                  Criar projeto
                </h2>
                <p className="mt-1 text-[10px] leading-relaxed text-white/42">
                  Descreva sua ideia e escolha a identidade inicial.
                </p>
              </div>

              <textarea
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                }}
                rows={5}
                placeholder="Exemplo: crie uma plataforma moderna para..."
                className="glass-input w-full resize-none rounded-2xl p-3 text-xs leading-relaxed"
              />

              <select
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                }}
                className="glass-input w-full rounded-xl px-3 py-2.5 text-xs"
              >
                <option value="Software / Tecnologia">
                  Software / Tecnologia
                </option>
                <option value="Loja Virtual">
                  Loja virtual
                </option>
                <option value="Portfólio">
                  Portfólio
                </option>
                <option value="Aplicativo">
                  Aplicativo
                </option>
                <option value="Sistema empresarial">
                  Sistema empresarial
                </option>
              </select>

              <input
                value={colorPalette}
                onChange={(event) => {
                  setColorPalette(event.target.value);
                }}
                placeholder="Paleta de cores"
                className="glass-input w-full rounded-xl px-3 py-2.5 text-xs"
              />

              <select
                value={tone}
                onChange={(event) => {
                  setTone(event.target.value);
                }}
                className="glass-input w-full rounded-xl px-3 py-2.5 text-xs"
              >
                <option value="Profissional">
                  Profissional
                </option>
                <option value="Futurista">Futurista</option>
                <option value="Elegante">Elegante</option>
                <option value="Minimalista">
                  Minimalista
                </option>
              </select>

              <div className="space-y-1.5">
                {[
                  'Design responsivo',
                  'Formulário de contato',
                  'Área de apresentação',
                  'Planos e preços',
                  'Perguntas frequentes'
                ].map((feature) => (
                  <button
                    key={feature}
                    type="button"
                    onClick={() => toggleFeature(feature)}
                    className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] ${
                      selectedFeatures.includes(feature)
                        ? 'border-amber-300/30 bg-amber-300/10 text-white'
                        : 'border-white/8 bg-white/[0.025] text-white/52'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-md border ${
                        selectedFeatures.includes(feature)
                          ? 'border-amber-300 bg-amber-300 text-black'
                          : 'border-white/20'
                      }`}
                    >
                      {selectedFeatures.includes(feature) && (
                        <Check className="h-2.5 w-2.5 stroke-[3]" />
                      )}
                    </span>
                    <span>{feature}</span>
                  </button>
                ))}
              </div>

              <button
                type="submit"
                disabled={!prompt.trim() || isGenerating}
                className="froc-gold-button flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black"
              >
                <Send className="h-4 w-4" />
                <span>
                  {isGenerating
                    ? 'Criando...'
                    : 'Criar com Froc.IA'}
                </span>
              </button>
            </form>
          )}

          {activeSection === 'templates' && (
            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-black text-white">
                  Modelos iniciais
                </h2>
                <p className="mt-1 text-[10px] text-white/42">
                  Escolha uma base e personalize com a IA.
                </p>
              </div>

              <div className="space-y-2">
                {STARTER_TEMPLATES.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-xs text-white/40">
                    Nenhum modelo cadastrado.
                  </div>
                ) : (
                  STARTER_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => {
                        onSelectTemplate(template);
                        onCloseMobile?.();
                      }}
                      className="glass-card glass-panel-hover w-full rounded-2xl p-3 text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-bold text-white">
                          {template.title}
                        </span>
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-white/42">
                        {template.description}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </section>
          )}

          {activeSection === 'tools' && (
            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-black text-white">
                  Laboratório avançado
                </h2>
                <p className="mt-1 text-[10px] leading-relaxed text-white/42">
                  Ferramentas preservadas para integração completa.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ToolButton
                  icon={Camera}
                  label="Câmera"
                  onClick={() => setIsCameraOpen(true)}
                />
                <ToolButton
                  icon={Mic}
                  label="Voz"
                  onClick={() => setIsVoiceOpen(true)}
                />
                <ToolButton
                  icon={Code2}
                  label="Código"
                  onClick={() => setIsCodeModalOpen(true)}
                />
                <ToolButton
                  icon={FileArchive}
                  label="Projeto ZIP"
                  onClick={() =>
                    setIsAttachmentMenuOpen(true)
                  }
                />
                <ToolButton
                  icon={Globe}
                  label="Importar URL"
                  onClick={() => {
                    setUrlModalDefaultType('url');
                    setIsUrlModalOpen(true);
                  }}
                />
                <ToolButton
                  icon={Github}
                  label="GitHub"
                  onClick={() => {
                    setUrlModalDefaultType('github');
                    setIsUrlModalOpen(true);
                  }}
                />
                <ToolButton
                  icon={Database}
                  label="Base RAG"
                  onClick={() => setIsKbModalOpen(true)}
                />
                <ToolButton
                  icon={Paperclip}
                  label="Anexos"
                  onClick={() =>
                    setIsAttachmentMenuOpen(
                      (current) => !current
                    )
                  }
                />
              </div>

              <div className="relative">
                <AttachmentMenu
                  isOpen={isAttachmentMenuOpen}
                  onClose={() =>
                    setIsAttachmentMenuOpen(false)
                  }
                  onSelectOption={handleAttachmentOption}
                  onFileSelectNative={(event) => {
                    if (event.target.files) {
                      processNativeFiles(
                        Array.from(event.target.files)
                      );
                    }
                  }}
                />
              </div>

              {toolNotice && (
                <div className="rounded-xl border border-amber-300/20 bg-amber-300/8 p-3 text-[10px] leading-relaxed text-amber-100/75">
                  {toolNotice}
                </div>
              )}

              {attachedFiles.length > 0 && (
                <div className="space-y-1.5">
                  {attachedFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.025] p-2 text-[10px]"
                    >
                      <Paperclip className="h-3 w-3 shrink-0 text-amber-300" />
                      <span className="min-w-0 flex-1 truncate text-white/65">
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAttachedFiles((current) =>
                            current.filter(
                              (item) => item.id !== file.id
                            )
                          );
                        }}
                        className="text-white/35 hover:text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <div
        ref={supportRef}
        className="relative mt-auto shrink-0 border-t border-white/8 p-3"
      >
        {isSupportOpen && (
          <div
            className={`froc-support-popover absolute bottom-[calc(100%+8px)] z-50 rounded-2xl border border-amber-300/25 bg-[#0b0b0b]/98 p-2 shadow-[0_18px_55px_rgba(0,0,0,0.55),0_0_24px_rgba(245,196,81,0.08)] backdrop-blur-xl ${
              isCollapsed
                ? 'left-3 w-56'
                : 'left-3 right-3'
            }`}
          >
            <div className="mb-2 px-2 pt-1">
              <p className="text-xs font-bold text-white">
                Suporte
              </p>
              <p className="mt-0.5 text-[10px] text-white/40">
                Escolha um canal de atendimento.
              </p>
            </div>

            <a
              href={WHATSAPP_SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs text-white/72 transition-colors hover:bg-emerald-500/10 hover:text-white"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                <MessageSquare className="h-4 w-4" />
              </span>
              <span>WhatsApp</span>
            </a>

            <a
              href={TELEGRAM_SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs text-white/72 transition-colors hover:bg-sky-500/10 hover:text-white"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
                <Send className="h-4 w-4" />
              </span>
              <span>Telegram</span>
            </a>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setIsSupportOpen((current) => !current);
          }}
          className={`glass-button flex w-full items-center rounded-xl ${
            isCollapsed
              ? 'h-11 justify-center'
              : 'gap-3 px-3 py-2.5'
          } ${
            isSupportOpen
              ? 'border-amber-300/30 bg-amber-300/10'
              : ''
          }`}
          title={isCollapsed ? 'Suporte' : undefined}
          aria-expanded={isSupportOpen}
        >
          <Headphones className="h-4 w-4 text-amber-300" />
          {!isCollapsed && (
            <>
              <span className="flex-1 text-left text-xs font-bold">
                Suporte
              </span>
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${
                  isSupportOpen ? '-rotate-90' : ''
                }`}
              />
            </>
          )}
        </button>

        {!isCollapsed && errorMsg && (
          <div
            role="alert"
            className="mt-2 rounded-xl border border-rose-500/25 bg-rose-500/10 p-2 text-[10px] leading-relaxed text-rose-300"
          >
            {errorMsg}
          </div>
        )}
      </div>

      <CameraScannerModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={(file) => {
          setAttachedFiles((current) => [
            ...current,
            file
          ]);
        }}
      />

      <VoiceRecorderModal
        isOpen={isVoiceOpen}
        onClose={() => setIsVoiceOpen(false)}
        onCaptureAudio={(file) => {
          setAttachedFiles((current) => [
            ...current,
            file
          ]);
        }}
      />

      <UrlImporterModal
        isOpen={isUrlModalOpen}
        onClose={() => setIsUrlModalOpen(false)}
        onImport={(file) => {
          setAttachedFiles((current) => [
            ...current,
            file
          ]);
        }}
        defaultType={urlModalDefaultType}
      />

      <CodeSnippetModal
        isOpen={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
        onAddCode={(file) => {
          setAttachedFiles((current) => [
            ...current,
            file
          ]);
        }}
      />

      <ZipInspectorModal
        isOpen={isZipModalOpen}
        onClose={() => setIsZipModalOpen(false)}
        initialFile={selectedZipForInspect}
        onConvertProject={(analysis) => {
          void onGenerateSite({
            prompt: analysis.architectureSummary,
            category: 'Projeto importado',
            colorPalette: 'Preservar identidade original',
            tone: 'Profissional',
            features: []
          });
        }}
      />

      <KnowledgeBaseModal
        isOpen={isKbModalOpen}
        onClose={() => setIsKbModalOpen(false)}
        knowledgeBases={knowledgeBases}
        onCreateKnowledgeBase={(knowledgeBase) => {
          setKnowledgeBases((current) => [
            ...current,
            knowledgeBase
          ]);
        }}
        onSelectBaseForChat={() => {
          setToolNotice(
            'Base selecionada para futura conexão com o chat.'
          );
        }}
      />
    </aside>
  </>
  );
};

interface ToolButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}

const ToolButton: React.FC<ToolButtonProps> = ({
  icon: Icon,
  label,
  onClick
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-card glass-panel-hover flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center"
    >
      <Icon className="h-5 w-5 text-amber-300" />
      <span className="text-[10px] font-bold text-white/68">
        {label}
      </span>
    </button>
  );
};