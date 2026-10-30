import { committeeNavigation } from './services/committeeNavigation';
import { ProfessionalBuildPanel } from './components/ProfessionalBuildPanel';
import { ProjectConfigurationPanel } from './components/ProjectConfigurationPanel';
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
import { SandboxedSiteFrame } from './components/SandboxedSiteFrame';
import { CodeViewer } from './components/CodeViewer';

import { Dashboard } from './components/Dashboard';
import { ChatCentral } from './components/ChatCentral';
import { ArtifactCanvasPanel } from './components/ArtifactCanvasPanel';
import { useAuth } from './context/AuthContext';
import { apiClient, ApiClientError } from './services/apiClient';
import { streamApiEvents } from './services/sseClient';
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

type ResearchJobStatus =
  | 'queued'
  | 'in_progress'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete';

interface AIExecutionResult {
  text: string;
  modelUsed: string;
  executionId: string;
  consumedCredits: number;
  citations?: ChatMessage['citations'];
  fallbackUsed?: boolean;
}

interface ResearchJobView {
  jobId: string;
  status: ResearchJobStatus;
  progress: {
    percent: number;
    stage: string;
    searches: number;
    pagesOpened: number;
    inPageFinds: number;
  };
  limitations: string[];
  result?: AIExecutionResult;
  error?: { code: string; message: string };
}

const RESEARCH_POLL_INTERVAL_MS = 2_000;
const RESEARCH_MAX_WAIT_MS = 25 * 60 * 1_000;

function waitForNextResearchPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = window.setTimeout(finish, RESEARCH_POLL_INTERVAL_MS);
    const abort = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(
        Object.assign(new Error('Pesquisa cancelada pelo usuário.'), {
          code: 'request_aborted'
        })
      );
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function researchProgressText(job: ResearchJobView): string {
  const progress = job.progress;
  return [
    `Pesquisa profunda — ${progress.stage} (${progress.percent}%)`,
    `Buscas: ${progress.searches} · páginas abertas: ${progress.pagesOpened} · trechos localizados: ${progress.inPageFinds}`,
    'Você pode interromper a pesquisa a qualquer momento.',
  ].join('\n');
}

function upsertResearchProgress(
  messages: ChatMessage[],
  messageId: string,
  job: ResearchJobView
): ChatMessage[] {
  const next: ChatMessage = {
    id: messageId,
    sender: 'ai',
    text: researchProgressText(job),
    timestamp: Date.now()
  };
  return messages.some((message) => message.id === messageId)
    ? messages.map((message) =>
        message.id === messageId ? { ...message, text: next.text } : message
      )
    : [...messages, next];
}

