import { z } from "zod";
import { adminDb, isFirebaseAdminConfigured } from "../lib/firebaseAdmin.js";
import { getProfessionalFactory } from "./professionalRuntime.js";
import type { ProfessionalBuild } from "./professionalBuildService.js";

/**
 * Contexto do projeto em construção para o chat da Froc.IA.
 *
 * O navegador só manda os identificadores (projeto e construção). O servidor confere
 * se o projeto é da pessoa e lê o estado real da construção: etapa, erros, arquivos
 * já escritos, variáveis que faltam e links de prévia. Assim o chat sempre sabe o que
 * está acontecendo, mesmo enquanto o código ainda está sendo gerado.
 */

export const FACTORY_PHASE_LABELS = [
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

const STATUS_LABELS: Record<string, string> = {
  queued: "na fila",
  planning: "planejando com os especialistas",
  generating: "escrevendo o código",
  reviewing: "revisando o código",
  configuration_required: "aguardando a pessoa preencher variáveis no painel",
  certifying: "testando em ambiente isolado",
  publishing: "publicando e verificando",
  ready: "pronto e publicado",
  failed: "parado por erro",
  cancelled: "cancelado",
};

const refSchema = z
  .object({
    projectId: z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/),
    buildId: z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/),
  })
  .strict();

