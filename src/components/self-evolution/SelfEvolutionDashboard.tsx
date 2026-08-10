import React, { useState, useEffect } from 'react';
import { Activity, Shield, AlertTriangle, Zap, CheckCircle, RefreshCw, GitPullRequest, ExternalLink, OctagonAlert, Play, RotateCcw } from 'lucide-react';
import { auth } from '../../lib/firebase';

interface Budget {
  dailyCreditLimit: number;
  dailyCreditsUsed: number;
  monthlyCreditLimit: number;
  monthlyCreditsUsed: number;
  dailyMaxAgentRuns: number;
  dailyAgentRunsCount: number;
  lastResetDate: string;
}

interface Candidate {
  id: string;
  title: string;
  summary: string;
  riskLevel: 'R1' | 'R2' | 'R3';
  severity: string;
  state: string;
  requiresApproval: boolean;
  pullRequestUrl?: string;
  previewUrl?: string;
  branchName?: string;
  createdAt: string;
}

interface StatusResponse {
  enabled: boolean;
  autonomousProductionDeployAllowed: boolean;
  budget: Budget;
  candidatesCount: number;
  timestamp: string;
}

export const SelfEvolutionDashboard: React.FC = () => {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    type: 'approve_work' | 'approve_release' | 'rollback' | 'emergency_stop';
    candidateId?: string;
    candidateTitle?: string;
  } | null>(null);
  const [rollbackReason, setRollbackReason] = useState('');

  const getAuthHeader = async (): Promise<Record<string, string>> => {
    try {
      const user = auth.currentUser;
      if (user) {
        const token = await user.getIdToken();
        return { Authorization: `Bearer ${token}` };
      }
    } catch (err) {
      console.error('Erro ao obter token de autenticação:', err);
    }
    return {};
  };

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeader();
      const [statusRes, candidatesRes] = await Promise.all([
        fetch('/api/admin/self-evolution/status', { headers }),
        fetch('/api/admin/self-evolution/candidates', { headers }),
      ]);

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStatus(statusData);
      } else {
        setError(`Falha ao obter status: HTTP ${statusRes.status}`);
      }

      if (candidatesRes.ok) {
        const candidatesData = await candidatesRes.json();
        setCandidates(candidatesData.candidates || []);
      }
    } catch (err: any) {
      setError(`Erro de conexão com o servidor: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboardData();
  }, []);

  const handleAction = async () => {
    if (!confirmModal) return;
    const { type, candidateId } = confirmModal;
    setActionLoading(candidateId || 'global');

    try {
      const headers = {
        ...(await getAuthHeader()),
        'Content-Type': 'application/json',
      };

      let url = '';
      let body: any = {};

      if (type === 'approve_work' && candidateId) {
        url = `/api/admin/self-evolution/candidates/${candidateId}/approve-work`;
      } else if (type === 'approve_release' && candidateId) {
        url = `/api/admin/self-evolution/releases/${candidateId}/approve`;
      } else if (type === 'rollback' && candidateId) {
        url = `/api/admin/self-evolution/releases/${candidateId}/rollback`;
        body = { reason: rollbackReason || 'Rollback acionado pelo painel do administrador' };
      } else if (type === 'emergency_stop') {
        url = '/api/admin/self-evolution/emergency-stop';
        body = { reason: 'Parada de emergência acionada pelo painel administrativo.' };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errData = await response.json();
        alert(`Erro na operação: ${errData.error || 'Falha no servidor'}`);
      } else {
        await fetchDashboardData();
      }
    } catch (err: any) {
      alert(`Erro ao executar ação: ${err?.message || err}`);
    } finally {
      setActionLoading(null);
      setConfirmModal(null);
      setRollbackReason('');
    }
  };

  return (
    <div className="p-6 space-y-6 text-white font-sans max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-white/10 pb-4 gap-4">
        <div>
          <h2 className="text-2xl font-black flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-400" />
            Sistema de Autoevolução Supervisionada (Froc.IA 2)
          </h2>
          <p className="text-xs text-white/60">Governança, aprendizado validado e orquestração autônoma sob supervisão humana.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setConfirmModal({ type: 'emergency_stop' })}
            disabled={actionLoading !== null}
            className="px-4 py-2 bg-rose-600/80 hover:bg-rose-600 text-white rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-lg transition-all"
          >
            <OctagonAlert className="w-4 h-4" />
            Parada de Emergência
          </button>
          <button
            onClick={fetchDashboardData}
            disabled={loading}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold flex items-center gap-2 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Metrics Grid */}
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
            <span>Deploy Produção</span>
            <Shield className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-rose-400">
            {status?.autonomousProductionDeployAllowed ? 'Permitido' : 'Bloqueado (R3)'}
          </div>
          <p className="text-[10px] text-white/40">Exige aprovação humana prévia</p>
        </div>

        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>Orçamento Diário</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-amber-300">
            {status?.budget?.dailyCreditsUsed ?? 0} / {status?.budget?.dailyCreditLimit ?? 500} Cr.
          </div>
          <p className="text-[10px] text-white/40">Consumo de créditos do agente</p>
        </div>

        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>Candidatos na Fila</span>
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white">
            {status?.candidatesCount ?? candidates.length ?? 0} Candidatos
          </div>
          <p className="text-[10px] text-white/40">Classificados por Risco (R1, R2, R3)</p>
        </div>
      </div>

      {/* Candidate List Section */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <GitPullRequest className="w-5 h-5 text-cyan-400" />
          Fila de Candidatos de Autoevolução
        </h3>

        {candidates.length === 0 ? (
          <div className="text-center py-12 text-white/40 text-sm">
            Nenhum candidato de melhoria registrado no momento.
          </div>
        ) : (
          <div className="space-y-3">
            {candidates.map((cand) => (
              <div key={cand.id} className="p-4 bg-white/5 border border-white/10 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                      cand.riskLevel === 'R3' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                      cand.riskLevel === 'R2' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                      'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {cand.riskLevel}
                    </span>
                    <h4 className="font-bold text-sm text-white">{cand.title}</h4>
                    <span className="text-[10px] text-white/40 font-mono">({cand.state})</span>
                  </div>
                  <p className="text-xs text-white/60">{cand.summary}</p>
                  
                  <div className="flex items-center gap-4 text-[11px] text-white/40 pt-1">
                    {cand.pullRequestUrl && (
                      <a href={cand.pullRequestUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline flex items-center gap-1">
                        PR no GitHub <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {cand.previewUrl && (
                      <a href={cand.previewUrl} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline flex items-center gap-1">
                        Preview Vercel <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {cand.state === 'awaiting_work_approval' && (
                    <button
                      disabled={actionLoading === cand.id}
                      onClick={() => setConfirmModal({ type: 'approve_work', candidateId: cand.id, candidateTitle: cand.title })}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-all"
                    >
                      <Play className="w-3 h-3" />
                      Aprovar Trabalho
                    </button>
                  )}

                  {cand.state === 'awaiting_release_approval' && (
                    <button
                      disabled={actionLoading === cand.id}
                      onClick={() => setConfirmModal({ type: 'approve_release', candidateId: cand.id, candidateTitle: cand.title })}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-all"
                    >
                      <CheckCircle className="w-3 h-3" />
                      Aprovar Release
                    </button>
                  )}

                  <button
                    disabled={actionLoading === cand.id}
                    onClick={() => setConfirmModal({ type: 'rollback', candidateId: cand.id, candidateTitle: cand.title })}
                    className="px-3 py-1.5 bg-white/10 hover:bg-rose-500/20 hover:text-rose-300 text-white/70 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Rollback
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/20 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Confirmar Ação Supervisionada
            </h3>

            <p className="text-xs text-white/70">
              {confirmModal.type === 'emergency_stop' && 'Tem certeza que deseja desativar o Sistema de Autoevolução de Emergência? Todas as execuções serão interrompidas.'}
              {confirmModal.type === 'approve_work' && `Aprovar geração de código para o candidato "${confirmModal.candidateTitle}"?`}
              {confirmModal.type === 'approve_release' && `Aprovar o lançamento em produção para o candidato "${confirmModal.candidateTitle}"?`}
              {confirmModal.type === 'rollback' && `Executar rollback para o candidato "${confirmModal.candidateTitle}"?`}
            </p>

            {confirmModal.type === 'rollback' && (
              <input
                type="text"
                placeholder="Motivo do rollback (obrigatório)"
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                className="w-full bg-slate-950 border border-white/20 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
              />
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => { setConfirmModal(null); setRollbackReason(''); }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={handleAction}
                disabled={actionLoading !== null}
                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl text-xs font-extrabold shadow-lg"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

