import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  HardDrive,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Upload,
  X
} from 'lucide-react';
import { ApiClientError, apiClient } from '../services/apiClient';

interface DisasterRecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface RecoveryHistoryItem {
  id: string;
  action: string;
  actorUid: string;
  backupId: string | null;
  documentCount: number;
  collectionCount: number;
  dryRun: boolean;
  success: boolean;
  details: string | null;
  createdAt: string;
}

interface RecoveryStatus {
  mode: 'portable_manual';
  configured: boolean;
  projectId: string;
  databaseId: string;
  automaticBackup: boolean;
  cloudStorageBackup: boolean;
  firebaseAuthIncluded: boolean;
  firebaseStorageIncluded: boolean;
  protectedCollections: string[];
  restoreConfirmation: string;
  lastBackup: RecoveryHistoryItem | null;
  lastValidation: RecoveryHistoryItem | null;
  lastRestore: RecoveryHistoryItem | null;
  history: RecoveryHistoryItem[];
  limitations: string[];
}

interface BackupManifest {
  format: string;
  backupId: string;
  projectId: string;
  databaseId: string;
  createdAt: string;
  createdBy: string;
  collectionCount: number;
  documentCount: number;
  collections: Record<string, number>;
  limitations: string[];
  checksumAlgorithm: 'sha256';
  checksum: string;
}

interface PortableBackup {
  manifest: BackupManifest;
  data: Record<
    string,
    Array<{ id: string; data: Record<string, unknown> }>
  >;
}

interface RestoreResult {
  dryRun: boolean;
  backupId: string;
  collectionsProcessed: number;
  documentsProcessed: number;
  startedAt: string;
  completedAt: string;
}

const MAX_LOCAL_FILE_BYTES = 12_000_000;

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return 'Ocorreu um erro inesperado. Tente novamente.';
}

function formatDate(value?: string | null): string {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    backup_created: 'Backup baixado',
    backup_validated: 'Arquivo validado',
    restore_completed: 'Restauração concluída'
  };
  return labels[action] ?? action;
}