export default function App() {
  const { user: authUser, loading, isAuthenticated, isAdmin, profileError, logout, refreshProfile } = useAuth();

  const [navMode, setNavMode] = useState<AppNavigationMode>(() => committeeNavigation(window.location.href).openAdmin ? 'admin' : 'studio');
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [deviceView, setDeviceView] = useState<DeviceView>('desktop');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.6-flash');

  const [savedSites, setSavedSites] = useState<GeneratedSite[]>([]);
  const [professionalBuildId, setProfessionalBuildId] = useState<string | null>(null);
  const [isProjectConfigurationOpen, setIsProjectConfigurationOpen] = useState(false);
  const [activeSite, setActiveSite] = useState<GeneratedSite | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [isGenerating, setIsGenerating] = useState<boolean>(false);

const activeRequestControllerRef =
  useRef<AbortController | null>(null);
const activeResearchJobIdRef =
  useRef<string | null>(null);

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
  // React state is committed asynchronously. Event handlers that create a
  // conversation and immediately send a message must read the synchronous
  // ref, otherwise the first turn can be written to a second conversation.
  const currentConversationIdRef = useRef<string | null>(null);
  const updateCurrentConversationId = (conversationId: string | null) => {
    currentConversationIdRef.current = conversationId;
    setCurrentConversationId(conversationId);
  };

const handleStopGeneration = () => {
  const controller =
    activeRequestControllerRef.current;

  if (
    controller &&
    !controller.signal.aborted
  ) {
    controller.abort();
  }

  const researchJobId = activeResearchJobIdRef.current;
  activeResearchJobIdRef.current = null;
  if (researchJobId) {
    if (authUser?.id) {
      try {
        localStorage.removeItem(
          getPartitionedKey('frocia_active_research', authUser.id)
        );
      } catch {
        // O cancelamento remoto continua sendo tentado.
      }
    }
    void apiClient(
      `/api/ai/research-jobs/${researchJobId}/cancel`,
      { method: 'POST' }
    ).catch(() => {
      // A pesquisa também será cancelada pelo timeout do provedor se a rede cair.
    });
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
          citations?: ChatMessage['citations'];
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
    } catch (storageError) {
      console.warn('Não foi possível remover chaves locais antigas:', storageError);
    }

    // Strictly zero in-memory state before loading new account data
    setChatMessages([]);
    setConversations([]);
    setSavedSites([]);
    setActiveSite(null);
    setErrorMsg(null);

    if (!isAuthenticated) {
      updateCurrentConversationId(null);
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
      } catch (storageError) {
        console.warn('Não foi possível carregar sites locais do visitante:', storageError);
      }
      return;
    }

    // Load partition key for active conversation
    const savedConvId = localStorage.getItem(activeConvKey);
    updateCurrentConversationId(savedConvId);

    fetchConversations();

    if (savedConvId) {
      loadMessagesForConversation(savedConvId).then((success) => {
        if (!success) {
          updateCurrentConversationId(null);
          try {
            localStorage.removeItem(activeConvKey);
          } catch (storageError) {
            console.warn('Não foi possível limpar a conversa ativa local:', storageError);
          }
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

  // Retoma uma pesquisa longa após atualização da página ou queda da conexão.
  useEffect(() => {
    if (!isAuthenticated || !authUser?.id || activeResearchJobIdRef.current) {
      return;
    }
    const storageKey = getPartitionedKey(
      'frocia_active_research',
      authUser.id
    );
    const jobId = localStorage.getItem(storageKey);
    if (!jobId || !/^research_[A-Za-z0-9-]{20,80}$/.test(jobId)) return;

    const controller = new AbortController();
    let disposed = false;
    activeResearchJobIdRef.current = jobId;
    activeRequestControllerRef.current = controller;
    setIsGenerating(true);

    const resume = async () => {
      const progressMessageId = `research-progress-${jobId}`;
      try {
        while (!disposed) {
          const refreshed = await apiClient<{ job: ResearchJobView }>(
            `/api/ai/research-jobs/${jobId}`,
            { signal: controller.signal }
          );
          const job = refreshed.job;
          setChatMessages((current) =>
            upsertResearchProgress(current, progressMessageId, job)
          );
          if (['completed', 'failed', 'cancelled', 'incomplete'].includes(job.status)) {
            localStorage.removeItem(storageKey);
            setChatMessages((current) => {
              const withoutProgress = current.filter(
                (message) => message.id !== progressMessageId
              );
              if (job.status === 'completed' && job.result) {
                const resultId = `ai-research-${job.result.executionId}`;
                return withoutProgress.some((message) => message.id === resultId)
                  ? withoutProgress
                  : [
                      ...withoutProgress,
                      {
                        id: resultId,
                        sender: 'ai',
                        text: job.result.text,
                        timestamp: Date.now(),
                        citations: job.result.citations ?? []
                      }
                    ];
              }
              return [
                ...withoutProgress,
                {
                  id: `ai-research-ended-${jobId}`,
                  sender: 'ai',
                  text:
                    job.error?.message ||
                    job.limitations?.[0] ||
                    'A pesquisa foi encerrada sem resultado completo.',
                  timestamp: Date.now()
                }
              ];
            });
            await refreshProfile();
            break;
          }
          await waitForNextResearchPoll(controller.signal);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('A pesquisa será retomada na próxima abertura.', error);
        }
      } finally {
        if (activeResearchJobIdRef.current === jobId) {
          activeResearchJobIdRef.current = null;
        }
        if (activeRequestControllerRef.current === controller) {
          activeRequestControllerRef.current = null;
          setIsGenerating(false);
        }
      }
    };

    void resume();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [isAuthenticated, authUser?.id]);

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
        updateCurrentConversationId(res.conversation.id);
        try {
          const activeConvKey = getPartitionedKey('frocia_active_conv', currentUser.id);
          localStorage.setItem(activeConvKey, res.conversation.id);
        } catch (storageError) {
          console.warn('Não foi possível salvar a conversa ativa local:', storageError);
        }
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
    updateCurrentConversationId(convId);
    const activeConvKey = getPartitionedKey('frocia_active_conv', currentUser.id);
    try {
      localStorage.setItem(activeConvKey, convId);
    } catch (storageError) {
      console.warn('Não foi possível salvar a conversa selecionada localmente:', storageError);
    }

    const success = await loadMessagesForConversation(convId);
    if (!success) {
      updateCurrentConversationId(null);
      try {
        localStorage.removeItem(activeConvKey);
      } catch (storageError) {
        console.warn('Não foi possível limpar a conversa inválida localmente:', storageError);
      }
      setChatMessages([]);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    const activeConvKey = getPartitionedKey('frocia_active_conv', currentUser.id);
    try {
      await apiClient(`/api/conversations/${convId}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== convId));

      if (currentConversationIdRef.current === convId) {
        updateCurrentConversationId(null);
        try {
          localStorage.removeItem(activeConvKey);
        } catch (storageError) {
          console.warn('Não foi possível remover a conversa ativa local:', storageError);
        }
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

  // Abre no editor um site estático importado do GitHub (evento vindo do importador).
  useEffect(() => {
    const onOpenImportedSite = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        html: string; title: string; repository: string; sourceUrl: string; fullDownloadUrl: string;
        report: { complete: boolean; message: string };
      } | undefined;
      if (!detail?.html) return;
      const importedSite: GeneratedSite = {
        id: `local-gh-${Date.now()}`,
        title: detail.title || detail.repository,
        description: `Importado de ${detail.sourceUrl}`,
        prompt: `Site importado do GitHub: ${detail.sourceUrl}`,
        category: 'Importado do GitHub',
        colorPalette: 'Original do projeto',
        tone: 'Original',
        html: detail.html,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      setActiveSite(importedSite);
      saveSitesToStorage([importedSite, ...savedSites.filter(s => s.id !== importedSite.id)]);
      setChatMessages([
        {
          id: `msg-${Date.now()}`,
          sender: 'ai',
          text: `Site "${importedSite.title}" aberto no editor.\n\n${detail.report.message}${
            detail.report.complete ? '\n\nTudo foi trazido. O que você quer alterar?' : `\n\nO que ficou de fora está listado acima. Projeto completo para download: ${detail.fullDownloadUrl}`
          }`,
          timestamp: Date.now()
        }
      ]);
    };
    window.addEventListener('froc:open-imported-site', onOpenImportedSite);
    return () => window.removeEventListener('froc:open-imported-site', onOpenImportedSite);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSites, currentUser?.id]);

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
  files: UploadedFile[] = [],
  budgetApproved = false
) => {
  if (!isAuthenticated) {
    setIsAuthOpen(true);
    setErrorMsg(
      'É necessário fazer login para gerar projetos com a Froc.IA.'
    );
    return;
  }

  if (!budgetApproved) {
    const images=/imagem|imagens|fotograf|cinematogr/i.test(data.prompt)?2:0;
    const video=/v[ií]deo|veo\s*3/i.test(data.prompt);
    setCostModal({isOpen:true,opType:'Construção profissional',credits:95+images*18+(video?120:0),desc:'Limite estimado incluindo planejamento, geração, revisão e até duas correções. Mídias solicitadas estão incluídas. A publicação só é aprovada após os testes. Credenciais externas são configuradas pelo painel.',onConfirm:()=>{setCostModal(prev=>({...prev,isOpen:false}));void handleGenerateSite(data,files,true);}});
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
    const attachments = toAIAttachmentPayloads(files);
    const saved = await apiClient<{project:GeneratedSite}>('/api/projects', {method:'POST',signal:requestController.signal,body:JSON.stringify({...data,title:'Novo projeto em construção',description:data.prompt.slice(0,1000),html:'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Construção em andamento</title></head><body><h1>Seu projeto está em construção</h1><p>Acompanhe as etapas no painel de entrega.</p></body></html>'})});
    const result=await apiClient<any>('/api/professional-factory/projects/'+encodeURIComponent(saved.project.id)+'/builds',{method:'POST',signal:requestController.signal,body:JSON.stringify({brief:{...data,autoPublish:true,media:{images:/imagem|imagens|fotograf|cinematogr/i.test(data.prompt)?2:0,video:/v[ií]deo|veo\s*3/i.test(data.prompt)}},idempotencyKey:crypto.randomUUID(),attachments})});
    const project={...saved.project,professionalBuildId:result.build.id};
    setActiveSite(project);saveSitesToStorage([project,...savedSites]);setProfessionalBuildId(result.build.id);
    setChatMessages([{id:'factory-'+Date.now(),sender:'ai',timestamp:Date.now(),text:'Iniciei a construção completa do seu projeto. A equipe vai gerar o código, revisar, testar e verificar a publicação. Se faltarem credenciais ou dados do negócio, você poderá preenchê-los no painel, sem editar código.'}]);
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

    if (activeSite.professionalBuildId) {
      setIsRefining(true);setErrorMsg(null);
      try {const result=await apiClient<any>('/api/professional-factory/projects/'+encodeURIComponent(activeSite.id)+'/builds/'+encodeURIComponent(activeSite.professionalBuildId)+'/change',{method:'POST',body:JSON.stringify({instructions:instruction,idempotencyKey:crypto.randomUUID()})});const updated={...activeSite,professionalBuildId:result.build.id};setActiveSite(updated);saveSitesToStorage(savedSites.map(s=>s.id===updated.id?updated:s));setProfessionalBuildId(result.build.id);}
      catch(e:any){setErrorMsg(e.message||'Não foi possível solicitar a alteração.');}
      finally{setIsRefining(false);}return;
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
      currentConversationIdRef.current;

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

        updateCurrentConversationId(activeConvId);

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

     const requestBody = {
  prompt,
  mode: apiMode,
  conversationId: activeConvId,
  attachments,
  knowledgeBaseIds,
  idempotencyKey: stableExecutionKey
};

    let result: AIExecutionResult;
    let streamedResponseMessageId: string | null = null;

    if (apiMode === 'research') {
      const started = await apiClient<
        | {
            strategy: 'background';
            job: ResearchJobView;
          }
        | {
            strategy: 'completed';
            provider: 'gemini';
            fallbackReason: string;
            result: AIExecutionResult;
          }
      >('/api/ai/research-jobs', {
        method: 'POST',
        signal: requestController.signal,
        body: JSON.stringify(requestBody)
      });

      if (started.strategy === 'completed') {
        result = started.result;
      } else {
        let job = started.job;
        const progressMessageId = `research-progress-${job.jobId}`;
        const startedAt = Date.now();
        activeResearchJobIdRef.current = job.jobId;
        localStorage.setItem(
          getPartitionedKey('frocia_active_research', currentUser.id),
          job.jobId
        );
        setChatMessages((current) =>
          upsertResearchProgress(current, progressMessageId, job)
        );

        while (!['completed', 'failed', 'cancelled', 'incomplete'].includes(job.status)) {
          if (Date.now() - startedAt > RESEARCH_MAX_WAIT_MS) {
            throw new Error(
              'A pesquisa continua no servidor, mas excedeu o tempo desta tela. Tente novamente em alguns minutos.'
            );
          }
          await waitForNextResearchPoll(requestController.signal);
          const refreshed = await apiClient<{ job: ResearchJobView }>(
            `/api/ai/research-jobs/${job.jobId}`,
            { signal: requestController.signal }
          );
          job = refreshed.job;
          setChatMessages((current) =>
            upsertResearchProgress(current, progressMessageId, job)
          );
        }

        activeResearchJobIdRef.current = null;
        localStorage.removeItem(
          getPartitionedKey('frocia_active_research', currentUser.id)
        );
        if (job.status !== 'completed' || !job.result) {
          const limitation = job.limitations?.[0];
          throw new Error(
            job.error?.message ||
              limitation ||
              (job.status === 'cancelled'
                ? 'Pesquisa cancelada pelo usuário.'
                : 'A pesquisa não reuniu evidência suficiente para uma resposta confiável.')
          );
        }
        result = job.result;
        setChatMessages((current) =>
          current.filter((message) => message.id !== progressMessageId)
        );
      }
    } else {
      const streamMessageId = `ai-stream-${Date.now()}`;
      streamedResponseMessageId = streamMessageId;
      let streamedText = '';
      let streamedCitations: ChatMessage['citations'] = [];
      let executionId = '';
      let consumedCredits = 0;
      let streamError: Error | null = null;

      setChatMessages((current) => [
        ...current,
        {
          id: streamMessageId,
          sender: 'ai',
          text: '',
          timestamp: Date.now(),
        },
      ]);

      await streamApiEvents('/api/ai/chat', requestBody, {
        signal: requestController.signal,
        onEvent: ({ event, data }) => {
          const payload = data as any;
          if (event === 'start') executionId = payload?.executionId || '';
          if (event === 'token' && typeof payload?.text === 'string') {
            streamedText += payload.text;
            setChatMessages((current) =>
              current.map((message) =>
                message.id === streamMessageId
                  ? { ...message, text: streamedText }
                  : message
              )
            );
          }
          if (event === 'citations' && Array.isArray(payload?.citations)) {
            streamedCitations = payload.citations;
            setChatMessages((current) =>
              current.map((message) =>
                message.id === streamMessageId
                  ? { ...message, citations: streamedCitations }
                  : message
              )
            );
          }
          if (event === 'completed') {
            consumedCredits = Number(payload?.consumedCredits || 0);
          }
          if (event === 'error' || event === 'cancelled') {
            streamError = new Error(
              payload?.message || 'A transmissão foi interrompida.'
            );
          }
        },
      });

      if (streamError) throw streamError;

      result = {
        text: streamedText || 'A IA não retornou conteúdo.',
        modelUsed: '',
        executionId,
        consumedCredits,
        citations: streamedCitations,
      };
    }

    const responseText =
      result.text ||
      'A IA não retornou conteúdo.';

    const aiMessage: ChatMessage = {
      id: `ai-${Date.now()}`,
      sender: 'ai',
      text: responseText,
      timestamp: Date.now(),
      citations: result.citations ?? []
    };

    setChatMessages((current) => {
      if (streamedResponseMessageId) {
        return current.map((message) =>
          message.id === streamedResponseMessageId
            ? { ...message, citations: result.citations ?? [] }
            : message
        );
      }
      return [...current, aiMessage];
    });

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
    activeResearchJobIdRef.current = null;
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
    if (activeSite.professionalBuildId) { setErrorMsg('Este projeto possui frontend e backend. Solicite a alteração no chat para revisar e testar o projeto completo.'); return; }
    const updatedSite = { ...activeSite, html: newHtml, updatedAt: Date.now() };
    setActiveSite(updatedSite);
    const updatedList = savedSites.map(s => s.id === updatedSite.id ? updatedSite : s);
    saveSitesToStorage(updatedList);
  };

  const handleNewSite = () => {
    setActiveSite(null);
    setProfessionalBuildId(null);
    setChatMessages([]);
    setErrorMsg(null);
  };

  const handleDeleteSite = async (siteId: string) => {
    setErrorMsg(null);

    try {
      // Projetos que só existem neste navegador (importados, modelos, locais) não estão no
      // servidor: excluir é remover da lista local. O servidor só é chamado para projetos salvos.
      const isLocalOnly = siteId.startsWith('local-') || siteId.startsWith('tmpl-');
      if (!isLocalOnly) {
        try {
          await apiClient(`/api/projects/${encodeURIComponent(siteId)}`, {
            method: 'DELETE'
          });
        } catch (deleteError) {
          // 404 = o projeto já não existe no servidor; a lista local deve acompanhar.
          if (!(deleteError instanceof ApiClientError && deleteError.status === 404)) throw deleteError;
        }
      }

      const updatedList = savedSites.filter(
        (site) => site.id !== siteId
      );
      saveSitesToStorage(updatedList);

      if (activeSite?.id === siteId) {
        setActiveSite(updatedList[0] || null);
      }
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'Não foi possível excluir o projeto.'
      );
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
    <div id="froc-app-root" className="froc-app-background h-screen w-screen flex flex-col bg-[#050505] text-white font-sans overflow-hidden antialiased">



    {/* Header */}
      <Header
        navMode={navMode}
        setNavMode={setNavMode}
        viewMode={viewMode}
        setViewMode={setViewMode}
        deviceView={deviceView}
        setDeviceView={setDeviceView}
        onNewSite={handleNewSite}
        onExport={() => activeSite?.professionalBuildId ? setProfessionalBuildId(activeSite.professionalBuildId) : setIsExportOpen(true)}
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

      {professionalBuildId && activeSite?.id && (
        <ProfessionalBuildPanel key={professionalBuildId} projectId={activeSite.id} buildId={professionalBuildId} onClose={()=>setProfessionalBuildId(null)} onRebuilt={(id)=>{const updated={...activeSite,professionalBuildId:id};setActiveSite(updated);saveSitesToStorage(savedSites.map(s=>s.id===updated.id?updated:s));setProfessionalBuildId(id);}} onReady={(url,title)=>{const updated={...activeSite,title,productionUrl:url};setActiveSite(updated);saveSitesToStorage(savedSites.map(s=>s.id===updated.id?updated:s));void refreshProfile();}}/>
      )}
      {isProjectConfigurationOpen && activeSite?.id && (
        <ProjectConfigurationPanel key={activeSite.id} projectId={activeSite.id} title={activeSite.title} onClose={() => setIsProjectConfigurationOpen(false)} />
      )}
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
              if(site.professionalBuildId)setProfessionalBuildId(site.professionalBuildId);
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
                if(site.professionalBuildId){setProfessionalBuildId(site.professionalBuildId);setIsMobileSidebarOpen(false);return;}
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
  if (mode === 'Criador de projetos' || /^\s*(?:por favor[, ]*)?(?:(?:eu\s+)?quero(?:\s+que\s+voc[eê])?\s+)?(?:crie|criar|construa|fa[çc]a|monte|desenvolva)\b[\s\S]{0,180}\b(?:site|aplicativo|webapp|loja virtual|landing page)\b/i.test(text)) {
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
    const prompt = text.trim();
    if (!prompt) return;

    if (!isAuthenticated || !authUser) {
      setIsAuthOpen(true);
      return;
    }

    let started = false;

    setCostModal({
      isOpen: true,
      opType: 'Geração de imagem',
      credits: 18,
      desc: 'Criar imagem diretamente na conversa da Froc.IA.',
      onConfirm: () => {
        if (started) return;
        started = true;

        const requestId =
          `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const assistantId = `ai-${requestId}`;

        setChatMessages((current) => [
          ...current,
          {
            id: `user-${requestId}`,
            sender: 'user',
            text: prompt,
            timestamp: Date.now(),
          },
          {
            id: assistantId,
            sender: 'ai',
            text: 'Gerando sua imagem...',
            timestamp: Date.now(),
            media: {
              type: 'image',
              prompt,
              status: 'processing',
            },
          },
        ]);

        setIsGenerating(true);

        void (async () => {
          try {
            const { MediaGenerationService } =
              await import('./services/mediaGenerationService');

            const image = await MediaGenerationService.generateImage({
              prompt,
              aspectRatio: '1:1',
            });

            setChatMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      text: 'Imagem criada com sucesso.',
                      media: {
                        type: 'image',
                        prompt,
                        status: 'completed',
                        url: image.url,
                        creditsSpent: image.creditsSpent,
                      },
                    }
                  : message
              )
            );
          } catch (error) {
            const detail =
              error instanceof Error
                ? error.message
                : 'Erro desconhecido.';

            setChatMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      text: `Não foi possível gerar a imagem: ${detail}`,
                      media: {
                        type: 'image',
                        prompt,
                        status: 'failed',
                      },
                    }
                  : message
              )
            );
          } finally {
            setIsGenerating(false);
            void refreshProfile();
          }
        })();
      },
    });

    return;
  }

  if (mode === 'Vídeo') {
    const prompt = text.trim();
    if (!prompt) return;

    if (!isAuthenticated || !authUser) {
      setIsAuthOpen(true);
      return;
    }

    let started = false;

    setCostModal({
      isOpen: true,
      opType: 'Geração de vídeo',
      credits: 30,
      desc: 'Criar vídeo de 4 segundos na qualidade Lite.',
      onConfirm: () => {
        if (started) return;
        started = true;

        const requestId =
          `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const assistantId = `ai-${requestId}`;

        setChatMessages((current) => [
          ...current,
          {
            id: `user-${requestId}`,
            sender: 'user',
            text: prompt,
            timestamp: Date.now(),
          },
          {
            id: assistantId,
            sender: 'ai',
            text: 'Gerando seu vídeo...',
            timestamp: Date.now(),
            media: {
              type: 'video',
              prompt,
              status: 'processing',
              progress: 0,
            },
          },
        ]);

        setIsGenerating(true);

        void (async () => {
          try {
            const { MediaGenerationService } =
              await import('./services/mediaGenerationService');

            const job = await MediaGenerationService.startVideo({
              prompt,
              aspectRatio: '16:9',
              durationSeconds: 4,
              quality: 'lite',
            });

            const completed = await MediaGenerationService.waitForVideo(
              job.jobId,
              {
                onProgress: (updated) => {
                  setChatMessages((current) =>
                    current.map((message) =>
                      message.id === assistantId
                        ? {
                            ...message,
                            media: {
                              type: 'video',
                              prompt,
                              status: 'processing',
                              progress: updated.progress,
                            },
                          }
                        : message
                    )
                  );
                },
              }
            );

            setChatMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      text: 'Vídeo criado com sucesso.',
                      media: {
                        type: 'video',
                        prompt,
                        status: 'completed',
                        progress: 100,
                        url: completed.videoUrl ?? undefined,
                        creditsSpent: completed.creditsReserved,
                      },
                    }
                  : message
              )
            );
          } catch (error) {
            const detail =
              error instanceof Error
                ? error.message
                : 'Erro desconhecido.';

            setChatMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      text: `Não foi possível concluir o vídeo: ${detail}`,
                      media: {
                        type: 'video',
                        prompt,
                        status: 'failed',
                      },
                    }
                  : message
              )
            );
          } finally {
            setIsGenerating(false);
            void refreshProfile();
          }
        })();
      },
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
          <SandboxedSiteFrame
            site={activeSite}
            title="Prévia segura em tela cheia"
            className="w-full flex-1 border-none bg-white"
          />
        </div>
      )}
    </div>
  );
}
