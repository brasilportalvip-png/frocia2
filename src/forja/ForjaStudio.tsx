import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Check, Code2, Copy, ExternalLink, Eye, Loader2, MessageSquare, Rocket, ShieldCheck, X } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { ChatArchitect } from './components/ChatArchitect';
import { PreviewCanvas } from './components/PreviewCanvas';
import { CodeExplorer } from './components/CodeExplorer';
import { AuditPanel } from './components/AuditPanel';
import { ConnectVercel } from './components/ConnectVercel';
import {
  assembleStandaloneHtml,
  exportProjectAsZip,
  runProductionAudit,
  slugifyProjectName,
  triggerFileDownload,
} from './utils/projectPackager';
import type {
  BuildMode,
  BuildPhase,
  ChatMessage,
  DesignPreset,
  DeviceViewport,
  GeneratedFileMeta,
  RuntimeErrorEvent,
  StudioProject,
  WorkspaceView,
} from './types';
import { apiClient } from '../services/apiClient';
import { streamApiEvents } from '../services/sseClient';

/**
 * Criador de sites da Froc.IA — mesma tela e mesmo motor do Forja Studio (Gemini):
 * conversa com o arquiteto à esquerda; prévia, código e auditoria à direita.
 * Os projetos ficam salvos na conta (servidor) e aparecem em "Meus projetos".
 */

const THEME_KEY = 'forja_studio_theme_v1';
const SAVE_DELAY_MS = 1200;

