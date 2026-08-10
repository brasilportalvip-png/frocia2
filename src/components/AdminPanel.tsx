import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Users,
  DollarSign,
  Activity,
  Zap,
  PlusCircle,
  Sparkles,
  FileCode,
  BarChart2,
  HardDrive,
  Sliders,
  Loader2
} from 'lucide-react';
import { AIModelConfig, AuditLog } from '../types';
import { PromptRegistryModal } from './PromptRegistryModal';
import { EvaluationsModal } from './EvaluationsModal';
import { ExecutionTracesModal } from './ExecutionTracesModal';
import { FeatureFlagsPanel } from './FeatureFlagsPanel';
import { DisasterRecoveryModal } from './DisasterRecoveryModal';
import { SelfEvolutionDashboard } from './self-evolution/SelfEvolutionDashboard';
import { apiClient } from '../services/apiClient';

interface AdminPanelProps {
  onGrantCreditsToUser?: (amount: number, userEmail: string) => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = () => {
  const [activeTab, setActiveTab] = useState<'metrics' | 'models' | 'users' | 'audit' | 'selfEvolution'>('metrics');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantAmount, setGrantAmount] = useState(100);
  const [grantReason, setGrantReason] = useState('Bônus/Suporte Administrativo');
  const [grantMessage, setGrantMessage] = useState('');
  const [isSubmittingGrant, setIsSubmittingGrant] = useState(false);

  // Real Metrics State
  const [realMetrics, setRealMetrics] = useState<{
    usersCount?: number;
    totalRevenueBrl?: number;
    totalCreditsSold?: number;
    approvedPaymentsCount?: number;
    totalPaymentsCreated?: number;
    totalWebhookEvents?: number;
    dataSource?: string;
  } | null>(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true);

  // Modals State
  const [isPromptRegistryOpen, setIsPromptRegistryOpen] = useState(false);
  const [isEvaluationsOpen, setIsEvaluationsOpen] = useState(false);
  const [isTracesOpen, setIsTracesOpen] = useState(false);
  const [isFeatureFlagsOpen, setIsFeatureFlagsOpen] = useState(false);
  const [isDisasterRecoveryOpen, setIsDisasterRecoveryOpen] = useState(false);

  useEffect(() => {
    async function loadMetrics() {
      try {
        const data = await apiClient('/api/admin/dashboard/overview');
        setRealMetrics(data);
      } catch (err) {
        console.warn('Erro ao carregar métricas reais do dashboard:', err);
      } finally {
        setIsLoadingMetrics(false);
      }
    }
    loadMetrics();
  }, []);

  const [models] = useState<AIModelConfig[]>([
    {
      id: 'm-flash',
      name: 'Gemini 3.6 Flash',
      provider: 'Google Gemini',
      category: 'Raciocínio',
      costPerOp: 1,
      speedMs: 0,
      contextWindow: '1,000,000 tokens',
      status: 'operacional',
      errorRate: '0%'
    },
    {
      id: 'm-pro',
      name: 'Gemini 3.1 Pro',
      provider: 'Google Gemini',
      category: 'Código',
      costPerOp: 3,
      speedMs: 0,
      contextWindow: '2,000,000 tokens',
      status: 'operacional',
      errorRate: '0%'
    },
    {
      id: 'm-imagen',
      name: 'Imagen 3 (Multimídia)',
      provider: 'Google Gemini',
      category: 'Imagem',
      costPerOp: 7,
      speedMs: 0,
      contextWindow: 'Prompt visual',
      status: 'manutencao',
      errorRate: 'Não homologado'
    }
  ]);

  const auditLogs: AuditLog[] = [];

