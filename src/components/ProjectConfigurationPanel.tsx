import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "../services/apiClient";
import { ProjectMaintenancePanel } from './ProjectMaintenancePanel';
import { GithubProjectPanel } from './GithubProjectPanel';
import {
  INTELLIGENCE_AGENTS,
  CREATION_AGENTS,
} from "../../shared/advancedAgentCatalog";

type Variable = {
  name: string;
  purpose: string;
  visibility: "public" | "secret";
  environment: "preview" | "production" | "both";
  value?: string;
  configured?: boolean;
};
interface Props {
  projectId: string;
  title: string;
  onClose(): void;
  onSaved?(): void;
  requiredVariables?: Omit<Variable, "configured" | "value">[];
  suggestedSiteUrl?: string;
  initialTab?: 'github';
}

export function ProjectConfigurationPanel({
  projectId,
  title,
  onClose,
  requiredVariables = [],
  suggestedSiteUrl,
  onSaved,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<"variables" | "agents" | "delivery" | "maintenance" | "github">(
    initialTab || "variables",
  );
  const [variables, setVariables] = useState<Variable[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const controller = new AbortController();
    apiClient<{ revision: number; variables: Variable[] }>(
      `/api/project-variables/${encodeURIComponent(projectId)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setRevision(result.revision);
        setVariables([
          ...result.variables,
          ...requiredVariables
            .filter(
              (v) =>
                !result.variables.some(
                  (existing) =>
                    existing.name === v.name &&
                    (existing.environment === v.environment ||
                      existing.environment === "both"),
                ),
            )
            .map((v) => ({
              ...v,
              value: v.name === "PUBLIC_SITE_URL" ? suggestedSiteUrl || "" : "",
            })),
        ]);
        setLoaded(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e.message || "Não foi possível carregar as variáveis.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [projectId]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key !== "Tab") return;
      const all = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
        ) || [],
      );
      const first = all[0],
        last = all[all.length - 1];
      if (!first) {
        e.preventDefault();
        dialog.current?.focus();
      } else if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = oldOverflow;
      previous?.focus?.();
    };
  }, []);
  function change(index: number, patch: Partial<Variable>) {
    setVariables((current) =>
      current.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    );
    setSaved(false);
  }
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await apiClient<{
        revision: number;
        variables: Variable[];
      }>(`/api/project-variables/${encodeURIComponent(projectId)}`, {
        method: "PUT",
        body: JSON.stringify({
          revision,
          variables: variables.map(({ configured, ...entry }) => entry),
        }),
      });
      setVariables(result.variables);
      setRevision(result.revision);
      setSaved(true);
      onSaved?.();
    } catch (e: any) {
      setError(e.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3 sm:p-6">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-configuration-title"
        tabIndex={-1}
        className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950 text-white shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <h2 id="project-configuration-title" className="font-semibold">
              Configuração do projeto
            </h2>
            <p className="text-xs text-slate-400">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/20 px-3 py-2"
            aria-label="Fechar configuração"
          >
            Fechar
          </button>
        </header>
        <nav
          aria-label="Configuração do projeto"
          className="flex flex-wrap gap-2 border-b border-white/10 p-3"
        >
          {(
            [
              ["variables", "Variáveis"],
              ["agents", "Agentes"],
              ["delivery", "Entrega"],
              ["maintenance", "Manutenção"],
              ["github", "GitHub"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-2 text-sm ${tab === id ? "bg-violet-600" : "bg-white/5"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="overflow-y-auto p-4 sm:p-6">
          {tab === 'github' && <GithubProjectPanel projectId={projectId} />}
          {tab === 'maintenance' && <ProjectMaintenancePanel projectId={projectId} />}
          {tab === "variables" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                Configure valores públicos e segredos deste projeto. Segredos
                salvos não são mostrados novamente nem enviados ao chat.
              </p>
              <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-200">
                Os valores são aplicados ao ambiente correspondente pela
                fábrica. Salvar a configuração permite retomar os testes; a
                publicação é confirmada somente após as verificações.
              </p>
              {error && (
                <p role="alert" className="text-sm text-red-300">
                  {error}
                </p>
              )}
              {saved && (
                <p role="status" className="text-sm text-emerald-300">
                  Variáveis salvas com criptografia.
                </p>
              )}
              {busy && (
                <p role="status" className="text-sm text-slate-400">
                  Aguarde…
                </p>
              )}
              <fieldset
                disabled={busy || !loaded}
                className="space-y-4 disabled:opacity-60"
              >
                {variables.map((entry, index) => (
                  <div
                    key={index}
                    className="grid gap-3 rounded-xl border border-white/10 p-4 sm:grid-cols-2"
                  >
                    <label className="space-y-1 text-xs">
                      Nome
                      <input
                        aria-label={`Nome da variável ${index + 1}`}
                        value={entry.name}
                        onChange={(e) =>
                          change(index, { name: e.target.value.toUpperCase() })
                        }
                        className="block w-full rounded-lg border border-white/20 bg-slate-900 p-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      Finalidade
                      <input
                        value={entry.purpose}
                        onChange={(e) =>
                          change(index, { purpose: e.target.value })
                        }
                        className="block w-full rounded-lg border border-white/20 bg-slate-900 p-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      Visibilidade
                      <select
                        value={entry.visibility}
                        onChange={(e) =>
                          change(index, {
                            visibility: e.target
                              .value as Variable["visibility"],
                            value: undefined,
                            configured: false,
                          })
                        }
                        className="block w-full rounded-lg border border-white/20 bg-slate-900 p-2 text-sm"
                      >
                        <option value="secret">
                          Segredo (somente servidor)
                        </option>
                        <option value="public">
                          Público (pode aparecer no site)
                        </option>
                      </select>
                    </label>
                    <label className="space-y-1 text-xs">
                      Ambiente
                      <select
                        value={entry.environment}
                        onChange={(e) =>
                          change(index, {
                            environment: e.target
                              .value as Variable["environment"],
                            value: undefined,
                            configured: false,
                          })
                        }
                        className="block w-full rounded-lg border border-white/20 bg-slate-900 p-2 text-sm"
                      >
                        <option value="preview">Prévia / teste</option>
                        <option value="production">Produção</option>
                        <option value="both">Ambos</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-xs sm:col-span-2">
                      Valor{" "}
                      {entry.configured && entry.visibility === "secret"
                        ? "(já configurado; preencha somente para substituir)"
                        : ""}
                      <input
                        type={
                          entry.visibility === "secret" ? "password" : "text"
                        }
                        autoComplete="off"
                        spellCheck={false}
                        value={entry.value ?? ""}
                        onChange={(e) =>
                          change(index, { value: e.target.value })
                        }
                        className="block w-full rounded-lg border border-white/20 bg-slate-900 p-2 text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setVariables((v) => v.filter((_, i) => i !== index));
                        setSaved(false);
                      }}
                      className="justify-self-start rounded-lg border border-red-400/30 px-3 py-2 text-xs text-red-300"
                    >
                      Remover variável
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={variables.length >= 50}
                    onClick={() => {
                      setVariables((v) => [
                        ...v,
                        {
                          name: "",
                          purpose: "",
                          visibility: "secret",
                          environment: "preview",
                          value: "",
                        },
                      ]);
                      setSaved(false);
                    }}
                    className="rounded-lg border border-white/20 px-4 py-2 text-sm"
                  >
                    Adicionar variável
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    className="rounded-lg bg-violet-600 px-4 py-2 text-sm"
                  >
                    Salvar variáveis
                  </button>
                </div>
              </fieldset>
            </div>
          )}
          {tab === "agents" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-300">
                15 perspectivas de inteligência e 50 de criação complementam os
                20 agentes existentes. São direções cooperantes no modelo
                configurado, não 65 modelos independentes.
              </p>
              {[
                { title: "Inteligência", agents: INTELLIGENCE_AGENTS },
                {
                  title: "Criação de sites e aplicativos",
                  agents: CREATION_AGENTS,
                },
              ].map((group) => (
                <section key={group.title}>
                  <h3 className="mb-3 font-semibold">{group.title}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.agents.map((agent) => (
                      <details
                        key={agent.id}
                        className="rounded-lg border border-white/10 p-3"
                      >
                        <summary className="cursor-pointer text-sm">
                          {agent.name}
                        </summary>
                        <p className="mt-2 text-xs text-slate-300">
                          {agent.mission}
                        </p>
                        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-slate-400">
                          {agent.method.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      </details>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {tab === "delivery" && (
            <div className="space-y-4 text-sm text-slate-300">
              <h3 className="font-semibold text-white">
                Certificação antes da entrega
              </h3>
              <p>
                A fábrica gera frontend, funções de backend, testes e arquivos
                de publicação. O projeto passa por revisão, instalação limpa,
                testes, build, navegador, integrações, prévia e verificação da
                produção.
              </p>
              <p>
                O painel de construção mostra os resultados reais de cada etapa.
                Uma configuração pendente ou teste reprovado impede a indicação
                de entrega concluída.
              </p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Requisitos e jornadas completas.</li>
                <li>APIs, banco, autenticação e isolamento.</li>
                <li>Pagamentos com teste e webhook verificado.</li>
                <li>
                  Cookies funcionais, termos e privacidade adequados ao negócio.
                </li>
                <li>SEO, sitemap XML, responsividade e acessibilidade.</li>
                <li>Mídias finais, incluindo vídeo e 3D quando solicitados.</li>
                <li>
                  Instalação, testes, build, publicação e monitoramento
                  comprovados.
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
