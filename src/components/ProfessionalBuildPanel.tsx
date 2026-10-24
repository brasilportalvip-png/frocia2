import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiClient, apiClientBlob } from "../services/apiClient";
import { ProjectConfigurationPanel } from "./ProjectConfigurationPanel";
interface Props {
  projectId: string;
  buildId: string;
  onClose(): void;
  onReady?(url: string, title: string): void;
  onRebuilt?(buildId: string): void;
}
export function ProfessionalBuildPanel({
  projectId,
  buildId,
  onClose,
  onReady,
  onRebuilt,
}: Props) {
  const [build, setBuild] = useState<any>(null),
    [error, setError] = useState(""),
    [config, setConfig] = useState(false),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null),
    closed = useRef(false);
  const base =
    "/api/professional-factory/projects/" +
    encodeURIComponent(projectId) +
    "/builds/" +
    encodeURIComponent(buildId);
  const ready = useRef(onReady);
  ready.current = onReady;
  const readyCalled = useRef(false);
  useEffect(() => {
    closed.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const result = await apiClient<any>(base, {
          signal: controller.signal,
        });
        if (closed.current) return;
        setBuild(result.build);
        if (result.build.ready && !readyCalled.current) {
          readyCalled.current = true;
          ready.current?.(result.build.publication.url, result.build.title);
        }
        if (
          !["ready", "failed", "cancelled", "configuration_required"].includes(
            result.build.status,
          )
        ) {
          const step = await apiClient<any>(base + "/advance", {
            method: "POST",
            body: "{}",
            signal: controller.signal,
          });
          if (!closed.current) setBuild(step.build);
        }
      } catch (e: any) {
        if (!controller.signal.aborted)
          setError(e.message || "Não foi possível consultar o progresso.");
      } finally {
        if (!closed.current) timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => {
      closed.current = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [base, config]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (config) return;
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const all = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href]",
          ) || [],
        );
        if (!all.length) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === all[0] ||
            document.activeElement === dialog.current)
        ) {
          e.preventDefault();
          all.at(-1)!.focus();
        } else if (!e.shiftKey && document.activeElement === all.at(-1)) {
          e.preventDefault();
          all[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [config, onClose]);
  async function action(name: string) {
    setBusy(true);
    setError("");
    try {
      const result = await apiClient<any>(base + "/" + name, {
        method: "POST",
        body: "{}",
      });
      setBuild(result.build);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function reconfigure() {
    setBusy(true);
    setError("");
    try {
      const result = await apiClient<any>(base + "/reconfigure", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      onRebuilt?.(result.build.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    try {
      const blob = await apiClientBlob(base + "/export", {}, "zip");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "froc-projeto-completo.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const labels = [
    "Descoberta",
    "Experiência e design",
    "Frontend",
    "Backend e dados",
    "Pagamentos",
    "Conteúdo e SEO",
    "Mídia e 3D",
    "Segurança e políticas",
    "Verificação",
    "Entrega",
    "Geração do projeto",
    "Revisão do código",
    "Configuração",
    "Testes isolados",
    "Publicação e verificação",
    "Entrega concluída",
  ];
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-3">
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="factory-build-title"
        className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-950 p-5 text-white"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="factory-build-title" className="text-lg font-semibold">
            {build?.title || "Construindo seu projeto"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/20 px-3 py-2"
          >
            Fechar
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-300">
          Você pode fechar este painel. As etapas e os resultados ficam salvos
          para o executor automático continuar.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
        )}
        {build?.monitoring?.status === "degraded" && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-amber-400/30 p-3 text-sm text-amber-200"
          >
            A verificação mais recente encontrou uma falha no projeto publicado.{" "}
            {build.monitoring.failures.join(" ")}
          </div>
        )}
        {build && (
          <>
            <p role="status" className="mt-4 text-sm">
              {build.ready
                ? "Entrega verificada"
                : labels[build.phase] || "Aguardando"}{" "}
              · {build.progress}%
            </p>
            <progress
              aria-label="Progresso da construção"
              max="100"
              value={build.progress}
              className="mt-2 w-full"
            />
            <p className="mt-2 text-xs text-slate-400">
              {build.completedAgentIds.length}/50 especialistas de criação com
              parecer registrado. Créditos consumidos: {build.consumedCredits}.
              Limite estimado com correções e mídias:{" "}
              {build.estimatedMaximumCredits}.
            </p>
            {build.error && (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-red-400/20 p-3 text-sm text-red-200"
              >
                {build.error}
              </p>
            )}
            {build.status === "configuration_required" && (
              <div className="mt-4 rounded-xl border border-violet-400/30 bg-violet-500/10 p-4">
                <h3 className="font-semibold">
                  Faltam configurações do projeto
                </h3>
                <p className="mt-2 text-sm text-slate-300">
                  Preencha os valores no painel. Você não precisa editar código.
                </p>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {build.missingVariables.map((v: any) => (
                    <li key={v.name + v.environment}>
                      {v.purpose} (
                      {v.environment === "both"
                        ? "ambos os ambientes"
                        : v.environment}
                      )
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setConfig(true)}
                  className="mt-3 rounded-lg bg-violet-600 px-4 py-2"
                >
                  Configurar variáveis
                </button>
              </div>
            )}
            {build.certificate && (
              <p className="mt-3 text-sm">
                Testes isolados:{" "}
                {build.certificate.status === "passed"
                  ? "aprovados"
                  : build.certificate.status === "waiting_executor"
                    ? "aguardando executor"
                    : build.certificate.status === "failed"
                      ? "reprovados"
                      : "em execução"}
                .
              </p>
            )}
            {build.publication?.previewUrl && (
              <a
                href={build.publication.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block rounded-lg border border-white/20 px-4 py-2 text-sm"
              >
                Abrir prévia
              </a>
            )}
            {build.ready && (
              <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                <h3 className="font-semibold">
                  Projeto publicado e verificado
                </h3>
                <a
                  href={build.publication.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2"
                >
                  Abrir projeto pronto
                </a>
                <p className="mt-2 text-xs text-slate-300">
                  A submissão aos mecanismos de busca não garante indexação nem
                  posição.
                </p>
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfig(true)}
                className="rounded-lg border border-white/20 px-3 py-2 text-sm"
              >
                Variáveis e agentes
              </button>
              {build.ready && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={reconfigure}
                  className="rounded-lg border border-white/20 px-3 py-2 text-sm"
                >
                  Aplicar novas configurações
                </button>
              )}
              {build.phase >= 11 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={download}
                  className="rounded-lg border border-white/20 px-3 py-2 text-sm"
                >
                  Baixar código completo
                </button>
              )}
              {["failed", "configuration_required"].includes(build.status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action("resume")}
                  className="rounded-lg bg-violet-600 px-3 py-2 text-sm"
                >
                  Retomar construção
                </button>
              )}
              {!["ready", "cancelled"].includes(build.status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action("cancel")}
                  className="rounded-lg border border-red-400/30 px-3 py-2 text-sm text-red-200"
                >
                  Cancelar construção
                </button>
              )}
            </div>
          </>
        )}
        {config && (
          <ProjectConfigurationPanel
            projectId={projectId}
            title={build?.title || "Novo projeto"}
            requiredVariables={build?.requiredVariables || []}
            suggestedSiteUrl={build?.suggestedSiteUrl}
            onSaved={() => {
              setConfig(false);
              if (build?.status === "configuration_required")
                void action("resume");
            }}
            onClose={() => setConfig(false)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