  const handleGrantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantEmail || !grantReason) return;
    setIsSubmittingGrant(true);
    setGrantMessage('');

    try {
      const result = await apiClient('/api/admin/grant-credits', {
        method: 'POST',
        body: JSON.stringify({
          userEmail: grantEmail,
          amount: grantAmount,
          reason: grantReason,
        }),
      });

      setGrantMessage(`✔ ${grantAmount} créditos concedidos para ${grantEmail} com sucesso! (Novo saldo: ${result.availableAfter})`);
      setGrantEmail('');
    } catch (err: any) {
      setGrantMessage(`⚠️ ${err.message || 'Erro ao conceder créditos.'}`);
    } finally {
      setIsSubmittingGrant(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-white p-6 md:p-8 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
              <h1 className="text-2xl sm:text-3xl font-extrabold">Painel Administrativo Froc.IA</h1>
            </div>
            <p className="text-xs text-white/60">
              Controle global de usuários, carteira de créditos, saúde de modelos de IA e auditoria do sistema.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-white/5 p-1 rounded-2xl border border-white/10 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('metrics')}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                activeTab === 'metrics' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Métricas
            </button>
            <button
              onClick={() => setActiveTab('models')}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                activeTab === 'models' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Modelos de IA
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                activeTab === 'users' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Conceder Créditos
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                activeTab === 'audit' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Auditoria
            </button>
            <button
              onClick={() => setActiveTab('selfEvolution')}
              className={`px-3 py-1.5 rounded-xl transition-all ${
                activeTab === 'selfEvolution' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Autoevolução
            </button>
          </div>
        </div>

        {/* Operational Control Toolbar Bar */}
        <div className="p-4 rounded-3xl bg-gradient-to-r from-blue-900/40 via-purple-900/40 to-slate-900/80 border border-cyan-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-cyan-300">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <span>Camada de Operação & Qualidade Froc.IA:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsPromptRegistryOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 font-bold flex items-center gap-1.5"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Prompts</span>
            </button>
            <button
              onClick={() => setIsEvaluationsOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 font-bold flex items-center gap-1.5"
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Avaliações IA</span>
            </button>
            <button
              onClick={() => setIsTracesOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Traces</span>
            </button>
            <button
              onClick={() => setIsFeatureFlagsOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 font-bold flex items-center gap-1.5"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Feature Flags</span>
            </button>
            <button
              onClick={() => setIsDisasterRecoveryOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold flex items-center gap-1.5"
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Disaster Recovery</span>
            </button>
          </div>
        </div>

        {/* Tab 1: System Metrics Overview */}
        {activeTab === 'metrics' && (
          <div className="space-y-8">
            {isLoadingMetrics ? (
              <div className="flex items-center justify-center py-12 text-white/50 gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                <span>Agregando dados reais do Firestore...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="p-6 rounded-[28px] glass-panel border border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-white/50 text-xs">
                    <span>Usuários Cadastrados</span>
                    <Users className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="text-3xl font-black text-white">{realMetrics?.usersCount ?? 0}</div>
                  <div className="text-[10px] text-purple-300 font-bold">Documentos no Firestore</div>
                </div>

                <div className="p-6 rounded-[28px] glass-panel border border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-white/50 text-xs">
                    <span>Receita Aprovada (Pix)</span>
                    <DollarSign className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-3xl font-black text-white">R$ {(realMetrics?.totalRevenueBrl ?? 0).toFixed(2)}</div>
                  <div className="text-[10px] text-emerald-400 font-bold">{realMetrics?.approvedPaymentsCount ?? 0} pagamentos aprovados</div>
                </div>

                <div className="p-6 rounded-[28px] glass-panel border border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-white/50 text-xs">
                    <span>Créditos Vendidos</span>
                    <Sparkles className="w-4 h-4 text-pink-400" />
                  </div>
                  <div className="text-3xl font-black text-white">{realMetrics?.totalCreditsSold ?? 0}</div>
                  <div className="text-[10px] text-pink-300 font-bold">Soma de compras ativas</div>
                </div>

                <div className="p-6 rounded-[28px] glass-panel border border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-white/50 text-xs">
                    <span>Webhooks Processados</span>
                    <Activity className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="text-3xl font-black text-white">{realMetrics?.totalWebhookEvents ?? 0}</div>
                  <div className="text-[10px] text-cyan-300 font-bold">Eventos Mercado Pago</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: AI Model Router Status */}
        {activeTab === 'models' && (
          <div className="space-y-6">
            <h3 className="text-xl font-bold">Saúde dos Modelos de IA & Roteador de Failover</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {models.map((m) => (
                <div key={m.id} className="p-6 rounded-[28px] glass-panel border border-white/15 space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                      {m.status.toUpperCase()}
                    </span>
                    <span className="text-xs text-white/50 font-mono">{m.provider}</span>
                  </div>

                  <h4 className="text-xl font-bold text-white">{m.name}</h4>

                  <div className="space-y-2 text-xs text-white/70 border-t border-white/10 pt-3">
                    <div className="flex justify-between">
                      <span>Custo Base:</span>
                      <span className="font-bold text-amber-300">{m.costPerOp} Crédito(s)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Latência Média:</span>
                      <span className="font-bold text-white">{m.speedMs} ms</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Taxa de Erro:</span>
                      <span className="font-bold text-emerald-400">{m.errorRate}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Grant Credits */}
        {activeTab === 'users' && (
          <div className="max-w-xl mx-auto p-8 rounded-[32px] glass-panel border border-white/15 space-y-6">
            <div className="flex items-center gap-3">
              <PlusCircle className="w-6 h-6 text-pink-400" />
              <h3 className="text-xl font-bold text-white">Conceder Créditos Transacionais (Fase 2)</h3>
            </div>

            <form onSubmit={handleGrantSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-white/70 mb-2">E-mail do Usuário</label>
                <input
                  type="email"
                  required
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                  placeholder="usuario@exemplo.com"
                  className="w-full glass-input rounded-2xl px-4 py-3 text-xs text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/70 mb-2">Quantidade de Créditos</label>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(Number(e.target.value))}
                  className="w-full glass-input rounded-2xl px-4 py-3 text-xs text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/70 mb-2">Motivo / Justificativa Requerida</label>
                <input
                  type="text"
                  required
                  value={grantReason}
                  onChange={(e) => setGrantReason(e.target.value)}
                  placeholder="Ex: Bônus de suporte ou ajuste financeiro"
                  className="w-full glass-input rounded-2xl px-4 py-3 text-xs text-white focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingGrant}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white font-extrabold text-xs shadow-lg transition-all flex items-center justify-center gap-2"
              >
                {isSubmittingGrant ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                <span>Conceder Créditos Transacionais</span>
              </button>
            </form>

            {grantMessage && (
              <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold text-center">
                {grantMessage}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Audit Logs */}
        {activeTab === 'audit' && (
          <div className="p-6 rounded-[32px] glass-panel border border-white/15 space-y-4">
            <h3 className="text-lg font-bold">Logs de Auditoria & Eventos de Segurança</h3>

            <div className="space-y-2">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2 font-mono">
                  <div>
                    <span className="text-pink-300 font-bold mr-2">[{log.timestamp}]</span>
                    <span className="text-white font-semibold">{log.actor}</span>: {log.action} ({log.target})
                  </div>
                  <span className="text-white/40 text-[10px]">IP: {log.ip}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 5: Self Evolution */}
        {activeTab === 'selfEvolution' && (
          <SelfEvolutionDashboard />
        )}

        {/* Modals */}
        <PromptRegistryModal
          isOpen={isPromptRegistryOpen}
          onClose={() => setIsPromptRegistryOpen(false)}
        />
        <EvaluationsModal
          isOpen={isEvaluationsOpen}
          onClose={() => setIsEvaluationsOpen(false)}
        />
        <ExecutionTracesModal
          isOpen={isTracesOpen}
          onClose={() => setIsTracesOpen(false)}
        />
        <FeatureFlagsPanel
          isOpen={isFeatureFlagsOpen}
          onClose={() => setIsFeatureFlagsOpen(false)}
        />
        <DisasterRecoveryModal
          isOpen={isDisasterRecoveryOpen}
          onClose={() => setIsDisasterRecoveryOpen(false)}
        />
      </div>
    </div>
  );
};
