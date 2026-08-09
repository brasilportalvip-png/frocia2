import React, {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  Sliders,
  X,
  XCircle
} from 'lucide-react';
import { apiClient } from '../services/apiClient';

type FeatureFlagKey =
  | 'ai_chat'
  | 'payment_checkout'
  | 'automated_evaluations'
  | 'image_generation'
  | 'video_generation';

interface FeatureFlagItem {
  key: FeatureFlagKey;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  available: boolean;
  protectedByKillSwitch: boolean;
}

interface EmergencyState {
  active: boolean;
  reason: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  previousValues: Partial<
    Record<FeatureFlagKey, boolean>
  >;
}

interface FeatureFlagSnapshot {
  flags: FeatureFlagItem[];
  emergency: EmergencyState;
  updatedAt: string;
  updatedBy: string | null;
  correlationId?: string;
}

interface FeatureFlagsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Ocorreu um erro inesperado.';
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'Não informado';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('pt-BR');
}

export const FeatureFlagsPanel: React.FC<
  FeatureFlagsPanelProps
> = ({ isOpen, onClose }) => {
  const [snapshot, setSnapshot] =
    useState<FeatureFlagSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingFlag, setPendingFlag] =
    useState<FeatureFlagKey | null>(null);
  const [dialogMode, setDialogMode] = useState<
    'activate' | 'deactivate' | null
  >(null);
  const [reason, setReason] = useState('');
  const [isSubmittingEmergency, setIsSubmittingEmergency] =
    useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadFlags = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await apiClient<FeatureFlagSnapshot>(
        '/api/admin/feature-flags'
      );
      setSnapshot(response);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadFlags();
    }
  }, [isOpen, loadFlags]);

  const metrics = useMemo(() => {
    const flags = snapshot?.flags ?? [];

    return {
      total: flags.length,
      enabled: flags.filter((flag) => flag.enabled).length,
      disabled: flags.filter((flag) => !flag.enabled).length,
      unavailable: flags.filter((flag) => !flag.available)
        .length
    };
  }, [snapshot]);

  if (!isOpen) {
    return null;
  }

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const toggleFlag = async (flag: FeatureFlagItem) => {
    if (!flag.available && !flag.enabled) {
      setError(
        'Este recurso ainda não possui um provedor homologado.'
      );
      return;
    }

    if (
      snapshot?.emergency.active &&
      flag.protectedByKillSwitch &&
      !flag.enabled
    ) {
      setError(
        'Desative o modo de emergência antes de reativar recursos protegidos.'
      );
      return;
    }

    clearMessages();
    setPendingFlag(flag.key);

    try {
      const response = await apiClient<FeatureFlagSnapshot>(
        `/api/admin/feature-flags/${encodeURIComponent(
          flag.key
        )}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !flag.enabled })
        }
      );

      setSnapshot(response);
      setSuccess(
        `${flag.name} foi ${
          !flag.enabled ? 'ativado' : 'desativado'
        } com sucesso.`
      );
    } catch (updateError) {
      setError(getErrorMessage(updateError));
    } finally {
      setPendingFlag(null);
    }
  };

  const openEmergencyDialog = (
    mode: 'activate' | 'deactivate'
  ) => {
    clearMessages();
    setReason('');
    setDialogMode(mode);
  };

  const submitEmergencyAction = async () => {
    if (!dialogMode) {
      return;
    }

    const normalizedReason = reason.trim();

    if (
      normalizedReason.length < 10 ||
      normalizedReason.length > 500
    ) {
      setError(
        'Informe um motivo entre 10 e 500 caracteres.'
      );
      return;
    }

    setIsSubmittingEmergency(true);
    clearMessages();

    try {
      const response = await apiClient<FeatureFlagSnapshot>(
        `/api/admin/feature-flags/emergency/${dialogMode}`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: normalizedReason
          })
        }
      );

      setSnapshot(response);
      setSuccess(
        dialogMode === 'activate'
          ? 'Modo de emergência ativado. Novas chamadas protegidas foram interrompidas.'
          : 'Modo de emergência desativado. As configurações anteriores foram restauradas.'
      );
      setDialogMode(null);
      setReason('');
    } catch (emergencyError) {
      setError(getErrorMessage(emergencyError));
    } finally {
      setIsSubmittingEmergency(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 text-white backdrop-blur-xl">
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-amber-400/20 bg-[#070707] shadow-[0_0_70px_rgba(245,158,11,0.10)]">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-black/70 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold">
                Feature Flags Reais
              </h3>
              <p className="text-xs text-white/45">
                Controle operacional persistido e auditado
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadFlags()}
              disabled={isLoading}
              className="rounded-xl border border-white/10 p-2 text-white/60 transition hover:border-amber-400/30 hover:text-amber-300 disabled:opacity-40"
              title="Atualizar"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  isLoading ? 'animate-spin' : ''
                }`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 p-2 text-white/60 transition hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto bg-[#090909] p-6">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <section
            className={`rounded-3xl border p-5 ${
              snapshot?.emergency.active
                ? 'border-red-400/45 bg-red-500/10'
                : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div
                  className={`flex items-center gap-2 text-sm font-bold ${
                    snapshot?.emergency.active
                      ? 'text-red-300'
                      : 'text-white'
                  }`}
                >
                  {snapshot?.emergency.active ? (
                    <ShieldAlert className="h-5 w-5" />
                  ) : (
                    <AlertOctagon className="h-5 w-5 text-amber-300" />
                  )}
                  {snapshot?.emergency.active
                    ? 'Modo de emergência ativo'
                    : 'Interrupção operacional de emergência'}
                </div>
                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/50">
                  {snapshot?.emergency.active
                    ? snapshot.emergency.reason
                    : 'Interrompe novas chamadas de IA, avaliações e checkouts. Webhooks e dados existentes permanecem preservados.'}
                </p>

                {snapshot?.emergency.active && (
                  <p className="mt-2 text-[10px] text-red-200/60">
                    Ativado em {formatDate(snapshot.emergency.activatedAt)} por {snapshot.emergency.activatedBy || 'administrador não identificado'}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  openEmergencyDialog(
                    snapshot?.emergency.active
                      ? 'deactivate'
                      : 'activate'
                  )
                }
                disabled={isLoading || !snapshot}
                className={`shrink-0 rounded-xl border px-4 py-2.5 text-xs font-black transition disabled:opacity-40 ${
                  snapshot?.emergency.active
                    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                    : 'border-red-400/35 bg-red-500/15 text-red-300 hover:bg-red-500/25'
                }`}
              >
                {snapshot?.emergency.active
                  ? 'Restaurar operação'
                  : 'Ativar kill-switch'}
              </button>
            </div>
          </section>

          {dialogMode && (
            <section className="rounded-2xl border border-amber-400/25 bg-black/60 p-4">
              <h4 className="text-sm font-bold">
                {dialogMode === 'activate'
                  ? 'Confirmar interrupção real'
                  : 'Confirmar restauração real'}
              </h4>
              <p className="mt-1 text-xs text-white/45">
                O motivo será armazenado na auditoria do Firestore.
              </p>
              <textarea
                value={reason}
                onChange={(event) =>
                  setReason(event.target.value)
                }
                maxLength={500}
                placeholder="Descreva o motivo com pelo menos 10 caracteres..."
                className="mt-3 h-24 w-full resize-none rounded-xl border border-white/10 bg-black p-3 text-xs text-white outline-none focus:border-amber-400/40"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDialogMode(null);
                    setReason('');
                  }}
                  disabled={isSubmittingEmergency}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-white/60 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void submitEmergencyAction()
                  }
                  disabled={isSubmittingEmergency}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black disabled:opacity-50 ${
                    dialogMode === 'activate'
                      ? 'bg-red-500 text-white hover:bg-red-400'
                      : 'bg-emerald-400 text-black hover:bg-emerald-300'
                  }`}
                >
                  {isSubmittingEmergency && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Confirmar
                </button>
              </div>
            </section>
          )}

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Total" value={metrics.total} />
            <Metric label="Ativos" value={metrics.enabled} tone="success" />
            <Metric label="Desativados" value={metrics.disabled} />
            <Metric label="Aguardando provedor" value={metrics.unavailable} tone="warning" />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white/50">
                Recursos controlados pelo backend
              </h4>
              {snapshot && (
                <span className="flex items-center gap-1 text-[10px] text-white/30">
                  <Clock3 className="h-3 w-3" />
                  Atualizado em {formatDate(snapshot.updatedAt)}
                </span>
              )}
            </div>

            {isLoading && !snapshot ? (
              <div className="flex h-40 items-center justify-center text-xs text-white/40">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando configurações reais...
              </div>
            ) : !snapshot ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-xs text-white/40">
                As configurações não puderam ser carregadas.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {snapshot.flags.map((flag) => {
                  const isPending = pendingFlag === flag.key;
                  const cannotEnable =
                    (!flag.available && !flag.enabled) ||
                    (snapshot.emergency.active &&
                      flag.protectedByKillSwitch &&
                      !flag.enabled);

                  return (
                    <article
                      key={flag.key}
                      className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h5 className="text-xs font-bold">
                            {flag.name}
                          </h5>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] text-amber-200">
                            {flag.category}
                          </span>
                          {!flag.available && (
                            <span className="flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/[0.07] px-2 py-0.5 text-[9px] text-amber-300">
                              <Lock className="h-2.5 w-2.5" />
                              Aguardando homologação
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">
                          {flag.description}
                        </p>
                        <code className="mt-2 block text-[9px] text-white/25">
                          {flag.key}
                        </code>
                      </div>

                      <button
                        type="button"
                        onClick={() => void toggleFlag(flag)}
                        disabled={
                          isPending ||
                          isLoading ||
                          cannotEnable
                        }
                        aria-label={`${
                          flag.enabled ? 'Desativar' : 'Ativar'
                        } ${flag.name}`}
                        className={`relative h-7 w-14 shrink-0 rounded-full border p-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          flag.enabled
                            ? 'border-emerald-300/40 bg-emerald-500'
                            : 'border-white/10 bg-white/10'
                        }`}
                      >
                        {isPending ? (
                          <Loader2 className="mx-auto h-4 w-4 animate-spin text-white" />
                        ) : (
                          <span
                            className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                              flag.enabled
                                ? 'translate-x-6'
                                : 'translate-x-0'
                            }`}
                          />
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-black/35 p-4 text-[10px] leading-relaxed text-white/35">
            <div className="flex items-center gap-2 font-bold text-white/55">
              <Lock className="h-3.5 w-3.5 text-amber-300" />
              Controle administrativo auditado
            </div>
            <p className="mt-2">
              Cada mudança é registrada com usuário, valor anterior, novo valor e horário. Alterações entram em vigor nas novas requisições sem necessidade de redeploy.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

const Metric: React.FC<{
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning';
}> = ({ label, value, tone = 'default' }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
    <span className="block text-[9px] font-bold uppercase text-white/35">
      {label}
    </span>
    <strong
      className={`mt-1 block text-lg ${
        tone === 'success'
          ? 'text-emerald-300'
          : tone === 'warning'
            ? 'text-amber-300'
            : 'text-white/80'
      }`}
    >
      {value}
    </strong>
  </div>
);