import React, { useRef } from 'react';
import {
  Camera,
  Code2,
  Database,
  FileArchive,
  FileText,
  Files,
  FolderCheck,
  FolderUp,
  Github,
  Globe,
  Image as ImageIcon,
  Mic,
  Monitor,
  Music,
  Plus,
  Share2,
  Video,
  X
} from 'lucide-react';

export type AttachmentOptionId =
  | 'file'
  | 'multiple_files'
  | 'folder'
  | 'zip'
  | 'image'
  | 'audio'
  | 'video'
  | 'camera'
  | 'github'
  | 'url'
  | 'code'
  | 'screen_cap'
  | 'mic'
  | 'screen_share'
  | 'knowledge_base'
  | 'project_files';

interface AttachmentMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOption: (optionId: AttachmentOptionId) => void;
  onFileSelectNative: (
    event: React.ChangeEvent<HTMLInputElement>,
    isMultiple?: boolean,
    isFolder?: boolean
  ) => void | Promise<void>;
}

interface AttachmentOption {
  id: AttachmentOptionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const ATTACHMENT_OPTIONS: AttachmentOption[] = [
  { id: 'file', label: 'Enviar arquivo', icon: FileText, color: 'text-purple-300' },
  { id: 'multiple_files', label: 'Múltiplos arquivos', icon: Files, color: 'text-pink-300' },
  { id: 'folder', label: 'Enviar pasta', icon: FolderUp, color: 'text-amber-300' },
  { id: 'zip', label: 'Inspecionar projeto ZIP', icon: FileArchive, color: 'text-orange-300' },
  { id: 'image', label: 'Imagem ou foto', icon: ImageIcon, color: 'text-blue-300' },
  { id: 'audio', label: 'Enviar áudio', icon: Music, color: 'text-teal-300' },
  { id: 'video', label: 'Enviar vídeo curto', icon: Video, color: 'text-indigo-300' },
  { id: 'camera', label: 'Capturar pela câmera', icon: Camera, color: 'text-rose-300' },
  { id: 'github', label: 'Importar GitHub', icon: Github, color: 'text-white' },
  { id: 'url', label: 'Importar URL', icon: Globe, color: 'text-emerald-300' },
  { id: 'code', label: 'Colar código ou snippet', icon: Code2, color: 'text-emerald-400' },
  { id: 'screen_cap', label: 'Capturar tela', icon: Monitor, color: 'text-cyan-300' },
  { id: 'mic', label: 'Gravar voz', icon: Mic, color: 'text-pink-400' },
  { id: 'screen_share', label: 'Compartilhar captura da tela', icon: Share2, color: 'text-purple-400' },
  { id: 'knowledge_base', label: 'Base de Conhecimento', icon: Database, color: 'text-amber-300' },
  { id: 'project_files', label: 'Selecionar pasta do projeto', icon: FolderCheck, color: 'text-amber-400' }
];

export const AttachmentMenu: React.FC<
  AttachmentMenuProps
> = ({
  isOpen,
  onClose,
  onSelectOption,
  onFileSelectNative
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const multipleInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) {
    return null;
  }

  const triggerInput = (
    reference: React.RefObject<HTMLInputElement | null>
  ) => {
    reference.current?.click();
  };

  const handleMenuClick = (optionId: AttachmentOptionId) => {
    switch (optionId) {
      case 'file':
        triggerInput(fileInputRef);
        return;
      case 'multiple_files':
        triggerInput(multipleInputRef);
        return;
      case 'folder':
      case 'project_files':
        triggerInput(folderInputRef);
        return;
      case 'zip':
        triggerInput(zipInputRef);
        return;
      case 'image':
        triggerInput(imageInputRef);
        return;
      case 'audio':
        triggerInput(audioInputRef);
        return;
      case 'video':
        triggerInput(videoInputRef);
        return;
      default:
        onSelectOption(optionId);
        onClose();
    }
  };

  const handleNativeChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
    isMultiple = false,
    isFolder = false
  ) => {
    await onFileSelectNative(
      event,
      isMultiple,
      isFolder
    );
    event.target.value = '';
    onClose();
  };

  return (
    <div className="absolute bottom-[calc(100%+0.75rem)] left-0 z-[100] w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-amber-400/25 bg-[#050505] p-3 text-white shadow-[0_24px_80px_rgba(0,0,0,0.95)] animate-in slide-in-from-bottom-3 duration-200">
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.csv,.json,.html,.css,.js,.jsx,.ts,.tsx,.sql,.py,.xml,.yaml,.yml,.pdf"
        onChange={(event) => void handleNativeChange(event)}
        className="hidden"
      />
      <input
        ref={multipleInputRef}
        type="file"
        multiple
        accept=".txt,.md,.csv,.json,.html,.css,.js,.jsx,.ts,.tsx,.sql,.py,.xml,.yaml,.yml,.pdf,image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,video/mp4,video/webm"
        onChange={(event) =>
          void handleNativeChange(event, true)
        }
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...({
          webkitdirectory: '',
          directory: ''
        } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(event) =>
          void handleNativeChange(event, true, true)
        }
        className="hidden"
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip"
        onChange={(event) => void handleNativeChange(event)}
        className="hidden"
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(event) => void handleNativeChange(event)}
        className="hidden"
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav"
        onChange={(event) => void handleNativeChange(event)}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        onChange={(event) => void handleNativeChange(event)}
        className="hidden"
      />

      <div className="mb-2 flex items-center justify-between border-b border-white/10 px-2 pb-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
          <Plus className="h-3.5 w-3.5" />
          Central de anexos
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-white/50 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="custom-scrollbar grid max-h-[min(65vh,32rem)] grid-cols-1 gap-1 overflow-y-auto overscroll-contain pr-1">
        {ATTACHMENT_OPTIONS.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleMenuClick(item.id)}
              className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-[#151515] p-2.5 text-left text-xs transition-all hover:border-amber-400/25 hover:bg-[#202020]"
            >
              <span
                className={`rounded-xl bg-white/10 p-2 transition-transform group-hover:scale-105 ${item.color}`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="font-semibold text-white/90 group-hover:text-white">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};