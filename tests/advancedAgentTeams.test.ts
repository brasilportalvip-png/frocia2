import { describe, expect, it } from "vitest";
import {
  ADVANCED_AGENTS,
  INTELLIGENCE_AGENTS,
  CREATION_AGENTS,
  FACTORY_STAGES,
} from "../shared/advancedAgentCatalog.js";
import { AIRequestOrchestrator } from "../server/ai/requestOrchestrator.js";
import { installedSelfSiteAgents } from '../server/selfEvolution/selfSiteKnowledgeService.js';
import { COMMITTEE_ROLES } from '../server/selfEvolution/selfEvolutionTypes.js';
import { buildSpecialistSystemInstruction } from '../server/selfEvolution/specialistCapabilityCatalog.js';
import { INNOVATION_AGENTS, buildInnovationPrompt } from '../server/selfEvolution/innovationAgentCatalog.js';
import { AGENT_QUALITY_CONTRACTS } from '../shared/agentQualityContracts.js';
import {
  creationTeamPolicy,
  previewDelivery,
} from "../server/siteFactory/creationTeamService.js";

describe("advanced specialist teams", () => {
  it('liga contratos específicos aos 85 perfis existentes sem perder identidades', () => {
    const agents = installedSelfSiteAgents();
    expect(Object.keys(AGENT_QUALITY_CONTRACTS).sort()).toEqual(agents.map(agent => agent.id).sort());
    expect(new Set(Object.values(AGENT_QUALITY_CONTRACTS).map(contract => contract.investigate)).size).toBe(85);
    for (const agent of agents) {
      const contract = AGENT_QUALITY_CONTRACTS[agent.id];
      for (const value of Object.values(contract)) expect(value.length).toBeGreaterThan(45);
      const prompt = COMMITTEE_ROLES.includes(agent.id as any)
        ? buildSpecialistSystemInstruction(agent.id as any)
        : INNOVATION_AGENTS.some(profile => profile.id === agent.id)
          ? buildInnovationPrompt(INNOVATION_AGENTS.find(profile => profile.id === agent.id)!)
          : creationTeamPolicy('project') + AIRequestOrchestrator.plan({ mode: 'smart', prompt: 'Oi.' }).systemPolicy;
      if (agent.kind === 'review' || agent.kind === 'innovation' || agent.kind === 'creation') expect(prompt).toContain(contract.verify);
    }
    for (const profile of ADVANCED_AGENTS) {
      const contract = AGENT_QUALITY_CONTRACTS[profile.id];
      expect(profile.method).toContain(contract.investigate);
      expect(profile.method).toContain(contract.handoff);
      expect(profile.acceptance).toContain(contract.verify);
      expect(profile.deliverables).toContain(contract.deliver);
    }
  });
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
  it.each([
    ['Compreenda o objetivo desta conversa.', 'understanding'],
    ['Investigue uma arquitetura complexa passo a passo.', 'reasoning'],
    ['Pesquise fontes para este estudo.', 'research'],
    ['Explique o significado da palavra amizade.', 'knowledge'],
    ['Resolva a equação 3x + 7 = 22.', 'mathematics'],
    ['Explique a física do movimento.', 'science'],
    ['Revise este código TypeScript.', 'software'],
    ['Boa noite, vou descansar.', 'communication'],
    ['Invente ideias para um roteiro.', 'creativity'],
    ['Planeje uma campanha de marketing.', 'business'],
    ['Analise as cláusulas deste contrato.', 'legal'],
    ['Explique os sintomas desta doença.', 'health'],
    ['Analise o risco deste investimento.', 'finance'],
    ['Revise a segurança contra XSS.', 'security'],
    ['Revise o atendimento ao meu pedido.', 'review'],
  ])('seleciona e aplica o especialista em %s', (prompt, name) => {
    const plan = AIRequestOrchestrator.plan({ mode: 'smart', prompt });
    const id = 'intelligence-' + name;
    expect(plan.specialistAgentIds).toContain(id);
    expect(plan.systemPolicy).toContain(id);
    expect(plan.systemPolicy).toContain(INTELLIGENCE_AGENTS.find(agent => agent.id === id)!.mission);
  });
  it.each(['Resolva a equação 3x + 7 = 22.', 'Qual a derivada de x ao quadrado?', 'Calcule a probabilidade deste evento.'])(
    'não deixa matemática pura fora da equipe: %s', prompt => {
      const plan = AIRequestOrchestrator.plan({ mode: 'smart', prompt });
      expect(plan.specialistAgentIds).toContain('intelligence-mathematics');
    });
  it('inclui raciocínio em assunto de alto impacto mesmo sem complexidade explícita', () => {
    const plan = AIRequestOrchestrator.plan({ mode: 'smart', prompt: 'Explique os riscos deste medicamento.' });
    expect(plan.classification.sensitivity).toBe('high-stakes');
    expect(plan.specialistAgentIds).toContain('intelligence-reasoning');
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
