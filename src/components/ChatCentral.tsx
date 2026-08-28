import React, {
  useEffect,
  useRef,
  useState
} from 'react';
import {
  Check,
  ChevronDown,
  Code2,
  Copy,
  Eye,
  ExternalLink,
  FileCode2,
  Globe,
  Image as ImageIcon,
  Layout,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Video,
  Volume2,
  VolumeX,
  X,
  Zap
} from 'lucide-react';
import {
  ArtifactData,
  ChatMessage,
  ChatMode,
  KnowledgeBase,
  ZipProjectAnalysis,
  UploadedFile,
  UserProfile
} from '../types';
import {
  AttachmentMenu,
  AttachmentOptionId
} from './AttachmentMenu';
import { MascotWidget } from './MascotWidget';
import { CameraScannerModal } from './CameraScannerModal';
import { CodeSnippetModal } from './CodeSnippetModal';
import { UrlImporterModal } from './UrlImporterModal';
import { VoiceRecorderModal } from './VoiceRecorderModal';
import { ZipInspectorModal } from './ZipInspectorModal';
import { KnowledgeBaseModal } from './KnowledgeBaseModal';
import {
  AttachmentValidationError,
  MAX_DIRECT_ATTACHMENTS,
  MAX_DIRECT_PAYLOAD_BYTES,
  createDataUrlAttachment,
  createTextAttachment,
  prepareNativeFiles
} from '../services/attachmentService';

interface ChatCentralProps {
  messages: ChatMessage[];
  onSendMessage: (
    text: string,
    mode: ChatMode,
    files: UploadedFile[]
  ) => Promise<void>;
  onStopGeneration: () => void;
  isGenerating: boolean;
  selectedMode: ChatMode;
  setSelectedMode: (mode: ChatMode) => void;
  user: UserProfile;
  onOpenArtifact: (artifact: ArtifactData) => void;
  onOpenCostModal: (
    opType: string,
    credits: number,
    desc: string,
    onConfirmAction: () => void
  ) => void;
}

interface ModeDefinition {
  name: ChatMode;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  laboratory?: boolean;
}

const CHAT_MODES: ModeDefinition[] = [
  {
    name: 'Rápido',
    description: 'Respostas diretas e rápidas',
    icon: Zap
  },
  {
    name: 'Inteligente',
    description: 'Equilíbrio entre velocidade e raciocínio',
    icon: Sparkles
  },
  {
    name: 'Profundo',
    description: 'Análises detalhadas e complexas',
    icon: Search
  },
  {
    name: 'Programação',
    description: 'Código, sistemas e desenvolvimento',
    icon: Code2
  },
  {
    name: 'Pesquisa',
    description: 'Pesquisa e organização de informações',
    icon: Globe
  },
  {
    name: 'Criador de projetos',
    description: 'Sites, aplicativos e sistemas completos',
    icon: Layout
  },
  {
    name: 'Imagem',
    description: 'Criação e edição visual',
    icon: ImageIcon,
    laboratory: true
  },
  {
    name: 'Vídeo',
    description: 'Criação e produção audiovisual',
    icon: Video,
    laboratory: true
  }
];

const SUGGESTIONS: Array<{
  label: string;
  prompt: string;
  mode: ChatMode;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    label: 'Criar um site',
    prompt:
      'Crie um site moderno, responsivo e profissional para minha empresa.',
    mode: 'Criador de projetos',
    icon: Layout
  },
  {
    label: 'Desenvolver um aplicativo',
    prompt:
      'Planeje e desenvolva a estrutura completa de um aplicativo moderno.',
    mode: 'Criador de projetos',
    icon: Code2
  },
  {
    label: 'Analisar código',
    prompt:
      'Analise meu código, encontre problemas e apresente as correções necessárias.',
    mode: 'Programação',
    icon: FileCode2
  },
  {
    label: 'Fazer uma pesquisa',
    prompt:
      'Pesquise este assunto e apresente uma análise organizada e fundamentada.',
    mode: 'Pesquisa',
    icon: Globe
  },
  {
    label: 'Criar uma imagem',
    prompt:
      'Crie uma imagem profissional com base na descrição que vou fornecer.',
    mode: 'Imagem',
    icon: ImageIcon
  },
  {
    label: 'Criar um vídeo',
    prompt:
      'Crie um vídeo profissional com base no roteiro e estilo que vou fornecer.',
    mode: 'Vídeo',
    icon: Video
  }
];