function downloadJson(backup: PortableBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${backup.manifest.backupId}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const DisasterRecoveryModal: React.FC<
  DisasterRecoveryModalProps
> = ({ isOpen, onClose }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [selectedBackup, setSelectedBackup] =
    useState<PortableBackup | null>(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validationResult, setValidationResult] =
    useState<RestoreResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStatus = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient<RecoveryStatus>(
        '/api/admin/disaster-recovery/status'
      );
      setStatus(response);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setNotice(null);
    void loadStatus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !isGenerating &&
        !isValidating &&
        !isRestoring
      ) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isGenerating, isValidating, isRestoring, onClose]);

  if (!isOpen) return null;

  const handleGenerateBackup = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setNotice(null);

    try {
      const backup = await apiClient<PortableBackup>(
        '/api/admin/disaster-recovery/backup',
        { method: 'POST', body: JSON.stringify({}) }
      );
      downloadJson(backup);
      setNotice(
        `Backup ${backup.manifest.backupId} gerado com ${backup.manifest.documentCount} documento(s). Guarde o arquivo em local seguro.`
      );
      await loadStatus();
    } catch (backupError) {
      setError(getErrorMessage(backupError));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSelectFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    setNotice(null);
    setSelectedBackup(null);
    setValidationResult(null);
    setConfirmation('');

    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('Selecione um arquivo de backup JSON da Froc.IA.');
      return;
    }

    if (file.size === 0 || file.size > MAX_LOCAL_FILE_BYTES) {
      setError('O arquivo está vazio ou excede o limite de 12 MB.');
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as PortableBackup;
      if (!parsed?.manifest || !parsed?.data) {
        throw new Error('O arquivo não possui a estrutura de backup da Froc.IA.');
      }
      setSelectedBackup(parsed);
      setSelectedFileName(file.name);
      setNotice(
        'Arquivo carregado localmente. Execute a validação antes de restaurar.'
      );
    } catch (fileError) {
      setError(getErrorMessage(fileError));
      setSelectedFileName('');
    }
  };

  const handleValidate = async () => {
    if (!selectedBackup || isValidating) return;
    setIsValidating(true);
    setError(null);
    setNotice(null);

    try {
      const response = await apiClient<{
        valid: true;
        result: RestoreResult;
      }>('/api/admin/disaster-recovery/validate', {
        method: 'POST',
        body: JSON.stringify({ backup: selectedBackup })
      });
      setValidationResult(response.result);
      setNotice(
        `Backup íntegro: ${response.result.documentsProcessed} documento(s) em ${response.result.collectionsProcessed} coleção(ões). Nenhum dado foi alterado.`
      );
      await loadStatus();
    } catch (validationError) {
      setValidationResult(null);
      setError(getErrorMessage(validationError));
    } finally {
      setIsValidating(false);
    }
  };

  const handleRestore = async () => {
    if (
      !selectedBackup ||
      !validationResult ||
      !status ||
      confirmation !== status.restoreConfirmation ||
      isRestoring
    ) {
      return;
    }

    const accepted = window.confirm(
      `CONFIRMAÇÃO FINAL: restaurar ${validationResult.documentsProcessed} documento(s) do backup ${validationResult.backupId}? Documentos com o mesmo ID serão sobrescritos.`
    );
    if (!accepted) return;

    setIsRestoring(true);
    setError(null);
    setNotice(null);

    try {
      const response = await apiClient<{
        restored: true;
        result: RestoreResult;
      }>('/api/admin/disaster-recovery/restore', {
        method: 'POST',
        body: JSON.stringify({
          backup: selectedBackup,
          confirmation
        })
      });
      setNotice(
        `Restauração concluída: ${response.result.documentsProcessed} documento(s) processado(s).`
      );
      setConfirmation('');
      await loadStatus();
    } catch (restoreError) {
      setError(getErrorMessage(restoreError));
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/90 p-3 backdrop-blur-xl sm:p-5">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-amber-400/25 bg-[#090909] text-white shadow-[0_30px_120px_rgba(0,0,0,0.95)]">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-2.5 text-amber-300">
              <HardDrive className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black sm:text-lg">
                Recuperação, Backup e Portabilidade
              </h2>
              <p className="truncate text-[11px] text-white/45">
                Backup administrativo portátil, checksum e restauração auditada
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void loadStatus()} disabled={isLoading} className="rounded-full p-2 text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-40" title="Atualizar">
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-white/55 hover:bg-white/10 hover:text-white" aria-label="Fechar">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {error && (
            <div className="flex items-start gap-2 rounded-2xl border border-red-400/25 bg-red-400/10 p-3 text-xs text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="flex items-start gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{notice}</span>
            </div>
          )}

          {isLoading && !status ? (
            <div className="flex min-h-[24rem] items-center justify-center gap-2 text-sm text-white/45"><Loader2 className="h-5 w-5 animate-spin text-amber-300" /> Consultando recuperação...</div>
          ) : status ? (
            <>
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Modo</div><div className="mt-2 text-sm font-black text-amber-300">Portátil manual</div><div className="mt-1 text-[10px] text-white/35">Sem Blaze e sem armazenamento em nuvem</div></div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Último backup</div><div className="mt-2 text-sm font-black text-white">{formatDate(status.lastBackup?.createdAt)}</div><div className="mt-1 text-[10px] text-white/35">{status.lastBackup ? `${status.lastBackup.documentCount} documentos` : 'Nenhum backup registrado'}</div></div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Última restauração</div><div className="mt-2 text-sm font-black text-white">{formatDate(status.lastRestore?.createdAt)}</div><div className="mt-1 text-[10px] text-white/35">{status.lastRestore ? `${status.lastRestore.documentCount} documentos` : 'Nenhuma restauração registrada'}</div></div>
              </section>

              <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
                  <div className="flex items-start gap-3"><span className="rounded-xl bg-blue-400/10 p-2 text-blue-300"><Database className="h-4 w-4" /></span><div><h3 className="text-sm font-black">Gerar backup agora</h3><p className="mt-1 text-[11px] leading-relaxed text-white/45">Lê as coleções permanentes, calcula o checksum e baixa o arquivo no seu computador.</p></div></div>
                  <div className="rounded-2xl border border-white/8 bg-black/30 p-3 text-[10px] text-white/45"><div>Projeto: <span className="text-white/70">{status.projectId}</span></div><div className="mt-1">Coleções protegidas: <span className="text-white/70">{status.protectedCollections.length}</span></div></div>
                  <button type="button" onClick={() => void handleGenerateBackup()} disabled={isGenerating} className="froc-gold-button flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-black disabled:opacity-50">{isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{isGenerating ? 'Gerando e verificando...' : 'Gerar e baixar backup'}</button>
                </div>

                <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
                  <div className="flex items-start gap-3"><span className="rounded-xl bg-emerald-400/10 p-2 text-emerald-300"><FileCheck2 className="h-4 w-4" /></span><div><h3 className="text-sm font-black">Validar ou restaurar</h3><p className="mt-1 text-[11px] leading-relaxed text-white/45">O arquivo é validado integralmente antes de liberar a restauração.</p></div></div>
                  <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={(event) => void handleSelectFile(event)} className="hidden" />
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isValidating || isRestoring} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/5 py-2.5 text-xs font-bold text-white/70 hover:bg-white/10 disabled:opacity-50"><Upload className="h-4 w-4" />{selectedFileName || 'Selecionar arquivo de backup'}</button>
                  <button type="button" onClick={() => void handleValidate()} disabled={!selectedBackup || isValidating || isRestoring} className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 py-2.5 text-xs font-bold text-emerald-200 disabled:opacity-40">{isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{isValidating ? 'Validando checksum...' : 'Validar sem alterar dados'}</button>

                  {validationResult && (
                    <div className="space-y-3 border-t border-white/10 pt-3">
                      <label className="block"><span className="mb-1.5 block text-[10px] font-bold text-red-200">Digite exatamente: {status.restoreConfirmation}</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={status.restoreConfirmation} className="w-full rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5 text-xs outline-none focus:border-red-400/45" /></label>
                      <button type="button" onClick={() => void handleRestore()} disabled={confirmation !== status.restoreConfirmation || isRestoring} className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 py-2.5 text-xs font-black text-red-200 disabled:opacity-35">{isRestoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}{isRestoring ? 'Restaurando...' : 'Restaurar backup validado'}</button>
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.055] p-5"><h3 className="flex items-center gap-2 text-xs font-black text-amber-200"><AlertCircle className="h-4 w-4" /> Limitações honestas da opção sem Blaze</h3><ul className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-white/55">{status.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}</ul></section>

              <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white/55"><History className="h-4 w-4 text-amber-300" /> Histórico auditável</h3>{status.history.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs text-white/35">Nenhuma operação registrada.</div> : <div className="space-y-2">{status.history.map((item) => <div key={item.id} className="flex flex-col justify-between gap-2 rounded-2xl border border-white/8 bg-black/25 p-3 sm:flex-row sm:items-center"><div><div className="text-xs font-bold text-white/80">{actionLabel(item.action)}</div><div className="mt-1 text-[10px] text-white/35">{item.backupId || 'Sem identificador'} • {item.documentCount} documento(s)</div></div><div className="text-[10px] text-white/40">{formatDate(item.createdAt)}</div></div>)}</div>}</section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};