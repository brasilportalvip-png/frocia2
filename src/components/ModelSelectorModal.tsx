import React from 'react';
import { Sparkles, Zap, Cpu, Check, ShieldAlert, Layers } from 'lucide-react';

export interface AIModelOption {
  id: string;
  name: string;
  provider: string;
  description: string;
  badge: string;
  multiplier: string;
  speed: 'Rápida' | 'Balanceada' | 'Profunda';
  recommendedFor: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const AI_MODELS: AIModelOption[] = [
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    provider: 'Google AI Studio',
    description: 'Ultra-rápido, otimizado para respostas em tempo real, prototipagem e chats dinâmicos.',
    badge: 'Velocidade Máxima',
    multiplier: '1x Créditos',
    speed: 'Rápida',
    recommendedFor: 'Conversas gerais, suporte e geração rápida de código',
    icon: Zap,
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    provider: 'Google AI Studio',
    description: 'Arquitetura avançada de raciocínio, resolução de problemas complexos e engenharia de software.',
    badge: 'Alta Precisão',
    multiplier: '2x Créditos',
    speed: 'Balanceada',
    recommendedFor: 'Projetos full-stack, refatoração e análises profundas',
    icon: Sparkles,
  },
  {
    id: 'froc-ia-ultra-omni',
    name: 'Froc.IA Ultra Omni',
    provider: 'Froc.IA Neural Core',
    description: 'Motor multimodal supremo com capacidade multimodal avançada (Visão, Áudio, Imagem e Código).',
    badge: 'Froc.IA Flagship',
    multiplier: '3x Créditos',
    speed: 'Profunda',
    recommendedFor: 'Criação audiovisual completa e sistemas autônomos',
    icon: Layers,
  },
];

interface ModelSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  isOpen,
  onClose,
  selectedModel,
  onSelectModel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-2xl p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-[32px] border border-white/20 bg-[#0a0a0e] p-6 shadow-2xl text-white space-y-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-amber-300" />
            <h3 className="text-lg font-black text-white">Seletor de Modelos de Inteligência Artificial</h3>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white glass-button p-2 rounded-full text-xs font-bold"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-white/60">
          Escolha o modelo de IA ideal para sua necessidade. Modelos mais avançados consomem múltiplos de créditos mas possuem maior capacidade de raciocínio.
        </p>

        <div className="space-y-3">
          {AI_MODELS.map((model) => {
            const Icon = model.icon;
            const isSelected = selectedModel === model.id;

            return (
              <div
                key={model.id}
                onClick={() => {
                  onSelectModel(model.id);
                  onClose();
                }}
                className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start gap-3.5 relative ${
                  isSelected
                    ? 'border-amber-400 bg-amber-400/10 shadow-[0_0_20px_rgba(251,191,36,0.15)]'
                    : 'border-white/10 glass-panel hover:border-white/30 hover:bg-white/5'
                }`}
              >
                <div className={`p-2.5 rounded-xl shrink-0 ${isSelected ? 'bg-amber-400 text-black' : 'bg-white/10 text-amber-300'}`}>
                  <Icon className="w-5 h-5" />
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-extrabold text-white flex items-center gap-2">
                      <span>{model.name}</span>
                      {isSelected && (
                        <span className="flex items-center gap-1 text-[10px] text-amber-300 font-bold bg-amber-400/20 px-2 py-0.5 rounded-full border border-amber-400/30">
                          <Check className="w-3 h-3" /> Ativo
                        </span>
                      )}
                    </h4>
                    <span className="text-[10px] font-extrabold text-amber-300 px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/20">
                      {model.multiplier}
                    </span>
                  </div>

                  <p className="text-xs text-white/70 leading-relaxed">{model.description}</p>

                  <div className="flex items-center gap-2 pt-1 text-[10px] text-white/40">
                    <span className="bg-white/10 px-2 py-0.5 rounded-md text-white/70 font-mono">{model.badge}</span>
                    <span>•</span>
                    <span>Recomendado para: {model.recommendedFor}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