export const ChatCentral: React.FC<
  ChatCentralProps
> = ({
  messages,
  onSendMessage,
  onStopGeneration,
  isGenerating,
  selectedMode,
  setSelectedMode,
  user,
  onOpenArtifact
}) => {
  const [inputText, setInputText] = useState('');
  const [attachedFiles, setAttachedFiles] =
    useState<UploadedFile[]>([]);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] =
    useState(false);
  const [attachmentError, setAttachmentError] =
    useState<string | null>(null);
  const [isPreparingAttachment, setIsPreparingAttachment] =
    useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const [isCodeOpen, setIsCodeOpen] = useState(false);
  const [urlImporterType, setUrlImporterType] = useState<
    'url' | 'github' | null
  >(null);
  const [zipForInspection, setZipForInspection] =
    useState<UploadedFile | null>(null);
  const [isKnowledgeBaseOpen, setIsKnowledgeBaseOpen] =
    useState(false);
  const [isModeMenuOpen, setIsModeMenuOpen] =
    useState(false);
  const [copiedId, setCopiedId] =
    useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] =
    useState<string | null>(null);
  const [ratedMessages, setRatedMessages] = useState<Record<string, 'up' | 'down'>>({});

  const handleRate = (messageId: string, rating: 'up' | 'down') => {
    setRatedMessages((prev) => ({
      ...prev,
      [messageId]: prev[messageId] === rating ? (undefined as any) : rating,
    }));
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  const currentMode =
    CHAT_MODES.find(
      (mode) => mode.name === selectedMode
    ) ?? CHAT_MODES[0];

  const CurrentModeIcon = currentMode.icon;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth'
    });
  }, [messages, isGenerating]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        modeMenuRef.current &&
        !modeMenuRef.current.contains(event.target as Node)
      ) {
        setIsModeMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModeMenuOpen(false);
        setIsAttachmentMenuOpen(false);
        setIsCameraOpen(false);
        setIsVoiceOpen(false);
        setIsCodeOpen(false);
        setUrlImporterType(null);
        setZipForInspection(null);
        setIsKnowledgeBaseOpen(false);
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

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleCopy = async (
    messageId: string,
    text: string
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(messageId);

      window.setTimeout(() => {
        setCopiedId(null);
      }, 2000);
    } catch {
      setCopiedId(null);
    }
  };

  const handleSpeak = (
    messageId: string,
    text: string
  ) => {
    if (!('speechSynthesis' in window)) {
      return;
    }

    if (speakingMsgId === messageId) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }

    window.speechSynthesis.cancel();

    const utterance =
      new SpeechSynthesisUtterance(text);

    utterance.lang = 'pt-BR';

    utterance.onend = () => {
      setSpeakingMsgId(null);
    };

    utterance.onerror = () => {
      setSpeakingMsgId(null);
    };

    window.speechSynthesis.speak(utterance);
    setSpeakingMsgId(messageId);
  };

  const appendAttachment = (file: UploadedFile) => {
    if (
      file.source !== 'knowledge-base' &&
      file.type !== 'zip' &&
      (!file.contentBase64 || !file.hash || !file.mime)
    ) {
      setAttachmentError(
        `O anexo “${file.name}” não possui conteúdo validado.`
      );
      return;
    }

    setAttachedFiles((current) => {
      const next = [...current, file];
      const directFiles = next.filter(
        (item) =>
          item.type !== 'zip' &&
          item.source !== 'knowledge-base'
      );
      const totalBytes = directFiles.reduce(
        (sum, item) => sum + item.size,
        0
      );

      if (directFiles.length > MAX_DIRECT_ATTACHMENTS) {
        setAttachmentError(
          `Envie no máximo ${MAX_DIRECT_ATTACHMENTS} anexos por mensagem.`
        );
        return current;
      }

      if (totalBytes > MAX_DIRECT_PAYLOAD_BYTES) {
        setAttachmentError(
          'Os anexos excedem o limite seguro desta mensagem.'
        );
        return current;
      }

      setAttachmentError(null);
      return next;
    });
  };

  const handleFiles = async (files: File[]) => {
    setIsPreparingAttachment(true);
    setAttachmentError(null);

    try {
      const preparedFiles = await prepareNativeFiles(files);
      const zipFile = preparedFiles.find(
        (file) => file.type === 'zip'
      );

      if (zipFile) {
        if (preparedFiles.length !== 1) {
          throw new AttachmentValidationError(
            'zip_must_be_isolated',
            'Envie o ZIP sozinho para iniciar a inspeção.'
          );
        }

        setZipForInspection(zipFile);
        return;
      }

      for (const file of preparedFiles) {
        appendAttachment(file);
      }
    } catch (error) {
      setAttachmentError(
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar os arquivos.'
      );
    } finally {
      setIsPreparingAttachment(false);
    }
  };

  const handleAttachmentOption = (
    optionId: AttachmentOptionId
  ) => {
    setAttachmentError(null);

    switch (optionId) {
      case 'camera':
        setIsCameraOpen(true);
        break;
      case 'mic':
        setIsVoiceOpen(true);
        break;
      case 'code':
        setIsCodeOpen(true);
        break;
      case 'url':
        setUrlImporterType('url');
        break;
      case 'github':
        setUrlImporterType('github');
        break;
      case 'knowledge_base':
        setIsKnowledgeBaseOpen(true);
        break;
      case 'screen_cap':
      case 'screen_share':
        void captureScreen();
        break;
      default:
        break;
    }
  };

  const captureScreen = async () => {
    setIsPreparingAttachment(true);
    setAttachmentError(null);
    let stream: MediaStream | null = null;

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error(
          'Este navegador não oferece captura de tela.'
        );
      }

      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => resolve();
        });
      }

      const maximumWidth = 1280;
      const scale = Math.min(
        1,
        maximumWidth / video.videoWidth
      );
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(
        1,
        Math.round(video.videoWidth * scale)
      );
      canvas.height = Math.max(
        1,
        Math.round(video.videoHeight * scale)
      );
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error(
          'Não foi possível processar a captura.'
        );
      }

      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      const attachment = await createDataUrlAttachment({
        name: `captura-tela-${Date.now()}.jpg`,
        dataUrl,
        source: 'screen',
        type: 'camera'
      });

      appendAttachment(attachment);
    } catch (error) {
      setAttachmentError(
        error instanceof Error
          ? error.message
          : 'A captura de tela foi cancelada.'
      );
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setIsPreparingAttachment(false);
    }
  };

  const handleZipConversion = async (
    analysis: ZipProjectAnalysis
  ) => {
    try {
      const attachment = await createTextAttachment({
        name: `${analysis.fileName.replace(/\.zip$/i, '')}-analise.json`,
        content: JSON.stringify(analysis, null, 2),
        mimeType: 'application/json',
        source: 'zip-analysis',
        type: 'code'
      });

      appendAttachment(attachment);
      setZipForInspection(null);
    } catch (error) {
      setAttachmentError(
        error instanceof Error
          ? error.message
          : 'Não foi possível anexar a análise do ZIP.'
      );
    }
  };

  const handleSend = async () => {
    const normalizedText = inputText.trim();

    if (
      (!normalizedText && attachedFiles.length === 0) ||
      isGenerating
    ) {
      return;
    }

    const textToSend =
      normalizedText ||
      'Analise os arquivos que foram anexados.';

    try {
      await onSendMessage(
        textToSend,
        selectedMode,
        attachedFiles
      );

      setInputText('');
      setAttachedFiles([]);
      setIsAttachmentMenuOpen(false);
    } catch {
      return;
    }
  };

  const handleSuggestion = (
    prompt: string,
    mode: ChatMode
  ) => {
    setSelectedMode(mode);
    setInputText(prompt);
  };

  return (
    <section className="froc-app-background relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[#050505] text-white">
      <div
        aria-hidden="true"
        className="froc-ambient-light -right-32 top-10"
      />

      <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-white/[0.065] bg-black/45 px-4 backdrop-blur-xl md:px-6">
        <div
          ref={modeMenuRef}
          className="relative"
        >
          <button
            type="button"
            onClick={() => {
              setIsModeMenuOpen((current) => !current);
            }}
            disabled={isGenerating}
            className="glass-button flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-xs"
            aria-expanded={isModeMenuOpen}
          >
            <CurrentModeIcon className="h-4 w-4 shrink-0 text-amber-300" />

            <span className="truncate font-bold">
              {currentMode.name}
            </span>

            {currentMode.laboratory && (
              <span className="hidden rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[8px] uppercase tracking-wider text-amber-200/80 sm:inline">
                Laboratório
              </span>
            )}

            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-white/40 transition-transform ${
                isModeMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isModeMenuOpen && (
            <div className="froc-support-popover absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-2xl border border-amber-300/20 bg-[#0a0a0a]/98 p-2 shadow-[0_24px_65px_rgba(0,0,0,0.6),0_0_28px_rgba(245,196,81,0.07)] backdrop-blur-xl">
              <div className="px-2 pb-2 pt-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">
                  Escolha o modo da Froc.IA
                </p>
              </div>

              <div className="custom-scrollbar max-h-[360px] space-y-1 overflow-y-auto">
                {CHAT_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const isSelected =
                    mode.name === selectedMode;

                  return (
                    <button
                      key={mode.name}
                      type="button"
                      onClick={() => {
                        setSelectedMode(mode.name);
                        setIsModeMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        isSelected
                          ? 'froc-menu-active'
                          : 'border-transparent hover:bg-white/5'
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.035]">
                        <Icon
                          className={`h-4 w-4 ${
                            isSelected
                              ? 'text-amber-300'
                              : 'text-white/55'
                          }`}
                        />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-xs font-bold text-white">
                          {mode.name}

                          {mode.laboratory && (
                            <span className="rounded-full border border-amber-300/20 bg-amber-300/8 px-1.5 py-0.5 text-[7px] uppercase tracking-wider text-amber-200/70">
                              Laboratório
                            </span>
                          )}
                        </span>

                        <span className="mt-0.5 block truncate text-[9px] text-white/38">
                          {mode.description}
                        </span>
                      </span>

                      {isSelected && (
                        <Check className="h-3.5 w-3.5 text-amber-300" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.035] px-3 py-1.5">
          <Zap className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />
          <span className="text-[10px] font-bold text-white/72 sm:text-xs">
            {user.creditsRemaining} créditos
          </span>
        </div>
      </header>

      <div className="custom-scrollbar relative z-10 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col items-center justify-center px-4 py-10 text-center md:px-8">
            <MascotWidget
              size="lg"
              status={isGenerating ? 'thinking' : 'idle'}
              quote=""
            />

            <div className="mt-5 space-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">
                Como posso ajudar?
              </h1>

              <p className="mx-auto max-w-xl text-sm leading-relaxed text-white/45">
                Converse, pesquise, programe e transforme
                suas ideias em projetos completos com a
                Froc.IA.
              </p>
            </div>

            <div className="mt-8 grid w-full max-w-3xl grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {SUGGESTIONS.map((suggestion) => {
                const Icon = suggestion.icon;

                return (
                  <button
                    key={suggestion.label}
                    type="button"
                    onClick={() => {
                      handleSuggestion(
                        suggestion.prompt,
                        suggestion.mode
                      );
                    }}
                    className="glass-card glass-panel-hover group flex items-center gap-3 rounded-2xl p-3.5 text-left"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/18 bg-amber-300/[0.065] text-amber-300">
                      <Icon className="h-4 w-4" />
                    </span>

                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-white/85 group-hover:text-white">
                        {suggestion.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[9px] text-white/35">
                        Modo {suggestion.mode}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 pb-36 pt-7 md:px-6">
            <div className="space-y-8">
              {messages.map((message) => {
                const isAi = message.sender === 'ai';

                return (
                  <article
                    key={message.id}
                    className={`froc-message-enter flex gap-3 md:gap-4 ${
                      isAi
                        ? 'items-start'
                        : 'flex-row-reverse items-start'
                    }`}
                  >
                    {isAi ? (
                      <div className="mt-1 h-10 w-10 shrink-0">
                        <MascotWidget
                          size="sm"
                          quote=""
                          showBadge={false}
                          status={
                            speakingMsgId === message.id
                              ? 'speaking'
                              : 'idle'
                          }
                        />
                      </div>
                    ) : (
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-300/20 bg-gradient-to-br from-amber-300 to-amber-600 text-xs font-black text-black">
                        {user.name
                          ?.trim()
                          .charAt(0)
                          .toUpperCase() || 'U'}
                      </div>
                    )}

                    <div
                      className={`min-w-0 ${
                        isAi
                          ? 'max-w-[calc(100%-52px)] flex-1'
                          : 'max-w-[82%]'
                      }`}
                    >
                      <div
                        className={
                          isAi
                            ? 'px-1 py-2 text-sm leading-7 text-white/88'
                            : 'rounded-3xl rounded-tr-md border border-white/10 bg-white/[0.075] px-4 py-3 text-sm leading-relaxed text-white shadow-[0_12px_35px_rgba(0,0,0,0.22)]'
                        }
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {message.text}
                        </div>
                      </div>

                      {isAi &&
                        message.citations &&
                        message.citations.length > 0 && (
                          <section
                            aria-label="Fontes da resposta"
                            className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3"
                          >
                            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-amber-200/75">
                              <Globe className="h-3.5 w-3.5" />
                              Fontes verificáveis
                            </div>

                            <div className="space-y-2">
                              {message.citations.map(
                                (citation, citationIndex) => {
                                  const isPublicWebSource =
                                    citation.sourceType !==
                                      'knowledge_base' &&
                                    citation.uri.startsWith(
                                      'https://'
                                    );
                                  const label =
                                    citation.index ||
                                    citationIndex + 1;
                                  const content = (
                                    <>
                                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-300/10 text-[9px] font-black text-amber-200">
                                        {label}
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[11px] font-bold text-white/80">
                                          {citation.title}
                                        </span>
                                        {citation.domain && (
                                          <span className="mt-0.5 block truncate text-[9px] text-white/35">
                                            {citation.domain}
                                          </span>
                                        )}
                                        {citation.supportedText && (
                                          <span className="mt-1 block line-clamp-2 text-[10px] leading-4 text-white/55">
                                            “{citation.supportedText}”
                                          </span>
                                        )}
                                      </span>
                                      {isPublicWebSource && (
                                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/35" />
                                      )}
                                    </>
                                  );

                                  return isPublicWebSource ? (
                                    <a
                                      key={`${citation.uri}-${label}`}
                                      href={citation.uri}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.025] px-2.5 py-2 transition hover:border-amber-300/20 hover:bg-amber-300/[0.05]"
                                      title={citation.snippet}
                                    >
                                      {content}
                                    </a>
                                  ) : (
                                    <div
                                      key={`${citation.uri}-${label}`}
                                      className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.025] px-2.5 py-2"
                                      title={citation.snippet}
                                    >
                                      {content}
                                    </div>
                                  );
                                }
                              )}
                            </div>
                          </section>
                        )}

                      {isAi && (
                        <div className="mt-2 flex items-center gap-1.5 text-white/40 text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              void handleCopy(
                                message.id,
                                message.text
                              );
                            }}
                            className="rounded-lg p-1.5 transition-colors hover:bg-white/10 hover:text-white"
                            title="Copiar resposta"
                          >
                            {copiedId === message.id ? (
                              <Check className="h-3.5 w-3.5 text-amber-300" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              handleSpeak(
                                message.id,
                                message.text
                              );
                            }}
                            className="rounded-lg p-1.5 transition-colors hover:bg-white/10 hover:text-white"
                            title={
                              speakingMsgId === message.id
                                ? 'Parar leitura'
                                : 'Ouvir resposta'
                            }
                          >
                            {speakingMsgId === message.id ? (
                              <VolumeX className="h-3.5 w-3.5 text-amber-300" />
                            ) : (
                              <Volume2 className="h-3.5 w-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRate(message.id, 'up')}
                            className={`rounded-lg p-1.5 transition-colors hover:bg-white/10 ${
                              ratedMessages[message.id] === 'up'
                                ? 'text-amber-300 bg-amber-400/10'
                                : 'hover:text-white'
                            }`}
                            title="Gostei da resposta"
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRate(message.id, 'down')}
                            className={`rounded-lg p-1.5 transition-colors hover:bg-white/10 ${
                              ratedMessages[message.id] === 'down'
                                ? 'text-rose-400 bg-rose-500/10'
                                : 'hover:text-white'
                            }`}
                            title="Não gostei da resposta"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </button>

                          {message.isHtmlUpdate && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenArtifact({
                                  id: `artifact-${message.id}`,
                                  title:
                                    'Projeto criado pela Froc.IA',
                                  type: 'site',
                                  content: message.text
                                });
                              }}
                              className="ml-2 flex items-center gap-1.5 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-200 hover:bg-amber-400/20 transition-all"
                            >
                              <Eye className="h-3 w-3" />
                              <span>Abrir projeto</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {isGenerating && (
                <div
                  role="status"
                  className="froc-message-enter flex items-center justify-between gap-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-3.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 shrink-0">
                      <MascotWidget
                        size="sm"
                        quote=""
                        showBadge={false}
                        status="thinking"
                      />
                    </div>

                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-amber-300 flex items-center gap-2">
                        Froc.IA está pensando...
                        <span className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse [animation-delay:200ms]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse [animation-delay:400ms]" />
                        </span>
                      </span>
                      <p className="text-[10px] text-white/50">Processando com raciocínio profundo</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onStopGeneration}
                    className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/15 px-3 py-1.5 text-xs font-extrabold text-rose-300 hover:bg-rose-500/30 transition-all cursor-pointer shrink-0"
                    title="Interromper geração"
                  >
                    <Square className="h-3.5 w-3.5 fill-rose-300" />
                    <span>Parar Geração</span>
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-[#050505] via-[#050505]/96 to-transparent px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-16 md:px-6">
        <div className="pointer-events-auto mx-auto max-w-3xl">
          {attachmentError && (
            <div className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-[10px] text-red-200">
              <span>{attachmentError}</span>
              <button
                type="button"
                onClick={() => setAttachmentError(null)}
                className="shrink-0 text-red-200/60 hover:text-red-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {isPreparingAttachment && (
            <div className="mb-2 text-[10px] text-amber-200/70">
              Preparando e validando o anexo...
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className="glass-pill flex max-w-[220px] items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[10px]"
                >
                  <Paperclip className="h-3 w-3 shrink-0 text-amber-300" />
                  <span className="truncate text-white/65">
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

          <div className="relative rounded-[26px] border border-white/12 bg-[#111111]/96 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.48),0_0_28px_rgba(245,196,81,0.05)] backdrop-blur-2xl transition-all focus-within:border-amber-300/35 focus-within:shadow-[0_20px_60px_rgba(0,0,0,0.5),0_0_30px_rgba(245,196,81,0.09)]">
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsAttachmentMenuOpen(
                    (current) => !current
                  );
                }}
                disabled={
                  isGenerating || isPreparingAttachment
                }
                className="glass-button flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                title="Adicionar arquivos e ferramentas"
              >
                <Plus className="h-5 w-5 text-amber-300" />
              </button>

              <AttachmentMenu
                isOpen={isAttachmentMenuOpen}
                onClose={() =>
                  setIsAttachmentMenuOpen(false)
                }
                onSelectOption={handleAttachmentOption}
                onFileSelectNative={async (event) => {
                  if (event.target.files) {
                    await handleFiles(
                      Array.from(event.target.files)
                    );
                  }
                }}
              />

              <textarea
                value={inputText}
                onChange={(event) => {
                  setInputText(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !isGenerating
                  ) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                rows={1}
                disabled={
                  isGenerating || isPreparingAttachment
                }
                placeholder={`Mensagem para Froc.IA — ${selectedMode}`}
                className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-relaxed text-white placeholder:text-white/28 focus:outline-none disabled:opacity-60"
              />

              {isGenerating ? (
                <button
                  type="button"
                  onClick={() => onStopGeneration()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-500/80 hover:bg-rose-500 text-white transition-colors"
                  title="Parar geração"
                >
                  <Square className="h-4 w-4 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void handleSend();
                  }}
                  disabled={
                    isPreparingAttachment ||
                    (!inputText.trim() &&
                      attachedFiles.length === 0)
                  }
                  className="froc-gold-button flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                  title="Enviar mensagem"
                >
                  <Send className="h-4 w-4 stroke-[2.8]" />
                </button>
              )}
            </div>
          </div>

          <p className="mt-2 text-center text-[9px] text-white/28">
            A Froc.IA pode cometer erros. Confira informações
            importantes.
          </p>
        </div>
      </div>

      <CameraScannerModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={(file) => {
          appendAttachment(file);
          setIsCameraOpen(false);
        }}
      />

      <VoiceRecorderModal
        isOpen={isVoiceOpen}
        onClose={() => setIsVoiceOpen(false)}
        onCaptureAudio={(file) => {
          appendAttachment(file);
          setIsVoiceOpen(false);
        }}
      />

      <CodeSnippetModal
        isOpen={isCodeOpen}
        onClose={() => setIsCodeOpen(false)}
        onAddCode={(file) => {
          appendAttachment(file);
          setIsCodeOpen(false);
        }}
      />

      <UrlImporterModal
        key={urlImporterType ?? 'closed-url-importer'}
        isOpen={urlImporterType !== null}
        defaultType={urlImporterType ?? 'url'}
        onClose={() => setUrlImporterType(null)}
        onImport={(file) => {
          appendAttachment(file);
          setUrlImporterType(null);
        }}
      />

      <ZipInspectorModal
        isOpen={zipForInspection !== null}
        initialFile={zipForInspection}
        onClose={() => setZipForInspection(null)}
        onConvertProject={(analysis) => {
          void handleZipConversion(analysis);
        }}
      />

      <KnowledgeBaseModal
        isOpen={isKnowledgeBaseOpen}
        onClose={() => setIsKnowledgeBaseOpen(false)}
        onSelectBaseForChat={(knowledgeBase: KnowledgeBase) => {
          const attachmentId = `knowledge-base-${knowledgeBase.id}`;

          if (
            attachedFiles.some(
              (file) =>
                file.source === 'knowledge-base' &&
                file.url === knowledgeBase.id
            )
          ) {
            setAttachmentError(
              `A Base de Conhecimento “${knowledgeBase.name}” já está anexada.`
            );
            setIsKnowledgeBaseOpen(false);
            return;
          }

          appendAttachment({
            id: attachmentId,
            name: knowledgeBase.name,
            size: 0,
            type: 'document',
            url: knowledgeBase.id,
            source: 'knowledge-base',
            status: 'ready',
            progress: 100,
            mime: 'application/x-froc-knowledge-base',
            extractedSummary: knowledgeBase.description
          });
          setIsKnowledgeBaseOpen(false);
        }}
      />
    </section>
  );
};
