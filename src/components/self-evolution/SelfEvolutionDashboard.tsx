import React, { useState, useEffect } from 'react';
import { Activity, Shield, AlertTriangle, Zap, CheckCircle, RefreshCw } from 'lucide-react';

export const SelfEvolutionDashboard: React.FC = () => {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/self-evolution/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // Non-blocking fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  return (
    <div className="p-6 space-y-6 text-white font-sans">
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h2 className="text-2xl font-black flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-400" />
            Sistema de Autoevolução Supervisionada (Froc.IA 2)
          </h2>
          <p className="text-xs text-white/60">Governança, aprendizado validado e orquestração autônoma sob supervisão humana.</p>
        </div>
        <button
          onClick={fetchStatus}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold flex items-center gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar Painel
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>Status Global</span>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-xl font-bold flex items-center gap-2">
            {status?.enabled ? (
              <span className="text-emerald-400 flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Ativo</span>
            ) : (
              <span className="text-amber-400 flex items-center gap-1"><Shield className="w-4 h-4" /> Standby (Seguro)</span>
            )}
          </div>
          <p className="text-[10px] text-white/40">`SELF_EVOLUTION_ENABLED`</p>
        </div>

        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>Deploy Produção Autônomo</span>
            <Shield className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-rose-400">
            {status?.autonomousProductionDeployAllowed ? 'Permitido' : 'Bloqueado (R3)'}
          </div>
          <p className="text-[10px] text-white/40">Exige aprovação humana prévia</p>
        </div>

        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>Orçamento Diário de Agente</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-amber-300">
            {status?.budget?.dailyCreditsUsed ?? 0} / {status?.budget?.dailyCreditLimit ?? 500} Cr.
          </div>
          <p className="text-[10px] text-white/40">Consumo controlado</p>
        </div>

        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>Candidatos na Fila</span>
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white">
            {status?.candidatesCount ?? 0} Candidatos
          </div>
          <p className="text-[10px] text-white/40">Triados e classificados por risco</p>
        </div>
      </div>
    </div>
  );
};