interface ProjectMeta {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  fileCount: number;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

function fromMeta(m: ProjectMeta): StudioProject {
  return { id: m.id, name: m.name, slug: m.slug || slugifyProjectName(m.name), createdAt: m.createdAt, updatedAt: m.updatedAt, files: {}, messages: [] };
}

export interface ForjaStudioProps {
  /** Pedido para começar a construir na hora (cria um projeto novo). */
  initialPrompt?: string;
  /** Abre um projeto já existente. */
  openProjectId?: string;
  onClose: () => void;
  /** Avisa a Froc.IA que o projeto mudou (título e HTML pronto). */
  onProjectSaved?: (info: { id: string; name: string; standaloneHtml: string; productionUrl?: string | null }) => void;
}

export default function ForjaStudio({ initialPrompt, openProjectId, onClose, onProjectSaved }: ForjaStudioProps) {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(() => new Set());
  const [activeProjectId, setActiveProjectId] = useState<string>(openProjectId || '');
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'error'>('idle');
  const [publishNotice, setPublishNotice] = useState<{ kind: 'ok' | 'error'; text: string; url?: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // Conta Vercel da pessoa (cada um publica na sua).
  const [creditCost, setCreditCost] = useState<{ create: number; edit: number } | null>(null);
  useEffect(() => {
    apiClient<{ create: number; edit: number }>('/api/forja/pricing')
      .then((r) => setCreditCost(r))
      .catch(() => setCreditCost(null));
  }, []);
  const [vercelAccount, setVercelAccount] = useState<{ connected: boolean; username?: string } | null>(null);
  const [vercelModal, setVercelModal] = useState(false);
  const [vercelBusy, setVercelBusy] = useState(false);
  const [vercelError, setVercelError] = useState<string | null>(null);

  useEffect(() => {
    apiClient<{ connected: boolean; username?: string }>('/api/forja/vercel')
      .then((r) => setVercelAccount(r))
      .catch(() => setVercelAccount({ connected: false }));
  }, []);

  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light') return false;
    } catch {
      // Ignore
    }
    return true;
  });

  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('preview');
  const [deviceViewport, setDeviceViewport] = useState<DeviceViewport>('desktop');
  const [mobilePane, setMobilePane] = useState<'chat' | 'canvas'>('chat');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [promptInput, setPromptInput] = useState('');
  const [buildMode, setBuildMode] = useState<BuildMode>('full');
  const [designPreset, setDesignPreset] = useState<DesignPreset>('auto');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState('src/App.tsx');
  const [runtimeError, setRuntimeError] = useState<RuntimeErrorEvent | null>(null);

  const [compiledHtml, setCompiledHtml] = useState('');
  const [standaloneHtml, setStandaloneHtml] = useState('');
  const [compileErrors, setCompileErrors] = useState<string[]>([]);
  const [isCompiling, setIsCompiling] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const skipNextAutoBundleRef = useRef(false);
  const startedInitialRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<Record<string, string>>({});
  const standaloneRef = useRef('');

  useEffect(() => {
    standaloneRef.current = standaloneHtml;
  }, [standaloneHtml]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    } catch {
      // Ignore
    }
  }, [isDark]);

  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === activeProjectId) || projects[0];
  }, [projects, activeProjectId]);

  // ------------------------------------------------------------ carregar projetos da conta
  const createServerProject = useCallback(async (name: string, prompt = ''): Promise<StudioProject> => {
    const res = await apiClient<{ project: ProjectMeta & { files: Record<string, string>; messages: ChatMessage[] } }>('/api/forja/projects', {
      method: 'POST',
      body: JSON.stringify({ name, prompt }),
    });
    const p: StudioProject = { ...fromMeta({ ...res.project, fileCount: 0 }), files: {}, messages: [] };
    lastSavedRef.current[p.id] = '';
    setLoadedIds((prev) => new Set(prev).add(p.id));
    return p;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiClient<{ projects: ProjectMeta[] }>('/api/forja/projects');
        let items = list.projects.map(fromMeta);
        let targetId = openProjectId && items.some((p) => p.id === openProjectId) ? openProjectId : '';
        if (initialPrompt?.trim()) {
          const fresh = await createServerProject('Novo projeto', initialPrompt.trim());
          items = [fresh, ...items];
          targetId = fresh.id;
        } else if (items.length === 0) {
          const fresh = await createServerProject('Meu Site em Produção');
          items = [fresh];
          targetId = fresh.id;
        }
        if (cancelled) return;
        setProjects(items);
        setActiveProjectId(targetId || items[0].id);
      } catch (e) {
        if (!cancelled) setBootError((e as Error).message || 'Não consegui abrir os seus projetos.');
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Só na abertura do estúdio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carrega arquivos e conversa do projeto escolhido.
  useEffect(() => {
    const id = activeProject?.id;
    if (!id || loadedIds.has(id)) return;
    let cancelled = false;
    apiClient<{ project: StudioProject }>(`/api/forja/projects/${encodeURIComponent(id)}`)
      .then((res) => {
        if (cancelled) return;
        const full = res.project;
        lastSavedRef.current[id] = JSON.stringify({ n: full.name, f: full.files, m: full.messages?.length || 0 });
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, files: full.files || {}, messages: full.messages || [], productionUrl: full.productionUrl || null } : p)));
        setLoadedIds((prev) => new Set(prev).add(id));
        const firstFile = Object.keys(full.files || {}).find((f) => f === 'src/App.tsx') || Object.keys(full.files || {})[0];
        if (firstFile) setActiveFilePath(firstFile);
      })
      .catch(() => {
        if (!cancelled) setLoadedIds((prev) => new Set(prev).add(id));
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, loadedIds]);

  // ------------------------------------------------------------ salvamento automático
  const saveProject = useCallback(
    async (proj: StudioProject) => {
      const signature = JSON.stringify({ n: proj.name, f: proj.files, m: proj.messages.length });
      if (lastSavedRef.current[proj.id] === signature) return;
      setSaveState('saving');
      try {
        const html = standaloneRef.current;
        const r = await apiClient<{ ok: boolean }>(`/api/forja/projects/${encodeURIComponent(proj.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ name: proj.name, slug: proj.slug, files: proj.files, messages: proj.messages, standaloneHtml: html }),
        });
        if (r.ok) {
          lastSavedRef.current[proj.id] = signature;
          setSaveState('saved');
          onProjectSaved?.({ id: proj.id, name: proj.name, standaloneHtml: html });
        }
      } catch {
        setSaveState('error');
      }
    },
    [onProjectSaved],
  );

  useEffect(() => {
    if (!activeProject || isGenerating || !loadedIds.has(activeProject.id)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const snapshot = activeProject;
    saveTimerRef.current = setTimeout(() => {
      void saveProject(snapshot);
    }, SAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [activeProject, isGenerating, loadedIds, saveProject, standaloneHtml]);

  // ------------------------------------------------------------ prévia (compilação no servidor)
  const compileProjectFiles = useCallback(async (files: Record<string, string>) => {
    if (Object.keys(files).length === 0) {
      setCompiledHtml('');
      setStandaloneHtml('');
      setCompileErrors([]);
      return;
    }
    setIsCompiling(true);
    try {
      const data = await apiClient<{ ok?: boolean; compiledHtml?: string; standaloneHtml?: string; errors?: string[] }>('/api/forja/preview/bundle', {
        method: 'POST',
        body: JSON.stringify({ files }),
      });
      if (data.ok && data.compiledHtml) {
        setCompiledHtml(data.compiledHtml);
        setStandaloneHtml(data.standaloneHtml || data.compiledHtml);
        setCompileErrors([]);
      } else {
        setCompileErrors(data.errors || ['Falha na compilação do projeto.']);
      }
    } catch (e) {
      if (!files['src/App.tsx'] && files['index.html']) {
        setCompiledHtml(assembleStandaloneHtml(files, { withErrorBridge: true }));
        setStandaloneHtml(assembleStandaloneHtml(files, { withErrorBridge: false }));
      } else {
        const msg = (e as { message?: string })?.message;
        setCompileErrors([msg || 'Não consegui compilar a prévia agora.']);
      }
    } finally {
      setIsCompiling(false);
    }
  }, []);

  useEffect(() => {
    if (!activeProject || isGenerating || !loadedIds.has(activeProject.id)) return;
    if (skipNextAutoBundleRef.current) {
      skipNextAutoBundleRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void compileProjectFiles(activeProject.files);
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, activeProject?.files, isGenerating, compileProjectFiles, loadedIds]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; payload?: RuntimeErrorEvent } | null;
      if (data?.type === 'FORJA_PREVIEW_ERROR' && data.payload?.message) {
        setRuntimeError(data.payload);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const hasFiles = Boolean(activeProject?.files['src/App.tsx'] || activeProject?.files['index.html']);

  const auditChecks = useMemo(() => {
    if (!activeProject) return [];
    return runProductionAudit(activeProject.name, activeProject.files, standaloneHtml);
  }, [activeProject, standaloneHtml]);

  const auditIssuesCount = useMemo(() => auditChecks.filter((c) => c.status !== 'pass').length, [auditChecks]);

  const updateActiveProject = useCallback(
    (updater: (prev: StudioProject) => StudioProject) => {
      if (!activeProject) return;
      const targetId = activeProject.id;
      setProjects((prevList) => prevList.map((proj) => (proj.id === targetId ? updater(proj) : proj)));
    },
    [activeProject],
  );

  const resetCanvas = () => {
    setCompiledHtml('');
    setStandaloneHtml('');
    setCompileErrors([]);
    setRuntimeError(null);
  };

  const handleCreateProject = async () => {
    if (isGenerating) return;
    try {
      const fresh = await createServerProject(`Novo Projeto ${projects.length + 1}`);
      setProjects((prev) => [fresh, ...prev]);
      setActiveProjectId(fresh.id);
      resetCanvas();
      setWorkspaceView('preview');
    } catch (e) {
      setBootError((e as Error).message);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (projects.length <= 1 || isGenerating) return;
    try {
      await apiClient(`/api/forja/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      // Se o servidor não apagar, o projeto volta na próxima abertura.
    }
    const nextList = projects.filter((p) => p.id !== id);
    setProjects(nextList);
    if (activeProject?.id === id) {
      setActiveProjectId(nextList[0].id);
      resetCanvas();
    }
  };

  const handleRenameProject = (id: string, name: string) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name, slug: slugifyProjectName(name), updatedAt: Date.now() } : p)));
  };

  const handleUpdateFile = (filePath: string, content: string) => {
    setRuntimeError(null);
    updateActiveProject((proj) => ({ ...proj, updatedAt: Date.now(), files: { ...proj.files, [filePath]: content } }));
  };

  const handleStopStreaming = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGenerating(false);
  };

  // Publicar: salva, compila no servidor e coloca no ar (mesmo link a cada atualização).
  const handlePublish = async (justConnected = false) => {
    if (!activeProject || !hasFiles || isGenerating || publishState === 'publishing') return;
    if (!justConnected && vercelAccount && !vercelAccount.connected) {
      setVercelError(null);
      setVercelModal(true);
      return;
    }
    setPublishState('publishing');
    setPublishNotice(null);
    try {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      await saveProject(activeProject);
      const r = await apiClient<{ ok: boolean; url: string }>(`/api/forja/projects/${encodeURIComponent(activeProject.id)}/publish`, { method: 'POST', body: '{}' });
      const targetId = activeProject.id;
      setProjects((prev) => prev.map((p) => (p.id === targetId ? { ...p, productionUrl: r.url } : p)));
      setPublishState('idle');
      setPublishNotice({ kind: 'ok', text: 'Seu site está no ar!', url: r.url });
      onProjectSaved?.({ id: targetId, name: activeProject.name, standaloneHtml: standaloneRef.current, productionUrl: r.url });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setPublishState('error');
      if (code === 'vercel_not_connected' || code === 'vercel_token_refused') {
        setVercelAccount({ connected: false });
        setVercelError(code === 'vercel_token_refused' ? (e as Error).message : null);
        setVercelModal(true);
        return;
      }
      setPublishNotice({ kind: 'error', text: (e as Error)?.message || 'Não consegui publicar agora. Tente de novo.' });
    }
  };

  const handleConnectVercel = async (token: string) => {
    setVercelBusy(true);
    setVercelError(null);
    try {
      const r = await apiClient<{ connected: boolean; username: string }>('/api/forja/vercel', { method: 'POST', body: JSON.stringify({ token }) });
      setVercelAccount({ connected: true, username: r.username });
      setVercelModal(false);
      setPublishState('idle');
      // Conectou: publica na hora.
      setTimeout(() => {
        void publishRef.current(true);
      }, 0);
    } catch (e) {
      setVercelError((e as Error)?.message || 'Não consegui conectar agora.');
    } finally {
      setVercelBusy(false);
    }
  };

  const handleDisconnectVercel = async () => {
    setVercelBusy(true);
    try {
      await apiClient('/api/forja/vercel', { method: 'DELETE' });
      setVercelAccount({ connected: false });
    } catch (e) {
      setVercelError((e as Error)?.message || 'Não consegui desconectar agora.');
    } finally {
      setVercelBusy(false);
    }
  };

  const publishRef = useRef(handlePublish);
  publishRef.current = handlePublish;

  const handleClose = () => {
    if (isGenerating) handleStopStreaming();
    if (activeProject && loadedIds.has(activeProject.id)) void saveProject(activeProject);
    onClose();
  };

  const handleSubmitPrompt = async (overridePrompt?: string) => {
    const text = (overridePrompt ?? promptInput).trim();
    if (!text || isGenerating || !activeProject) return;

    if (!overridePrompt) setPromptInput('');
    setRuntimeError(null);
    setCompileErrors([]);
    setIsGenerating(true);

    const userMsgId = `msg_u_${Date.now()}`;
    const assistantMsgId = `msg_a_${Date.now() + 1}`;

    const historyPayload = activeProject.messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.role === 'user' ? m.content : m.summary || m.plan || 'Arquivos gerados com sucesso.' }));

    const filesSnapshot = { ...activeProject.files };
    const shouldAutoName =
      activeProject.messages.length === 0 &&
      (activeProject.name === 'Meu Site em Produção' || activeProject.name === 'Novo projeto' || activeProject.name.startsWith('Novo Projeto'));
    const derivedTitle = text.replace(/^(crie|faça|construa|gere|desenvolva)\s+(um|uma)\s+/i, '').slice(0, 38).trim();

    const userMsg: ChatMessage = { id: userMsgId, role: 'user', content: text, createdAt: Date.now() };
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      plan: '',
      summary: '',
      phase: 'planning',
      phaseLabel: 'Conectando ao arquiteto...',
      files: [],
      createdAt: Date.now(),
    };

    updateActiveProject((proj) => ({
      ...proj,
      name: shouldAutoName && derivedTitle.length >= 4 ? derivedTitle : proj.name,
      updatedAt: Date.now(),
      messages: [...proj.messages, userMsg, assistantMsg],
    }));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const liveFiles: Record<string, string> = { ...filesSnapshot };
    const streamedFileMeta = new Map<string, GeneratedFileMeta>();

    const updateAssistantMessage = (patcher: (msg: ChatMessage) => ChatMessage, syncFiles = false) => {
      updateActiveProject((proj) => ({
        ...proj,
        updatedAt: Date.now(),
        files: syncFiles ? { ...liveFiles } : proj.files,
        messages: proj.messages.map((m) => (m.id === assistantMsgId ? patcher(m) : m)),
      }));
    };

    const onEvent = ({ event: eventName, data }: { event: string; data: unknown }) => {
      const payload = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      if (eventName === 'phase') {
        const phase = (payload.phase as BuildPhase) || 'coding';
        const label = String(payload.label || '');
        updateAssistantMessage((m) => ({ ...m, phase, phaseLabel: label }));
      } else if (eventName === 'plan_delta') {
        const delta = String(payload.text || '');
        updateAssistantMessage((m) => ({ ...m, plan: (m.plan || '') + delta }));
      } else if (eventName === 'file_start') {
        const filePath = String(payload.path || '');
        liveFiles[filePath] = '';
        streamedFileMeta.set(filePath, { path: filePath, status: 'writing', lines: 0, bytes: 0 });
        setActiveFilePath(filePath);
        updateAssistantMessage((m) => ({ ...m, files: Array.from(streamedFileMeta.values()) }));
      } else if (eventName === 'file_delta') {
        const filePath = String(payload.path || '');
        liveFiles[filePath] = (liveFiles[filePath] || '') + String(payload.chunk || '');
        const fullText = liveFiles[filePath];
        streamedFileMeta.set(filePath, { path: filePath, status: 'writing', lines: countLines(fullText), bytes: fullText.length });
        updateAssistantMessage((m) => ({ ...m, files: Array.from(streamedFileMeta.values()) }));
      } else if (eventName === 'file_end') {
        const filePath = String(payload.path || '');
        const fullText = liveFiles[filePath] || '';
        streamedFileMeta.set(filePath, { path: filePath, status: 'complete', lines: countLines(fullText), bytes: fullText.length });
        updateAssistantMessage((m) => ({ ...m, files: Array.from(streamedFileMeta.values()) }), true);
      } else if (eventName === 'summary_delta') {
        const delta = String(payload.text || '');
        updateAssistantMessage((m) => ({ ...m, summary: (m.summary || '') + delta }));
      } else if (eventName === 'review') {
        const reviews = Array.isArray(payload.reviews) ? (payload.reviews as ChatMessage['review']) : [];
        updateAssistantMessage((m) => ({ ...m, review: reviews }));
      } else if (eventName === 'files_final') {
        // Versão final exata do servidor (inclusive se uma melhoria foi desfeita).
        const finalFiles = (payload.files && typeof payload.files === 'object' ? payload.files : {}) as Record<string, string>;
        for (const key of Object.keys(liveFiles)) delete liveFiles[key];
        Object.assign(liveFiles, finalFiles);
        updateAssistantMessage((m) => m, true);
      } else if (eventName === 'bundle_ready') {
        const readyCompiled = String(payload.compiledHtml || '');
        const readyStandalone = String(payload.standaloneHtml || readyCompiled);
        skipNextAutoBundleRef.current = true;
        standaloneRef.current = readyStandalone;
        setCompiledHtml(readyCompiled);
        setStandaloneHtml(readyStandalone);
        setCompileErrors([]);
        setReloadKey((k) => k + 1);
      } else if (eventName === 'done') {
        updateAssistantMessage((m) => ({ ...m, phase: 'done', phaseLabel: 'Compilado e pronto para produção' }), true);
        setMobilePane('canvas');
      } else if (eventName === 'error') {
        const errMessage = String(payload.message || 'Erro durante a geração.');
        updateAssistantMessage((m) => ({ ...m, phase: 'error', error: errMessage }));
      }
    };

    try {
      await streamApiEvents(
        '/api/forja/build/stream',
        { prompt: text, history: historyPayload, currentFiles: filesSnapshot, buildMode, designPreset, idempotencyKey: assistantMsgId },
        { signal: controller.signal, onEvent },
      );
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        updateAssistantMessage((m) => ({ ...m, phase: 'done', summary: (m.summary || '') + '\n\nGeração interrompida pelo usuário.' }), true);
      } else {
        const message = err instanceof Error ? err.message : 'Falha de comunicação com o servidor.';
        updateAssistantMessage((m) => ({ ...m, phase: 'error', error: message }));
      }
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  // Pedido vindo da conversa da Froc.IA: começa a construir assim que o projeto abre.
  useEffect(() => {
    if (startedInitialRef.current || !initialPrompt?.trim() || booting || !activeProject) return;
    if (!loadedIds.has(activeProject.id)) return;
    startedInitialRef.current = true;
    void handleSubmitPrompt(initialPrompt.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booting, activeProject?.id, loadedIds, initialPrompt]);

  const handleInspectFile = (filePath: string) => {
    setActiveFilePath(filePath);
    setWorkspaceView('code');
    setMobilePane('canvas');
  };

  const handleAutoFixRuntimeError = () => {
    if (!runtimeError || isGenerating) return;
    const fixPrompt = `Corrija o seguinte erro ocorrido na execução do aplicativo: "${runtimeError.message}" (linha ${runtimeError.line || 0}). Retorne os arquivos atualizados garantindo execução 100% livre de erros.`;
    setRuntimeError(null);
    void handleSubmitPrompt(fixPrompt);
  };

  const handleFixAuditIssues = (prompts: string[]) => {
    if (prompts.length === 0 || isGenerating) return;
    void handleSubmitPrompt(`Aplique as seguintes melhorias de produção no projeto atual:\n- ${prompts.join('\n- ')}`);
  };

  const handleExportZip = async () => {
    if (!activeProject || !hasFiles) return;
    const blob = await exportProjectAsZip(activeProject.name, activeProject.files, standaloneHtml);
    triggerFileDownload(blob, `${slugifyProjectName(activeProject.name)}.zip`);
  };

  const handleExportSingleHtml = () => {
    if (!activeProject || !hasFiles) return;
    const html = standaloneHtml || assembleStandaloneHtml(activeProject.files, { withErrorBridge: false });
    triggerFileDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), `${slugifyProjectName(activeProject.name)}.html`);
  };

  const handleCopyHtml = async (): Promise<boolean> => {
    if (!activeProject || !hasFiles) return false;
    const html = standaloneHtml || assembleStandaloneHtml(activeProject.files, { withErrorBridge: false });
    try {
      await navigator.clipboard.writeText(html);
      return true;
    } catch {
      return false;
    }
  };

  if (booting || !activeProject) {
    return (
      <div className={`${isDark ? 'dark' : ''} fixed inset-0 z-[60]`}>
        <div className="forja-studio h-full w-full flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-[#0B0F17] text-slate-700 dark:text-slate-300">
          {bootError ? (
            <>
              <p className="text-sm max-w-sm text-center">{bootError}</p>
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium">
                Voltar
              </button>
            </>
          ) : (
            <>
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <p className="text-sm">Abrindo o estúdio…</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`${isDark ? 'dark' : ''} fixed inset-0 z-[60]`}>
    <div className="forja-studio h-full w-full flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      <TopBar
        projects={projects}
        activeProject={activeProject}
        onSelectProject={(id) => {
          if (!isGenerating) {
            setActiveProjectId(id);
            setRuntimeError(null);
            setCompileErrors([]);
          }
        }}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProject}
        workspaceView={workspaceView}
        onChangeView={(view) => {
          setWorkspaceView(view);
          setMobilePane('canvas');
        }}
        deviceViewport={deviceViewport}
        onChangeDevice={setDeviceViewport}
        onReloadPreview={() => {
          setRuntimeError(null);
          setReloadKey((k) => k + 1);
        }}
        onToggleFullscreen={() => setIsFullscreen((v) => !v)}
        isDark={isDark}
        onToggleTheme={() => setIsDark((v) => !v)}
        hasFiles={hasFiles}
        auditIssuesCount={auditIssuesCount}
        onExportZip={handleExportZip}
        onExportSingleHtml={handleExportSingleHtml}
        onCopyHtml={handleCopyHtml}
        onClose={handleClose}
        saveState={saveState}
        onPublish={() => void handlePublish()}
        publishState={publishState}
        productionUrl={activeProject?.productionUrl}
      />

      {publishNotice && (
        <div
          role="status"
          className={`shrink-0 flex flex-wrap items-center gap-2 px-4 py-2 text-xs border-b ${
            publishNotice.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300'
          }`}
        >
          {publishNotice.kind === 'ok' ? <Rocket className="w-3.5 h-3.5 shrink-0" /> : null}
          <span className="font-semibold">{publishNotice.text}</span>
          {publishNotice.url && (
            <>
              <a href={publishNotice.url} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2 break-all">
                {publishNotice.url}
              </a>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(publishNotice.url || '');
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 1500);
                  } catch {
                    // Sem permissão de área de transferência: o link continua visível.
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/70 dark:bg-white/10 font-medium"
              >
                {linkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {linkCopied ? 'Copiado' : 'Copiar link'}
              </button>
              <a
                href={publishNotice.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/70 dark:bg-white/10 font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Abrir
              </a>
            </>
          )}
          {publishNotice.kind === 'ok' && vercelAccount?.username && (
            <button type="button" onClick={() => { setVercelError(null); setVercelModal(true); }} className="underline underline-offset-2 opacity-80">
              na sua Vercel ({vercelAccount.username})
            </button>
          )}
          <button type="button" onClick={() => setPublishNotice(null)} aria-label="Fechar aviso" className="ml-auto p-1 rounded hover:bg-black/5 dark:hover:bg-white/10">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {vercelModal && (
        <ConnectVercel
          username={vercelAccount?.connected ? vercelAccount.username : null}
          isBusy={vercelBusy}
          error={vercelError}
          onConnect={handleConnectVercel}
          onDisconnect={handleDisconnectVercel}
          onClose={() => {
            setVercelModal(false);
            setPublishState('idle');
          }}
        />
      )}

      {/* Mobile Pane Switcher (< md) */}
      <div className="md:hidden flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E131D] shrink-0">
        <button
          type="button"
          onClick={() => setMobilePane('chat')}
          className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            mobilePane === 'chat'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 dark:text-slate-400'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Arquiteto</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMobilePane('canvas');
            setWorkspaceView('preview');
          }}
          className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            mobilePane === 'canvas' && workspaceView === 'preview'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 dark:text-slate-400'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Site</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMobilePane('canvas');
            setWorkspaceView('code');
          }}
          className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            mobilePane === 'canvas' && workspaceView === 'code'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 dark:text-slate-400'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Código</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMobilePane('canvas');
            setWorkspaceView('audit');
          }}
          className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
            mobilePane === 'canvas' && workspaceView === 'audit'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 dark:text-slate-400'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Auditoria</span>
        </button>
      </div>

      {/* Main Split Workspace */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Pane: AI Architect Chat */}
        <div
          className={`${
            mobilePane === 'chat' ? 'flex' : 'hidden'
          } md:flex w-full md:w-[390px] lg:w-[420px] shrink-0 flex-col h-full min-h-0`}
        >
          <ChatArchitect
            messages={activeProject?.messages ?? []}
            promptInput={promptInput}
            onChangePrompt={setPromptInput}
            onSubmitPrompt={handleSubmitPrompt}
            onStopStreaming={handleStopStreaming}
            isGenerating={isGenerating}
            buildMode={buildMode}
            onChangeBuildMode={setBuildMode}
            designPreset={designPreset}
            onChangeDesignPreset={setDesignPreset}
            onInspectFile={handleInspectFile}
            runtimeError={runtimeError}
            onAutoFixRuntimeError={handleAutoFixRuntimeError}
            onDismissRuntimeError={() => setRuntimeError(null)}
            creditCost={creditCost}
          />
        </div>

        {/* Right Pane: Studio Canvas (Preview / Code / Audit) */}
        <div
          className={`${
            mobilePane === 'canvas' ? 'flex' : 'hidden'
          } md:flex flex-1 flex-col min-w-0 h-full min-h-0`}
        >
          {workspaceView === 'preview' && (
            <PreviewCanvas
              files={activeProject?.files ?? {}}
              compiledHtml={compiledHtml}
              compileErrors={compileErrors}
              isCompiling={isCompiling}
              deviceViewport={deviceViewport}
              reloadKey={reloadKey}
              isGenerating={isGenerating}
              isFullscreen={isFullscreen}
              onExitFullscreen={() => setIsFullscreen(false)}
              projectId={activeProject.id}
            />
          )}

          {workspaceView === 'code' && (
            <CodeExplorer
              projectName={activeProject?.name ?? 'Projeto'}
              files={activeProject?.files ?? {}}
              standaloneHtml={standaloneHtml}
              activeFilePath={activeFilePath}
              onSelectFile={setActiveFilePath}
              onUpdateFile={handleUpdateFile}
            />
          )}

          {workspaceView === 'audit' && (
            <AuditPanel
              checks={auditChecks}
              hasFiles={hasFiles}
              isGenerating={isGenerating}
              onFixAuditIssues={handleFixAuditIssues}
              onExportZip={handleExportZip}
            />
          )}
        </div>
      </main>
    </div>
    </div>
  );
}
