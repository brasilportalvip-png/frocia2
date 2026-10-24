import { describe, expect, it } from "vitest";
import {
  ADVANCED_AGENTS,
  INTELLIGENCE_AGENTS,
  CREATION_AGENTS,
  FACTORY_STAGES,
} from "../shared/advancedAgentCatalog.js";
import { AIRequestOrchestrator } from "../server/ai/requestOrchestrator.js";
import {
  creationTeamPolicy,
  previewDelivery,
} from "../server/siteFactory/creationTeamService.js";

describe("advanced specialist teams", () => {
  it("adds 15 intelligence and 50 creation profiles with concrete methods", () => {
    expect(ADVANCED_AGENTS).toHaveLength(65);
    expect(INTELLIGENCE_AGENTS).toHaveLength(15);
    expect(CREATION_AGENTS).toHaveLength(50);
    expect(new Set(ADVANCED_AGENTS.map((a) => a.id)).size).toBe(65);
    for (const stage of FACTORY_STAGES)
      expect(CREATION_AGENTS.filter((a) => a.stage === stage.id)).toHaveLength(
        5,
      );
    for (const agent of ADVANCED_AGENTS) {
      expect(agent.mission.length).toBeGreaterThan(40);
      expect(agent.method).toHaveLength(4);
      expect(agent.deliverables.length).toBeGreaterThan(0);
      expect(agent.acceptance.length).toBeGreaterThan(0);
    }
  });
  it.each([
    "Boa noite, Flavio. Vou descansar agora.",
    "Como você está hoje?",
    "Hoje eu trabalhei muito nos agentes para melhorar você.",
  ])("preserves natural conversation: %s", (prompt) => {
    const plan = AIRequestOrchestrator.plan({ mode: "smart", prompt });
    expect(plan.classification.requiresSearch).toBe(false);
    expect(plan.specialistAgentIds).toContain("intelligence-communication");
    expect(plan.systemPolicy).toContain("Converse naturalmente");
  });
  it("selects software experts while preserving registered tools", () => {
    const plan = AIRequestOrchestrator.plan({
      mode: "code",
      prompt: "Corrija a arquitetura TypeScript e os testes desta API.",
    });
    expect(plan.specialistAgentIds).toContain("intelligence-software");
    expect(plan.specialistAgentIds).toContain("intelligence-review");
    expect(plan.classification.requiresCode).toBe(true);
  });
  it("applies the full creation team without claiming production evidence", () => {
    const policy = creationTeamPolicy();
    for (const agent of CREATION_AGENTS) expect(policy).toContain(agent.id);
    const result = previewDelivery("Uma loja com pagamentos por cartão");
    expect(result.appliedProfileIds).toHaveLength(50);
    expect(result.productionReady).toBe(false);
    expect(result.checklist.find((g) => g.id === "payments")?.required).toBe(
      true,
    );
    expect(result.checklist.every((g) => g.status === "pending")).toBe(true);
  });
});
