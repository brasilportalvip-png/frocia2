import React, { useState } from 'react';
import {
  Bot,
  Loader2,
  Sparkles,
  Volume2,
  WandSparkles,
  Zap
} from 'lucide-react';

const FROC_AVATAR_URL =
  'https://portalvipbrasil.com.br/wp-content/uploads/2026/08/frocialogo-removebg-preview.png';

type MascotStatus =
  | 'idle'
  | 'thinking'
  | 'speaking'
  | 'creating';

interface MascotWidgetProps {
  size?: 'sm' | 'md' | 'lg';
  quote?: string;
  showBadge?: boolean;
  status?: MascotStatus;
}

const SIZE_CLASSES: Record<
  NonNullable<MascotWidgetProps['size']>,
  string
> = {
  sm: 'h-14 w-14',
  md: 'h-24 w-24',
  lg: 'h-40 w-40 sm:h-44 sm:w-44'
};

const IMAGE_CLASSES: Record<MascotStatus, string> = {
  idle: 'froc-avatar-float froc-avatar-glow',
  thinking: 'froc-avatar-thinking',
  speaking: 'froc-avatar-speaking',
  creating: 'froc-avatar-thinking'
};

const STATUS_CONTENT: Record<
  MascotStatus,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  idle: {
    label: 'Froc.IA online',
    icon: Zap
  },
  thinking: {
    label: 'Froc.IA pensando',
    icon: Loader2
  },
  speaking: {
    label: 'Froc.IA respondendo',
    icon: Volume2
  },
  creating: {
    label: 'Froc.IA criando',
    icon: WandSparkles
  }
};

export const MascotWidget: React.FC<
  MascotWidgetProps
> = ({
  size = 'md',
  quote = 'Sua ideia. Nossa inteligência. Um projeto pronto.',
  showBadge = true,
  status = 'idle'
}) => {
  const [imageFailed, setImageFailed] = useState(false);

  const StatusIcon = STATUS_CONTENT[status].icon;
  const isProcessing =
    status === 'thinking' || status === 'creating';

  return (
    <div className="group relative flex flex-col items-center justify-center space-y-3 text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[38%] h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/10 blur-3xl transition-opacity duration-500 group-hover:opacity-100 sm:h-36 sm:w-36"
      />

      <div
        className={`relative ${SIZE_CLASSES[size]} flex shrink-0 items-center justify-center`}
      >
        <div
          aria-hidden="true"
          className="absolute inset-[5%] rounded-full border border-amber-300/20 opacity-70 shadow-[0_0_28px_rgba(245,196,81,0.12)]"
        />

        <div
          aria-hidden="true"
          className="absolute inset-[11%] rounded-full border border-blue-400/15 opacity-60"
        />

        {status !== 'idle' && (
          <div
            aria-hidden="true"
            className="absolute inset-[2%] rounded-full border border-amber-300/30 froc-soft-pulse"
          />
        )}

        {!imageFailed ? (
          <img
            src={FROC_AVATAR_URL}
            alt="Avatar oficial da Froc.IA"
            loading={size === 'lg' ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            onError={() => {
              setImageFailed(true);
            }}
            className={`relative z-10 h-full w-full select-none object-contain ${IMAGE_CLASSES[status]}`}
          />
        ) : (
          <div className="relative z-10 flex h-[76%] w-[76%] items-center justify-center rounded-full border border-amber-300/30 bg-black shadow-[0_0_25px_rgba(245,196,81,0.14)]">
            <Bot className="h-1/2 w-1/2 text-amber-300" />
          </div>
        )}

        <span
          aria-hidden="true"
          className="froc-status-dot absolute bottom-[7%] right-[8%] z-20 h-2.5 w-2.5 rounded-full bg-amber-300 ring-2 ring-black sm:h-3 sm:w-3"
        />
      </div>

      {showBadge && (
        <div className="glass-pill relative z-10 inline-flex items-center gap-1.5 rounded-full border-amber-300/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/85">
          <StatusIcon
            className={`h-3 w-3 text-amber-300 ${
              isProcessing ? 'animate-spin' : ''
            }`}
          />

          <span>{STATUS_CONTENT[status].label}</span>
        </div>
      )}

      {quote && (
        <div className="relative z-10 max-w-sm">
          <Sparkles
            aria-hidden="true"
            className="absolute -left-2 -top-1 h-3 w-3 text-amber-300/70"
          />

          <p className="rounded-2xl border border-white/10 bg-black/55 px-4 py-2 text-xs leading-relaxed text-white/78 shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur-md">
            “{quote}”
          </p>
        </div>
      )}
    </div>
  );
};