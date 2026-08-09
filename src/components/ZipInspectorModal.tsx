import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileArchive,
  FileText,
  FolderTree,
  Layers,
  Loader2,
  Lock,
  ShieldCheck,
  Terminal,
  X
} from 'lucide-react';
import {
  RealZipProjectAnalysis,
  ZipInspectionService
} from '../services/zipInspectionService';
import { UploadedFile, ZipProjectAnalysis } from '../types';

interface ZipInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConvertProject: (analysis: ZipProjectAnalysis) => void;
  initialFile?: UploadedFile | null;
}

type InspectorTab = 'stack' | 'tree' | 'security' | 'verification';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ZipInspectorModal: React.FC<ZipInspectorModalProps> = ({
  isOpen,
  onClose,
  onConvertProject,
  initialFile
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('stack');
  const [analysis, setAnalysis] = useState<RealZipProjectAnalysis | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectionError, setInspectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setAnalysis(null);
      setInspectionError(null);
      setIsInspecting(false);
      setActiveTab('stack');
      return;
    }

    let cancelled = false;
    setAnalysis(null);
    setInspectionError(null);
    setIsInspecting(true);
    setActiveTab('stack');

    const frameId = window.requestAnimationFrame(() => {
      try {
        if (!initialFile?.contentBase64) {
          throw new Error(
            'O conteúdo do ZIP não está disponível. Selecione o arquivo novamente.'
          );
        }

        const result = ZipInspectionService.inspect({
          fileName: initialFile.name,
          contentBase64: initialFile.contentBase64
        });

        if (!cancelled) setAnalysis(result);
      } catch (error) {
        if (!cancelled) {
          setInspectionError(
            error instanceof Error
              ? error.message
              : 'Não foi possível inspecionar o arquivo ZIP.'
          );
        }
      } finally {
        if (!cancelled) setIsInspecting(false);
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [isOpen, initialFile]);

  const handleClose = () => {
    setAnalysis(null);
    setInspectionError(null);
    setActiveTab('stack');
    onClose();
  };

  const handleAttachAnalysis = () => {
    if (!analysis) return;
    onConvertProject(analysis);
    handleClose();
  };

  if (!isOpen) return null;

  const hasWarnings = Boolean(
    analysis &&
      (analysis.vulnerabilities.length > 0 || analysis.secretsExposed.length > 0)
  );

  const tabs: Array<{
    id: InspectorTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'stack', label: 'Stack', icon: Layers },
    { id: 'tree', label: 'Arquivos', icon: FolderTree },
    { id: 'security', label: 'Segurança', icon: ShieldCheck },
    { id: 'verification', label: 'Validação', icon: Terminal }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xl">
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col space-y-5 rounded-[32px] border border-amber-400/20 bg-zinc-950 p-6 text-white shadow-2xl shadow-amber-500/10">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-200 text-black shadow-lg shadow-amber-500/20">
              <FileArchive className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold">Inspeção segura do projeto ZIP</h3>
                {analysis && (
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                      hasWarnings
                        ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                        : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    {hasWarnings ? 'Revisão necessária' : 'Estrutura validada'}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-white/60">
                {initialFile?.name || 'Arquivo ZIP'} · análise estática local
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar inspeção ZIP"
            className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isInspecting && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <Loader2 className="h-9 w-9 animate-spin text-amber-300" />
            <div>
              <p className="text-sm font-bold">Validando e inspecionando o ZIP...</p>
              <p className="mt-1 text-xs text-white/55">
                Nenhum arquivo será executado.
              </p>
            </div>
          </div>
        )}

        {inspectionError && !isInspecting && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-red-400/20 bg-red-400/5 p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-red-300" />
            <div>
              <p className="text-sm font-bold text-red-200">ZIP recusado</p>
              <p className="mt-1 max-w-lg text-xs leading-relaxed text-white/65">
                {inspectionError}
              </p>
            </div>
          </div>
        )}

        {analysis && !isInspecting && (
          <>
            <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-1 text-xs font-medium">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 transition-all ${
                      activeTab === tab.id
                        ? 'bg-amber-400 font-bold text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="custom-scrollbar flex-1 space-y-4 overflow-auto pr-1">
              {activeTab === 'stack' && (
                <div className="space-y-4">
                  <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <span className="block text-xs font-bold text-amber-300">
                      Resumo real da inspeção
                    </span>
                    <p className="text-xs leading-relaxed text-white/80">
                      {analysis.architectureSummary}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Entradas', analysis.totalEntries.toLocaleString('pt-BR')],
                      ['ZIP', formatBytes(analysis.archiveSizeBytes)],
                      ['Extraído', formatBytes(analysis.uncompressedSizeBytes)],
                      ['Dependências', analysis.dependenciesCount.toLocaleString('pt-BR')]
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <span className="block text-[10px] uppercase tracking-wider text-white/40">
                          {label}
                        </span>
                        <strong className="mt-1 block text-sm text-white">{value}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-white/55">
                        Tecnologias identificadas
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {analysis.detectedStack.length > 0 ? (
                          analysis.detectedStack.map((technology) => (
                            <span key={technology} className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
                              {technology}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-white/45">Nenhuma stack determinada.</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-white/55">
                        Pontos de entrada
                      </span>
                      <div className="space-y-1">
                        {analysis.entryPoints.length > 0 ? (
                          analysis.entryPoints.map((entry) => (
                            <div key={entry} className="truncate font-mono text-xs text-white/75">
                              {entry}
                            </div>
                          ))
                        ) : (
                          <span className="text-xs text-white/45">Não identificados.</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-white/55">
                      Variáveis de ambiente referenciadas
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.envVars.length > 0 ? (
                        analysis.envVars.map((variable) => (
                          <span key={variable} className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 font-mono text-xs text-white/75">
                            {variable}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-white/45">Nenhuma variável encontrada.</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'tree' && (
                <div className="space-y-3">
                  {analysis.treeTruncated && (
                    <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-200">
                      Exibindo os primeiros {analysis.fileTree.length} itens de {analysis.totalEntries}.
                    </p>
                  )}
                  <div className="max-h-96 space-y-1 overflow-auto rounded-2xl border border-white/10 bg-black/60 p-4 font-mono text-xs">
                    {analysis.fileTree.map((item) => (
                      <div key={item.path} className="flex items-center justify-between gap-3 border-b border-white/5 py-1 text-white/80">
                        <div className="flex min-w-0 items-center gap-2">
                          {item.isDir ? (
                            <FolderTree className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                          )}
                          <span className="truncate" title={item.path}>{item.path}</span>
                        </div>
                        {!item.isDir && typeof item.size === 'number' && (
                          <span className="shrink-0 text-[10px] text-white/40">
                            {formatBytes(item.size)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'security' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[
                      ['Path traversal', 'Bloqueado'],
                      ['ZIP bomb', 'Limites aplicados'],
                      ['Links simbólicos', 'Bloqueados'],
                      ['Arquivos criptografados', 'Bloqueados']
                    ].map(([label, result]) => (
                      <div key={label} className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3.5 text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                          <ShieldCheck className="h-4 w-4" /> {label}
                        </div>
                        <p className="mt-1 text-[11px] text-white/65">{result}</p>
                      </div>
                    ))}
                  </div>

                  <div className={`rounded-2xl border p-4 ${analysis.secretsExposed.length > 0 ? 'border-red-400/25 bg-red-400/10' : 'border-emerald-400/20 bg-emerald-400/5'}`}>
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <Lock className={`h-4 w-4 ${analysis.secretsExposed.length > 0 ? 'text-red-300' : 'text-emerald-300'}`} />
                      Possíveis segredos: {analysis.secretsExposed.length}
                    </div>
                    {analysis.secretsExposed.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {analysis.secretsExposed.map((finding, index) => (
                          <div key={`${finding.file}-${finding.line}-${index}`} className="rounded-xl bg-black/30 p-2.5 text-[11px] text-white/70">
                            <strong className="text-red-200">{finding.type}</strong> · {finding.file}:{finding.line}
                            <div className="mt-1 font-mono text-white/40">{finding.snippet}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    {analysis.vulnerabilities.length > 0 ? (
                      analysis.vulnerabilities.map((finding, index) => (
                        <div key={`${finding.title}-${index}`} className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-xs">
                          <div className="flex items-center gap-2 font-bold text-amber-200">
                            <AlertTriangle className="h-4 w-4" />
                            [{finding.severity.toUpperCase()}] {finding.title}
                          </div>
                          <p className="mt-1.5 text-white/65">{finding.fix}</p>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-xs text-emerald-200">
                        <CheckCircle2 className="h-4 w-4" /> Nenhum alerta detectado pelas verificações estáticas implementadas.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'verification' && (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4 text-xs leading-relaxed text-blue-100">
                    Esta é uma inspeção estática no navegador. Ela não instala dependências, não executa scripts e não afirma que o projeto compila ou está pronto para produção.
                  </div>
                  <div className="max-h-64 space-y-1 overflow-auto rounded-2xl border border-white/10 bg-black/80 p-4 font-mono text-[11px] leading-relaxed text-emerald-400">
                    {analysis.sandboxLogs.map((log, index) => (
                      <div key={`${log}-${index}`}>&gt; {log}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <span className="block text-[10px] uppercase tracking-wider text-white/40">Arquivos textuais anexados à análise</span>
                      <strong className="mt-1 block text-lg text-white">{analysis.extractedTextFiles.length}</strong>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <span className="block text-[10px] uppercase tracking-wider text-white/40">Status do build</span>
                      <strong className="mt-1 block text-sm text-amber-300">Não executado</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-stretch justify-between gap-3 border-t border-white/10 pt-3 sm:flex-row sm:items-center">
              <span className="text-xs text-white/55">
                A análise incluirá arquivos textuais reais e metadados do ZIP.
              </span>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white/80 transition hover:bg-white/10 hover:text-white"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={handleAttachAnalysis}
                  className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-300 px-5 py-2.5 text-xs font-extrabold text-black shadow-xl shadow-amber-500/20 transition hover:brightness-110"
                >
                  Anexar análise real <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}

        {inspectionError && !isInspecting && (
          <div className="flex shrink-0 justify-end border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-white/80 transition hover:bg-white/10"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};