export function parseActiveBuildRef(value: unknown) {
  const parsed = refSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const MAX_CONTEXT = 30000;
const PRIORITY_FILE =
  /^(?:index\.html|src\/(?:App|main)\.tsx|src\/(?:types|lib\/[^/]+|services\/[^/]+)\.ts|api\/[^/]+\.ts)$/;

export function describeBuildForChat(b: ProfessionalBuild, missing: Array<{ name: string; purpose: string; environment: string }>): string {
  const lines: string[] = [];
  const phaseLabel = FACTORY_PHASE_LABELS[b.phase] || "Aguardando";
  lines.push(
    `CONSTRUÇÃO EM ANDAMENTO NA FÁBRICA DA FROC.IA (dados reais lidos agora do servidor):`,
    `- Situação: ${STATUS_LABELS[b.status] || b.status}. Etapa ${Math.min(b.phase + 1, 16)} de 16: ${phaseLabel}.`,
    `- Pedido original: ${String(b.brief?.prompt || "").slice(0, 1500)}`,
    `- Créditos consumidos até agora: ${b.consumedCredits}. Correções automáticas usadas: ${b.repairs}.`,
  );
  if (b.error) lines.push(`- Último erro registrado: ${b.error}`);
  if (b.feedback?.length)
    lines.push(`- Pontos que a revisão mandou corrigir: ${b.feedback.join(" | ").slice(0, 1500)}`);
  const decisions = (b.reports || [])
    .flatMap((r) => r.contributions.flatMap((c) => c.decisions.slice(0, 1)))
    .slice(0, 12);
  if (decisions.length)
    lines.push(`- Decisões dos especialistas (resumo):\n  • ${decisions.map((d) => d.slice(0, 220)).join("\n  • ")}`);
  if (b.generation?.manifest?.length) {
    lines.push(
      `- Arquivos planejados: ${b.generation.manifest.length}; já escritos: ${b.generation.files.length}.`,
      `- Plano de arquivos:\n${b.generation.manifest
        .map((f) => `  • ${f.path}${b.generation!.files.some((x) => x.path === f.path) ? " (escrito)" : " (pendente)"} — ${f.purpose.slice(0, 160)}`)
        .join("\n")}`,
    );
  }
  if (missing.length)
    lines.push(
      `- Variáveis que a pessoa ainda precisa preencher no painel "Variáveis e agentes" (nunca peça os valores no chat):\n${missing
        .map((v) => `  • ${v.name} (${v.environment}): ${v.purpose}`)
        .join("\n")}`,
    );
  if (b.deferredVariables?.length)
    lines.push(
      `- A construção segue (ou foi publicada) SEM estas variáveis, que a pessoa preenche depois em "Variáveis e agentes" e então toca em "Aplicar novas configurações" para testar e republicar: ${b.deferredVariables
        .map((v) => `${v.name} (${v.purpose})`)
        .join("; ")}. Até lá, as partes que dependem delas (ex.: pagamento) ficam inativas.`,
    );
  if (b.publication?.previewUrl) lines.push(`- Prévia publicada: ${b.publication.previewUrl}`);
  if (b.publication?.url && b.status === "ready") lines.push(`- Endereço final: ${b.publication.url}`);
  if (b.phase === 13 && b.certificate?.status === "waiting_executor")
    lines.push(
      "- Os testes isolados rodam no executor automático (GitHub Actions), que passa a cada 20 minutos ou quando é chamado. Enquanto isso o código já pode ser visto na prévia do editor e baixado.",
    );

  const files = b.bundle?.files || b.generation?.files || [];
  if (b.bundle) {
    lines.push(
      `- Projeto gerado: "${b.bundle.title}" — ${b.bundle.description}`,
      `- Páginas públicas: ${b.bundle.publicPages.join(", ")}`,
      `- Requisitos: ${b.bundle.requirements.map((r) => r.description).join(" | ").slice(0, 2500)}`,
    );
  }
  if (files.length) {
    lines.push(`- Lista de arquivos: ${files.map((f) => f.path).join(", ")}`);
    let header = lines.join("\n");
    let budget = MAX_CONTEXT - header.length - 200;
    const ordered = [...files].sort(
      (a, c) => Number(PRIORITY_FILE.test(c.path)) - Number(PRIORITY_FILE.test(a.path)),
    );
    const parts: string[] = [];
    for (const f of ordered) {
      const block = `\n--- ${f.path} ---\n${f.content}`;
      if (block.length > budget) {
        if (budget > 1500) parts.push(`\n--- ${f.path} (trecho) ---\n${f.content.slice(0, budget - 200)}`);
        break;
      }
      parts.push(block);
      budget -= block.length;
    }
    header += `\n\nCÓDIGO ATUAL (arquivos do projeto):${parts.join("")}`;
    return header.slice(0, MAX_CONTEXT);
  }
  lines.push("- O código ainda não começou a ser escrito; os especialistas estão planejando.");
  return lines.join("\n").slice(0, MAX_CONTEXT);
}

/** Lê a construção da pessoa e devolve o texto de contexto (ou "" se não houver acesso). */
export async function loadFactoryChatContext(
  user: { uid: string; tenantId: string },
  ref: unknown,
): Promise<string> {
  const parsed = parseActiveBuildRef(ref);
  if (!parsed || !isFirebaseAdminConfigured()) return "";
  try {
    const project = await adminDb.collection("projects").doc(parsed.projectId).get();
    if (
      !project.exists ||
      project.data()?.userId !== user.uid ||
      project.data()?.tenantId !== user.tenantId
    )
      return "";
    const scope = { projectId: parsed.projectId, userId: user.uid, tenantId: user.tenantId };
    const service = getProfessionalFactory();
    const build = await service.get(parsed.buildId, scope);
    if (!build) return "";
    const missing = await service.missingVariables(build).catch(() => []);
    return describeBuildForChat(build, missing);
  } catch (error) {
    console.warn("Contexto da construção indisponível para o chat:", error);
    return "";
  }
}

/**
 * Resumo em linguagem simples do estado da construção, montado só com os dados reais
 * (usado quando o modelo, por engano, responderia que não vê o projeto).
 */
export function describeFactoryStatusForPerson(context: string): string {
  const pick = (label: string) =>
    context
      .split("\n")
      .find((line) => line.startsWith("- " + label))
      ?.slice(2)
      .trim();
  const lines = [
    "Estou acompanhando a construção do seu projeto agora:",
    pick("Situação"),
    pick("Arquivos planejados"),
    pick("Projeto gerado"),
    pick("Último erro registrado"),
    pick("Prévia publicada"),
    pick("Os testes isolados"),
  ].filter(Boolean) as string[];
  const missing = context.includes("Variáveis que a pessoa ainda precisa preencher")
    ? '\nFaltam algumas variáveis: preencha no botão "Variáveis e agentes" do painel.'
    : "";
  return (
    lines.join("\n") +
    missing +
    "\n\nPode me perguntar sobre qualquer parte do projeto ou pedir alterações, por exemplo: \"troque a cor do botão para azul\"."
  );
}
