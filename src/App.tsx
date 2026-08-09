import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { PreviewFrame } from './components/PreviewFrame';
import { CodeViewer } from './components/CodeViewer';

import { Dashboard } from './components/Dashboard';
import { ChatCentral } from './components/ChatCentral';
import { ArtifactCanvasPanel } from './components/ArtifactCanvasPanel';
import { useAuth } from './context/AuthContext';
import { apiClient } from './services/apiClient';
import { toAIAttachmentPayloads } from './services/attachmentService';

const ExportModal = lazy(() => import('./components/ExportModal').then(m => ({ default: m.ExportModal })));
const PricingPage = lazy(() => import('./components/PricingPage').then(m => ({ default: m.PricingPage })));
const IntegrationsPage = lazy(() => import('./components/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })));
const AuthModal = lazy(() => import('./components/AuthModal').then(m => ({ default: m.AuthModal })));
const CostEstimationModal = lazy(() => import('./components/CostEstimationModal').then(m => ({ default: m.CostEstimationModal })));
import {
  GeneratedSite,
  ChatMessage,
  ViewMode,
  DeviceView,
  SiteTemplate,
  AppNavigationMode,
  UserProfile,
  ChatMode,
  ArtifactData,
  UploadedFile
} from './types';
import { STARTER_TEMPLATES } from './data/templates';
import { X, Loader2, ShieldAlert } from 'lucide-react';

const LOCAL_STORAGE_KEY = 'frocia_saved_sites_v1';

const CHAT_MODE_TO_AI_MODE: Partial<
  Record<
    ChatMode,
    | 'fast'
    | 'smart'
    | 'deep'
    | 'code'
    | 'research'
    | 'site-builder'
    | 'image'
    | 'video'
  >
> = {
  'Rápido': 'fast',
  'Inteligente': 'smart',
  'Profundo': 'deep',
  'Programação': 'code',
  'Pesquisa': 'research',
  'Criador de projetos': 'site-builder',
  'Imagem': 'image',
  'Vídeo': 'video'
};

export default function App() {
  const { user: authUser, loading, isAuthenticated, isAdmin, logout, refreshProfile } = useAuth();

  const [navMode, setNavMode] = useState<AppNavigationMode>('studio');
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [deviceView, setDeviceView] = useState<DeviceView>('desktop');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.6-flash');

  const [savedSites, setSavedSites] = useState<GeneratedSite[]>([]);
  const [activeSite, setActiveSite] = useState<GeneratedSite | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedChatMode, setSelectedChatMode] = useState<ChatMode>('Inteligente');
  const [activeArtifact, setActiveArtifact] = useState<ArtifactData | null>(null);
  const [isArtifactOpen, setIsArtifactOpen] = useState<boolean>(false);

  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false);

  // Fallback user object for components expecting UserProfile
  const currentUser: UserProfile = authUser || {
    id: 'guest',
    name: 'Visitante',
    email: '',
    avatarUrl: '',
    role: 'user',
    plan: 'free',
    creditsRemaining: 0,
    creditsMax: 0,
    isAuthenticated: false,
  };

  // Cost Estimation Modal State
  const [costModal, setCostModal] = useState<{
    isOpen: boolean;
    opType: string;
    credits: number;
    desc: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    opType: '',
    credits: 0,
    desc: '',
    onConfirm: () => {}
  });

  // Initialize saved sites from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed: GeneratedSite[] = JSON.parse(stored);
        const filtered = parsed.filter(s => s.id !== 'saas-tech' && !s.title?.toLowerCase().includes('pulseflow'));
        if (filtered.length > 0) {
          setSavedSites(filtered);
          setActiveSite(filtered[0]);
          return;
        } else {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
        }
      }
    } catch (e) {
      console.warn('Erro ao ler localStorage:', e);
    }

    // Default starter template if none saved
    if (STARTER_TEMPLATES && STARTER_TEMPLATES.length > 0) {
      const starter = STARTER_TEMPLATES[0];
      const initialSite: GeneratedSite = {
        id: starter.id,
        title: starter.title,
        description: starter.description,
        prompt: starter.prompt,
        category: starter.category,
        colorPalette: starter.colorPalette,
        tone: 'Profissional',
        html: starter.sampleHtml,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      setActiveSite(initialSite);
      setSavedSites([initialSite]);
    } else {
      setActiveSite(null);
      setSavedSites([]);
    }
  }, []);

  const saveSitesToStorage = (sites: GeneratedSite[]) => {
    setSavedSites(sites);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sites));
    } catch (e) {
      console.warn('Erro ao salvar no localStorage:', e);
    }
  };

  const handleStartStudioWithPrompt = (prompt: string) => {
    setNavMode('studio');
    handleGenerateSite({
      prompt,
      category: 'SaaS / Tecnologia',
      colorPalette: 'Frosted Purple & Neon Pink',
      tone: 'Moderno',
      features: ['Design Responsivo', 'Seção Hero', 'Recursos', 'Contato']
    });
  };

  // Load user projects from backend API when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const fetchUserProjects = async () => {
      try {
        const res = await apiClient<{ projects: GeneratedSite[] }>('/api/projects');
        if (res.projects && res.projects.length > 0) {
          setSavedSites(res.projects);
          if (!activeSite) {
            setActiveSite(res.projects[0]);
          }
        }
      } catch (e) {
        console.warn('Erro ao buscar projetos do servidor:', e);
      }
    };

    fetchUserProjects();
  }, [isAuthenticated]);

  // Generate Site with froc.ia AI
  const handleGenerateSite = async (
    data: {
      prompt: string;
      category: string;
      colorPalette: string;
      tone: string;
      features: string[];
    },
    files: UploadedFile[] = []
  ) => {
    if (!isAuthenticated) {
      setIsAuthOpen(true);
      setErrorMsg('É necessário fazer login para gerar projetos com a Froc.IA.');
      return;
    }

    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const attachments = toAIAttachmentPayloads(files);

      const result = await apiClient<{
        siteTitle: string;
        description: string;
        html: string;
        suggestedRefinements: string[];
      }>('/api/generate-site', {
        method: 'POST',
        body: JSON.stringify({
          ...data,
          attachments,
          modelName: selectedModel
        })
      });

      const sitePayload = {
        title: result.siteTitle || 'Novo Projeto Froc.IA',
        description: result.description || data.prompt,
        prompt: data.prompt,
        category: data.category,
        colorPalette: data.colorPalette,
        tone: data.tone,
        html: result.html,
        suggestedRefinements: result.suggestedRefinements || []
      };

      // Save project to backend
      let createdProject: GeneratedSite;
      try {
        const saveRes = await apiClient<{ project: GeneratedSite }>('/api/projects', {
          method: 'POST',
          body: JSON.stringify(sitePayload)
        });
        createdProject = saveRes.project;
      } catch (saveErr) {
        createdProject = {
          id: `froc-site-${Date.now()}`,
          ...sitePayload,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      }

      setActiveSite(createdProject);
      const updatedList = [createdProject, ...savedSites];
      saveSitesToStorage(updatedList);

      await refreshProfile();

      setChatMessages([
        {
          id: `msg-${Date.now()}`,
          sender: 'ai',
          text: `🎉 Seu projeto "${createdProject.title}" foi criado com sucesso! O que gostaria de personalizar a seguir?`,
          timestamp: Date.now()
        }
      ]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Erro ao gerar o projeto. Tente novamente.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Refine Site with froc.ia AI
  const handleRefineSite = async (instruction: string) => {
    if (!activeSite) return;

    if (!isAuthenticated) {
      setIsAuthOpen(true);
      setErrorMsg('É necessário fazer login para refinar projetos com a Froc.IA.');
      return;
    }

    setIsRefining(true);
    setErrorMsg(null);

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: instruction,
      timestamp: Date.now()
    };
    setChatMessages(prev => [...prev, userMsg]);

    try {
      const result = await apiClient('/api/refine-site', {
        method: 'POST',
                body: JSON.stringify({
          currentHtml: activeSite.html,
          instructions: instruction,
          modelName: selectedModel
        })
      });

      const updatedSite: GeneratedSite = {
        ...activeSite,
        html: result.html || activeSite.html,
        updatedAt: Date.now()
      };

      if (activeSite.id && !activeSite.id.startsWith('local-')) {
        try {
          await apiClient(`/api/projects/${activeSite.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              html: updatedSite.html,
              suggestedRefinements: result.suggestedRefinements || []
            })
          });
        } catch (syncErr) {
          console.warn('Erro ao sincronizar refinamento com servidor:', syncErr);
        }
      }

      setActiveSite(updatedSite);
      const updatedList = savedSites.map(s => s.id === updatedSite.id ? updatedSite : s);
      saveSitesToStorage(updatedList);

      await refreshProfile();

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: result.explanation || 'Projeto atualizado com sucesso!',
        timestamp: Date.now(),
        isHtmlUpdate: true
      };
      setChatMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Erro ao refinar o projeto.');
    } finally {
      setIsRefining(false);
    }
  };




  const handleGeneralChat = async (
    text: string,
    mode: ChatMode,
    files: UploadedFile[] = []
  ) => {
    const prompt = text.trim();

    if (!prompt) return;

    if (!isAuthenticated) {
      setIsAuthOpen(true);
      setErrorMsg(
        'É necessário fazer login para conversar com a Froc.IA.'
      );
      return;
    }

    const apiMode =
      CHAT_MODE_TO_AI_MODE[mode];

    if (!apiMode) {
      setErrorMsg(
        `O modo ${mode} ainda não está homologado para produção.`
      );
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: prompt,
      timestamp: Date.now()
    };

    setChatMessages((current) => [
      ...current,
      userMessage
    ]);
    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const knowledgeBaseIds = Array.from(
        new Set(
          files
            .filter(
              (file) =>
                file.source === 'knowledge-base' &&
                typeof file.url === 'string' &&
                file.url.length > 0
            )
            .map((file) => file.url as string)
        )
      );
      const directFiles = files.filter(
        (file) => file.source !== 'knowledge-base'
      );
      const attachments =
        toAIAttachmentPayloads(directFiles);

      const result = await apiClient<{
        text: string;
        modelUsed: string;
        executionId: string;
        consumedCredits: number;
        citations?: Array<{
          title: string;
          uri: string;
          snippet?: string;
        }>;
        fallbackUsed: boolean;
      }>('/api/ai/executions', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          mode: apiMode,
          attachments,
          knowledgeBaseIds,
          idempotencyKey:
            `chat-${currentUser.id}-${Date.now()}`
        })
      });

      const responseText =
        result.text ||
        'A IA não retornou conteúdo.';

      const aiMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: responseText,
        timestamp: Date.now()
      };

      setChatMessages((current) => [
        ...current,
        aiMessage
      ]);

      await refreshProfile();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível concluir a solicitação.';

      setErrorMsg(message);

      setChatMessages((current) => [
        ...current,
        {
          id: `ai-error-${Date.now()}`,
          sender: 'ai',
          text: `Não foi possível concluir a solicitação: ${message}`,
          timestamp: Date.now()
        }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSelectTemplate = (template: SiteTemplate) => {




    const templateSite: GeneratedSite = {
      id: `tmpl-${template.id}-${Date.now()}`,
      title: template.title,
      description: template.description,
      prompt: template.prompt,
      category: template.category,
      colorPalette: template.colorPalette,
      tone: 'Profissional',
      html: template.sampleHtml,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    setActiveSite(templateSite);
    const updated = [templateSite, ...savedSites.filter(s => s.id !== templateSite.id)];
    saveSitesToStorage(updated);

    setChatMessages([
      {
        id: `msg-${Date.now()}`,
        sender: 'ai',
        text: `Modelo "${template.title}" carregado! O que deseja personalizar?`,
        timestamp: Date.now()
      }
    ]);
  };

  const handleManualHtmlUpdate = (newHtml: string) => {
    if (!activeSite) return;
    const updatedSite = { ...activeSite, html: newHtml, updatedAt: Date.now() };
    setActiveSite(updatedSite);
    const updatedList = savedSites.map(s => s.id === updatedSite.id ? updatedSite : s);
    saveSitesToStorage(updatedList);
  };

  const handleNewSite = () => {
    setActiveSite(null);
    setChatMessages([]);
    setErrorMsg(null);
  };

  const handleDeleteSite = (siteId: string) => {
    const updatedList = savedSites.filter(s => s.id !== siteId);
    saveSitesToStorage(updatedList);
    if (activeSite?.id === siteId) {
      setActiveSite(updatedList[0] || null);
    }
  };

  const handleToggleFavorite = (siteId: string) => {
    const updatedList = savedSites.map(s => {
      if (s.id === siteId) {
        return { ...s, isFavorite: !s.isFavorite };
      }
      return s;
    });
    saveSitesToStorage(updatedList);
    if (activeSite?.id === siteId) {
      setActiveSite({ ...activeSite, isFavorite: !activeSite.isFavorite });
    }
  };

  const refreshFrame = () => {
    if (activeSite) {
      setActiveSite({ ...activeSite });
    }
  };

  if (loading) {
    return (
      <div className="froc-app-background h-screen w-screen flex flex-col items-center justify-center bg-[#050505] text-white space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-purple-500" />
        <p className="text-sm font-medium text-white/70">Carregando Froc.IA...</p>
      </div>
    );
  }

  return (
    <div id="froc-app-root" className="froc-app-background h-screen w-screen flex flex-col bg-[#050505] text-white font-sans overflow-hidden antialiased select-none">



    {/* Header */}
      <Header
        navMode={navMode}
        setNavMode={setNavMode}
        viewMode={viewMode}
        setViewMode={setViewMode}
        deviceView={deviceView}
        setDeviceView={setDeviceView}
        onNewSite={handleNewSite}
        onExport={() => setIsExportOpen(true)}
        onOpenFullscreen={() => setIsFullscreen(true)}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        hasActiveSite={!!activeSite}
        siteTitle={activeSite?.title}
        user={currentUser}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={logout}
      />

      {/* Main Container View Switcher */}
      <div className="flex-1 flex overflow-hidden relative">
        

        {navMode === 'dashboard' && (
          <Dashboard
            savedSites={savedSites}
            onSelectSite={(site) => {
              setActiveSite(site);
              setNavMode('studio');
            }}
            onNewSite={() => {
              handleNewSite();
              setNavMode('studio');
            }}
            onDeleteSite={handleDeleteSite}
            onToggleFavorite={handleToggleFavorite}
            user={currentUser}
            onNavigateToPricing={() => setNavMode('pricing')}
          />
        )}

        <Suspense fallback={<div className="flex-1 flex items-center justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-purple-400" /></div>}>
          {navMode === 'pricing' && (
            <PricingPage
              user={currentUser}
              onRefreshProfile={refreshProfile}
            />
          )}

          {navMode === 'integrations' && (
            <IntegrationsPage />
          )}

          {navMode === 'admin' && (
            isAdmin ? (
              <AdminPanel
                onGrantCreditsToUser={() => {}}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div className="p-4 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-400">
                  <ShieldAlert className="w-12 h-12" />
                </div>
                <h2 className="text-xl font-bold text-white">Acesso Restrito</h2>
                <p className="text-sm text-white/60 max-w-md">
                  Você precisa ter privilégios de administrador autenticado para visualizar o painel executivo.
                </p>
                <button
                  onClick={() => setNavMode('studio')}
                  className="px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-colors"
                >
                  Voltar para o início
                </button>
              </div>
            )
          )}
        </Suspense>

        {navMode === 'studio' && (
          <div className="flex-1 flex w-full h-full overflow-hidden relative">
            {/* Left Collapsible Sidebar */}
            <Sidebar
              onGenerateSite={handleGenerateSite}
              onRefineSite={handleRefineSite}
              onSelectTemplate={handleSelectTemplate}
              onLoadSavedSite={(site) => {
                setActiveSite(site);
                setActiveArtifact({
                  id: site.id,
                  title: site.title,
                  type: 'site',
                  content: site.html,
                  htmlPreview: site.html
                });
                setIsArtifactOpen(true);
              }}
              onNewChat={handleNewSite}
              isGenerating={isGenerating}
              isRefining={isRefining}
              savedSites={savedSites}
              activeSite={activeSite}
                           chatMessages={chatMessages}
              errorMsg={errorMsg}
              onNavigate={(mode) => {
                setNavMode(mode);
              }}
              isAdmin={isAdmin}
            />

            {/* Central Conversation Hub */}
            <ChatCentral
              messages={chatMessages}
             


              onSendMessage={async (text, mode, files = []) => {
                if (mode === 'Criador de projetos') {
                  await handleGenerateSite({
                    prompt: text,
                    category: 'SaaS / Tecnologia',
                    colorPalette: 'Cyber Purple & Gold',
                    tone: 'Profissional',
                    features: [
                      'Responsivo',
                      'Formulário',
                      'FAQ'
                    ]
                  }, files);
                  return;
                }

                await handleGeneralChat(
                  text,
                  mode,
                  files
                );
              }}




              onStopGeneration={() => setIsGenerating(false)}
              isGenerating={isGenerating}
              selectedMode={selectedChatMode}
              setSelectedMode={setSelectedChatMode}
              user={currentUser}
              onOpenArtifact={(artifact) => {
                setActiveArtifact(artifact);
                setIsArtifactOpen(true);
              }}
              onOpenCostModal={(opType, credits, desc, onConfirmAction) => {
                setCostModal({
                  isOpen: true,
                  opType,
                  credits,
                  desc,
                  onConfirm: onConfirmAction
                });
              }}
            />

            {/* Right Workspace Canvas / Preview Frame / Artifact Workspace */}
            {activeSite && (
              <main className="hidden lg:flex w-1/2 h-full border-l border-white/10 overflow-hidden bg-slate-950">
                {viewMode === 'preview' && (
                  <PreviewFrame
                    site={activeSite}
                    deviceView={deviceView}
                    isGenerating={isGenerating}
                    onOpenFullscreen={() => setIsFullscreen(true)}
                    onRefresh={refreshFrame}
                  />
                )}

                {viewMode === 'code' && (
                  <CodeViewer
                    site={activeSite}
                    onUpdateHtml={handleManualHtmlUpdate}
                  />
                )}

                {viewMode === 'split' && (
                  <div className="flex-1 flex w-full h-full overflow-hidden">
                    <div className="w-1/2 border-r border-slate-800">
                      <PreviewFrame
                        site={activeSite}
                        deviceView={deviceView}
                        isGenerating={isGenerating}
                        onOpenFullscreen={() => setIsFullscreen(true)}
                        onRefresh={refreshFrame}
                      />
                    </div>
                    <div className="w-1/2">
                      <CodeViewer
                        site={activeSite}
                        onUpdateHtml={handleManualHtmlUpdate}
                      />
                    </div>
                  </div>
                )}
              </main>
            )}

            {/* Artifact Workspace Overlay Canvas */}
            <ArtifactCanvasPanel
              isOpen={isArtifactOpen}
              onClose={() => setIsArtifactOpen(false)}
              artifact={activeArtifact}
              onUpdateArtifact={(updated) => {
                setActiveArtifact(updated);
                if (activeSite) {
                  handleManualHtmlUpdate(updated.content);
                }
              }}
              onRequestPartialEdit={(selectedText, instruction) => {
                handleRefineSite(`No trecho: "${selectedText}", altere: ${instruction}`);
              }}
            />
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        {/* Cost Confirmation Modal */}
        {costModal.isOpen && (
          <CostEstimationModal
            isOpen={costModal.isOpen}
            onClose={() => setCostModal({ ...costModal, isOpen: false })}
            onConfirm={() => {
              costModal.onConfirm();
              setCostModal({ ...costModal, isOpen: false });
            }}
            operationType={costModal.opType}
            estimatedCredits={costModal.credits}
            maxCreditLimit={costModal.credits + 5}
            userBalance={currentUser.creditsRemaining}
            description={costModal.desc}
          />
        )}

        {/* Export Modal */}
        {isExportOpen && (
          <ExportModal
            site={activeSite}
            isOpen={isExportOpen}
            onClose={() => setIsExportOpen(false)}
          />
        )}

        {/* Auth Modal */}
        {isAuthOpen && (
          <AuthModal
            isOpen={isAuthOpen}
            onClose={() => setIsAuthOpen(false)}
          />
        )}
      </Suspense>

      {/* Fullscreen Preview Modal */}
      {isFullscreen && activeSite && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col animate-in fade-in duration-200">
          <div className="h-12 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-sm font-bold text-white">{activeSite.title}</span>
              <span className="text-xs text-slate-400 hidden sm:inline">(Modo Tela Cheia)</span>
            </div>
            <button
              onClick={() => setIsFullscreen(false)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 text-xs font-bold transition-colors"
            >
              <X className="w-4 h-4" />
              <span>Sair da Tela Cheia</span>
            </button>
          </div>
                    <iframe
            srcDoc={activeSite.html}
            title="Prévia segura em tela cheia"
            className="w-full flex-1 border-none bg-white"
            sandbox="allow-scripts allow-forms"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );
}