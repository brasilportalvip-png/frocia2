import { AGENT_EXECUTION_PROTOCOL } from "../../shared/agentExecutionProtocol.js";
import {
  INTELLIGENCE_AGENTS,
  describeAgent,
} from "../../shared/advancedAgentCatalog.js";
import type { RequestClassification } from "../ai/types/ai.js";

/** Preserva o roteamento, a pesquisa e os controles de memória existentes. */
export function intelligenceTeam(
  classification: RequestClassification,
  prompt: string,
) {
  const ids = new Set(["understanding", "communication", "review"]);
  const domain: Record<string, string[]> = {
    general: ["knowledge"],
    research: ["research"],
    marketing: ["business", "creativity"],
    sales: ["business"],
    code: ["software"],
    "site-builder": ["software", "creativity"],
    "ux-accessibility": ["software"],
    "data-documents": ["mathematics", "knowledge"],
    security: ["security"],
    finance: ["finance", "mathematics"],
    legal: ["legal"],
    health: ["health", "science"],
    "social-media": ["business", "creativity"],
  };
  for (const id of domain[classification.domain] || []) ids.add(id);
  if (classification.complexity === "complex") ids.add("reasoning");
  if (classification.requiresSearch) ids.add("research");
  if (/\b(f[ií]sica|qu[ií]mica|ci[eê]ncia|biologia|engenharia)\b/i.test(prompt))
    ids.add("science");
  if (/\b(criativ|ideias|invente|imagine|roteiro)/i.test(prompt))
    ids.add("creativity");
  const agents = INTELLIGENCE_AGENTS.filter((a) =>
    ids.has(a.id.replace("intelligence-", "")),
  );
  return {
    agents,
    policy: [
      "EQUIPE DE INTELIGÊNCIA: aplique estas perspectivas cooperantes no modelo desta execução.",
      "Não são chamadas independentes nem ferramentas adicionais. Não alegue deliberação ou acesso que não ocorreu.",
      "Converse naturalmente; relatos pessoais, saudações e continuidade não exigem evidência externa.",
      AGENT_EXECUTION_PROTOCOL,
      ...agents.map(describeAgent),
    ].join("\n\n"),
  };
}
