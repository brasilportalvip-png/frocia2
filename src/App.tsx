import React, {
  useState,
  useEffect,
  useRef,
  lazy,
  Suspense
} from 'react';
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
const MediaGenerationModal = lazy(() =>
  import('./components/MediaGenerationModal').then((module) => ({
    default: module.MediaGenerationModal,
  }))
);
import {
  GeneratedSite,
  ChatMessage,
  Conversation,
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

const LOCAL_STORAGE_KEY_PREFIX = 'frocia_saved_sites_v1';

function getPartitionedKey(prefix: string, uid: string): string {
  const safeUid = uid && uid.trim().length > 0 ? uid : 'guest';
  return `${prefix}_${safeUid}`;
}

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
  const { user: authUser, loading, isAuthenticated, isAdmin, profileError, logout, refreshProfile } = useAuth();

  const [navMode, setNavMode] = useState<AppNavigationMode>('studio');
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [deviceView, setDeviceView] = useState<DeviceView>('desktop');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.6-flash');

  const [savedSites, setSavedSites] = useState<GeneratedSite[]>([]);
  const [activeSite, setActiveSite] = useState<GeneratedSite | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [isGenerating, setIsGenerating] = useState<boolean>(false);

const activeRequestControllerRef =
  useRef<AbortController | null>(null);

const [isRefining, setIsRefining] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedChatMode, setSelectedChatMode] = useState<ChatMode>('Inteligente');
  const [activeArtifact, setActiveArtifact] = useState<ArtifactData | null>(null);
  const [isArtifactOpen, setIsArtifactOpen] = useState<boolean>(false);

 const [isExportOpen, setIsExportOpen] = useState<boolean>(false);

const [mediaModal, setMediaModal] = useState<{
  isOpen: boolean;
  mode: 'image' | 'video';
  initialPrompt: string;
}>({
  isOpen: false,
  mode: 'image',
  initialPrompt: '',
});

