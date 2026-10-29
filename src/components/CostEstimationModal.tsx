import React from 'react';
import { Zap, AlertCircle, ShieldCheck, Check, X, ArrowRight } from 'lucide-react';

interface CostEstimationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  operationType: string;
  estimatedCredits: number;
  maxCreditLimit: number;
  userBalance: number;
  description: string;
}

export const CostEstimationModal: React.FC<CostEstimationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  operationType,
  estimatedCredits,
  maxCreditLimit,
  userBalance,
  description
}) => {
  if (!isOpen) return null;

  const hasEnoughBalance = userBalance >= estimatedCredits;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-md glass-panel rounded-[32px] p-6 border border-amber-500/30 text-white space-y-5 relative shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-amber-500/30">
              <Zap className="w-5 h-5 fill-slate-950" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Confirmação de Transação de IA</h3>
              <p className="text-xs text-amber-300/80 font-mono">Estimativa Transacional Segura</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full glass-button text-white/70 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Details Card */}
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/60">Operação Solicitada:</span>
            <span className="font-bold text-cyan-300">{operationType}</span>
          </div>
          <p className="text-xs text-white/80 leading-relaxed border-t border-b border-white/5 py-2">
            {description}
          </p>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
              <span className="text-[10px] uppercase font-bold text-amber-300 block">Créditos Estimados</span>
              <span className="text-xl font-black text-amber-400">{estimatedCredits}</span>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
              <span className="text-[10px] uppercase font-bold text-white/50 block">Limite Máximo Teto</span>
              <span className="text-xl font-black text-white">{maxCreditLimit}</span>
            </div>
          </div>
        </div>

        {/* User Balance Status */}
        <div className="flex items-center justify-between text-xs px-2">
          <span className="text-white/60">Seu Saldo Atual:</span>
          <span className={`font-mono font-bold ${hasEnoughBalance ? 'text-emerald-400' : 'text-rose-400'}`}>
            {userBalance} Créditos
          </span>
        </div>

        {!hasEnoughBalance && (
          <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Saldo insuficiente. Adicione mais créditos para prosseguir.</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl glass-button text-xs font-bold text-white/80 hover:text-white"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={!hasEnoughBalance}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Autorizar & Executar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