const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState<boolean>(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState<boolean>(false);

  const [currentConversationId, setCurrentConversationId] =
  useState<string | null>(null);

const handleStopGeneration = () => {
  const controller =
    activeRequestControllerRef.current;

  if (
    controller &&
    !controller.signal.aborted
  ) {
    controller.abort();
  }

  activeRequestControllerRef.current = null;
  setIsGenerating(false);
};

const fetchConversations = async () => {
    if (!isAuthenticated) return;
    setConversationsLoading(true);
    setConversationsError(null);
    try {
      const res = await apiClient<{ conversations: Conversation[] }>('/api/conversations');
      setConversations(res.conversations || []);
    } catch (err: any) {
      console.warn('Erro ao buscar conversas:', err);
      setConversationsError('Não foi possível carregar o histórico de conversas.');
    } finally {
      setConversationsLoading(false);
    }
  };

  const loadMessagesForConversation = async (convId: string): Promise<boolean> => {
    setMessagesLoading(true);
    try {
      const res = await apiClient<{
        messages: Array<{
          id: string;
          role: string;
          content: string;
          createdAt: string;
          citations?: Array<{ title: string; uri: string; snippet?: string }>;
        }>;
      }>(`/api/conversations/${convId}/messages`);

      if (res.messages) {
        const mapped: ChatMessage[] = res.messages.map((m) => ({
          id: m.id,
          sender: m.role === 'user' ? 'user' : 'ai',
          text: m.content,
          timestamp: new Date(m.createdAt).getTime(),
          citations: m.citations
        }));
        setChatMessages(mapped);
        return true;
      }
      return false;
    } catch (err: any) {
      console.warn(`Erro ao carregar mensagens da conversa ${convId}:`, err);
      return false;
    } finally {
      setMessagesLoading(false);
    }
  };

  // Fallback user object for components expecting UserProfile
  const currentUser: UserProfile = authUser || {
    id: 'guest',
    name: 'Visitante',
    email: '',
    avatarUrl: '',
    role: 'user',
    plan: 'Teste',
    creditsRemaining: 0,
    creditsMax: 0,
    isAuthenticated: false,
  };

  // Zero in-memory state and load user-partitioned data whenever account switches
  useEffect(() => {
    const userUid = currentUser.id || 'guest';
    const activeConvKey = getPartitionedKey('frocia_active_conv', userUid);
    const savedSitesKey = getPartitionedKey(LOCAL_STORAGE_KEY_PREFIX, userUid);

    // Clean legacy unpartitioned global keys if present
    try {
      localStorage.removeItem('frocia_active_conversation_id');
      localStorage.removeItem('frocia_saved_sites_v1');
    } catch {}

    // Strictly zero in-memory state before loading new account data
    setChatMessages([]);
    setConversations([]);
    setSavedSites([]);
    setActiveSite(null);
    setErrorMsg(null);

    if (!isAuthenticated) {
      setCurrentConversationId(null);
      // Load guest saved sites if present
      try {
        const stored = localStorage.getItem(savedSitesKey);
        if (stored) {
          const parsed: GeneratedSite[] = JSON.parse(stored);
          if (parsed && parsed.length > 0) {
            setSavedSites(parsed);
            setActiveSite(parsed[0]);
          }
        }
      } catch {}
      return;
    }

    // Load partition key for active conversation
    const savedConvId = localStorage.getItem(activeConvKey);
    setCurrentConversationId(savedConvId);

    fetchConversations();

    if (savedConvId) {
      loadMessagesForConversation(savedConvId).then((success) => {
        if (!success) {
          setCurrentConversationId(null);
          try {
            localStorage.removeItem(activeConvKey);
          } catch (e) {}
          setChatMessages([]);
        }
      });
    }

    // Load partitioned saved sites
    try {
      const stored = localStorage.getItem(savedSitesKey);
      if (stored) {
        const parsed: GeneratedSite[] = JSON.parse(stored);
        if (parsed && parsed.length > 0) {
          setSavedSites(parsed);
          setActiveSite(parsed[0]);
        }
      }
    } catch (e) {
      console.warn('Erro ao ler localStorage do usuário:', e);
    }
  }, [currentUser.id, isAuthenticated]);

  const handleNewChat = async () => {
    if (!isAuthenticated) {
      setIsAuthOpen(true);
      return;
    }

    try {
      const res = await apiClient<{ conversation: Conversation }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Nova Conversa',
          mode: 'smart'
        })
      });

      if (res.conversation) {
        setCurrentConversationId(res.conversation.id);
        try {
          const activeConvKey = getPartitionedKey('frocia_active_conv', currentUser.id);
          localStorage.setItem(activeConvKey, res.conversation.id);
        } catch (e) {}
        setConversations((prev) => [res.conversation, ...prev]);
        setChatMessages([]);
        setActiveSite(null);
        setErrorMsg(null);
      }
    } catch (err: any) {
      console.error('Erro ao criar conversa:', err);
      setErrorMsg('Não foi possível iniciar uma nova conversa.');
    }
  };

  const handleSelectConversation = async (convId: string) => {
    setCurrentConversationId(convId);
    const activeConvKey = getPartitionedKey('frocia_active_conv', currentUser.id);
    try {
      localStorage.setItem(activeConvKey, convId);
    } catch (e) {}

    const success = await loadMessagesForConversation(convId);
    if (!success) {
      setCurrentConversationId(null);
      try {
        localStorage.removeItem(activeConvKey);
      } catch (e) {}
      setChatMessages([]);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    const activeConvKey = getPartitionedKey('frocia_active_conv', currentUser.id);
    try {
      await apiClient(`/api/conversations/${convId}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== convId));

      if (currentConversationId === convId) {
        setCurrentConversationId(null);
        try {
          localStorage.removeItem(activeConvKey);
        } catch (e) {}
        setChatMessages([]);
      }
    } catch (err: any) {
      console.error('Erro ao deletar conversa:', err);
    }
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

  const saveSitesToStorage = (sites: GeneratedSite[]) => {
    setSavedSites(sites);
    const savedSitesKey = getPartitionedKey(LOCAL_STORAGE_KEY_PREFIX, currentUser.id);
    try {
      localStorage.setItem(savedSitesKey, JSON.stringify(sites));
    } catch (e) {
      console.warn('Erro ao salvar no localStorage:', e);
    }
  };

  const handleStartStudioWithPrompt = (prompt: string) => {
    setNavMode('studio');
    handleGenerateSite({
      prompt,
      category: 'Software / Tecnologia',
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
    setErrorMsg(
      'É necessário fazer login para gerar projetos com a Froc.IA.'
    );
    return;
  }

  activeRequestControllerRef.current?.abort();

  const requestController =
    new AbortController();

  activeRequestControllerRef.current =
    requestController;

  setIsGenerating(true);
  setErrorMsg(null);

  try {
    const attachments =
      toAIAttachmentPayloads(files);

    const result = await apiClient<{
      siteTitle: string;
      description: string;
      html: string;
      suggestedRefinements: string[];
    }>('/api/generate-site', {
      method: 'POST',
      signal: requestController.signal,
      body: JSON.stringify({
        ...data,
        attachments,
        modelName: selectedModel
      })
    });

    const sitePayload = {
      title:
        result.siteTitle ||
        'Novo Projeto Froc.IA',
      description:
        result.description ||
        data.prompt,
      prompt: data.prompt,
      category: data.category,
      colorPalette: data.colorPalette,
      tone: data.tone,
      html: result.html,
      suggestedRefinements:
        result.suggestedRefinements || []
    };

    const saveRes = await apiClient<{
      project: GeneratedSite;
    }>('/api/projects', {
      method: 'POST',
      signal: requestController.signal,
      body: JSON.stringify(sitePayload)
    });

    const createdProject =
      saveRes.project;

    setActiveSite(createdProject);

    const updatedList = [
      createdProject,
      ...savedSites
    ];

    saveSitesToStorage(updatedList);

    await refreshProfile();

    setChatMessages([
      {
        id: `msg-${Date.now()}`,
        sender: 'ai',
        text:
          `🎉 Seu projeto "${createdProject.title}" foi criado e salvo com sucesso! O que gostaria de personalizar a seguir?`,
        timestamp: Date.now()
      }
    ]);
  } catch (error: any) {
    if (
      error?.code ===
      'request_aborted'
    ) {
      setErrorMsg(null);
      return;
    }

    console.error(error);

    setErrorMsg(
      error?.message ||
      'Erro ao gerar o projeto. Tente novamente.'
    );
  } finally {
    if (
      activeRequestControllerRef.current ===
      requestController
    ) {
      activeRequestControllerRef.current =
        null;

      setIsGenerating(false);
    }
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

  if (profileError || !authUser) {
    setErrorMsg(
      'Operação bloqueada: Não foi possível carregar seu perfil e saldo do servidor. Tente novamente.'
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

  activeRequestControllerRef.current?.abort();

  const requestController =
    new AbortController();

  activeRequestControllerRef.current =
    requestController;

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
    let activeConvId =
      currentConversationId;

    if (!activeConvId) {
      const convRes = await apiClient<{
        conversation: Conversation;
      }>('/api/conversations', {
        method: 'POST',
        signal: requestController.signal,
        body: JSON.stringify({
          title:
            prompt.slice(0, 30) ||
            'Nova Conversa',
          mode: apiMode
        })
      });

      if (convRes?.conversation?.id) {
        activeConvId =
          convRes.conversation.id;

        setCurrentConversationId(
          activeConvId
        );

        try {
          localStorage.setItem(
            `frocia_active_conv_${currentUser.id}`,
            activeConvId
          );
        } catch {
          // O histórico continuará salvo no servidor.
        }

        setConversations((previous) => [
          convRes.conversation,
          ...previous
        ]);
      } else {
        throw new Error(
          'Não foi possível registrar a conversa no servidor. Execução de IA interrompida.'
        );
      }
    }

    const knowledgeBaseIds =
      Array.from(
        new Set(
          files
            .filter(
              (file) =>
                file.source ===
                  'knowledge-base' &&
                typeof file.url ===
                  'string' &&
                file.url.length > 0
            )
            .map(
              (file) =>
                file.url as string
            )
        )
      );

    const directFiles = files.filter(
      (file) =>
        file.source !== 'knowledge-base'
    );

    const attachments =
      toAIAttachmentPayloads(
        directFiles
      );

    const stableExecutionKey =
      typeof crypto !== 'undefined' &&
      crypto.randomUUID
        ? crypto.randomUUID()
        : `exec-${Date.now()}-${Math.random()
            .toString(36)
            .substring(2)}`;

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
      signal: requestController.signal,
      body: JSON.stringify({
        prompt,
        mode: apiMode,
        conversationId: activeConvId,
        attachments,
        knowledgeBaseIds,
        idempotencyKey:
          stableExecutionKey
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
  } catch (error: any) {
    if (
      error?.code ===
      'request_aborted'
    ) {
      setErrorMsg(null);

      setChatMessages((current) => [
        ...current,
        {
          id: `ai-cancelled-${Date.now()}`,
          sender: 'ai',
          text:
            'Geração interrompida pelo usuário.',
          timestamp: Date.now()
        }
      ]);

      return;
    }

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
        text:
          `Não foi possível concluir a solicitação: ${message}`,
        timestamp: Date.now()
      }
    ]);
  } finally {
    if (
      activeRequestControllerRef.current ===
      requestController
    ) {
      activeRequestControllerRef.current =
        null;

      setIsGenerating(false);
    }
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
        onToggleMobileMenu={() => setIsMobileSidebarOpen(prev => !prev)}
      />

      {profileError && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between text-xs text-amber-200 z-40">
          <div className="flex items-center gap-2">
            <span className="font-bold text-amber-400">⚠️ Indisponibilidade:</span>
            <span>{profileError}</span>
          </div>
          <button
            onClick={() => refreshProfile()}
            className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold rounded-lg border border-amber-500/30 transition-all shrink-0"
          >
            Tentar Novamente
          </button>
        </div>
      )}

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
            onRefreshProfile={refreshProfile}
            onLogout={logout}
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
                setIsMobileSidebarOpen(false);
              }}
              onNewChat={() => {
                handleNewChat();
                setIsMobileSidebarOpen(false);
              }}
              isGenerating={isGenerating}
              isRefining={isRefining}
              savedSites={savedSites}
              activeSite={activeSite}
              chatMessages={chatMessages}
              conversations={conversations}
              currentConversationId={currentConversationId}
              onSelectConversation={handleSelectConversation}
              onDeleteConversation={handleDeleteConversation}
              conversationsLoading={conversationsLoading}
              conversationsError={conversationsError}
              onRetryConversations={fetchConversations}
              errorMsg={errorMsg}
              isOpenMobile={isMobileSidebarOpen}
              onCloseMobile={() => setIsMobileSidebarOpen(false)}
              onNavigate={(mode) => {
                setNavMode(mode);
                setIsMobileSidebarOpen(false);
              }}
              isAdmin={isAdmin}
            />

            {/* Central Conversation Hub */}
            <ChatCentral
              messages={chatMessages}
             


             onSendMessage={async (text, mode, files = []) => {
  if (mode === 'Criador de projetos') {
    await handleGenerateSite(
      {
        prompt: text,
        category: 'Software / Tecnologia',
        colorPalette: 'Cyber Purple & Gold',
        tone: 'Profissional',
        features: [
          'Responsivo',
          'Formulário',
          'FAQ',
        ],
      },
      files
    );
    return;
  }

  if (mode === 'Imagem') {
    setMediaModal({
      isOpen: true,
      mode: 'image',
      initialPrompt: text,
    });
    return;
  }

  if (mode === 'Vídeo') {
    setMediaModal({
      isOpen: true,
      mode: 'video',
      initialPrompt: text,
    });
    return;
  }

  await handleGeneralChat(
    text,
    mode,
    files
  );
}}




              onStopGeneration={handleStopGeneration}
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
  {/* Image and Video Generation Modal */}
  {mediaModal.isOpen && (
    <MediaGenerationModal
      isOpen={mediaModal.isOpen}
      mode={mediaModal.mode}
      initialPrompt={mediaModal.initialPrompt}
      onClose={() =>
        setMediaModal((current) => ({
          ...current,
          isOpen: false,
        }))
      }
      onCreditsChanged={() => {
        void refreshProfile();
      }}
    />
  )}

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