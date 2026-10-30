import { describe, expect, it } from 'vitest';
import {
  EXPERT_AGENTS,
  EXPERT_AGENT_COUNT,
  expertTeamPolicy,
  routeExpertAgents,
} from '../shared/expertAgentCatalog.js';
import { ADVANCED_AGENTS } from '../shared/advancedAgentCatalog.js';
import { AIRequestOrchestrator } from '../server/ai/requestOrchestrator.js';
import { installedSelfSiteAgentInventory } from '../server/selfEvolution/selfSiteKnowledgeService.js';
import { validateGeneratedSiteFunctionality } from '../server/siteFactory/generatedSiteFunctionalGate.js';

describe('215 agentes especialistas', () => {
  it('tem 215 perfis completos, com identificadores unicos e sem colidir com os 85 existentes', () => {
    expect(EXPERT_AGENTS).toHaveLength(215);
    expect(EXPERT_AGENT_COUNT).toBe(215);
    const ids = EXPERT_AGENTS.map(agent => agent.id);
    expect(new Set(ids).size).toBe(215);
    const existing = new Set(ADVANCED_AGENTS.map(agent => agent.id));
    expect(ids.some(id => existing.has(id))).toBe(false);
    for (const agent of EXPERT_AGENTS) {
      expect(agent.mission.length).toBeGreaterThan(30);
      expect(agent.method.length).toBeGreaterThanOrEqual(3);
      expect(agent.acceptance.length).toBeGreaterThanOrEqual(2);
      expect(agent.keywords.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('nao promete acao inexistente e protege areas sensiveis', () => {
    for (const agent of EXPERT_AGENTS) {
      expect(agent.acceptance.join(' ')).toMatch(/Nao afirma ter executado/);
    }
    const finance = EXPERT_AGENTS.filter(agent => agent.category === 'financas');
    const health = EXPERT_AGENTS.filter(agent => agent.category === 'saude');
    expect(finance.every(agent => /nao substitui|recomendar|habilitad/i.test(agent.method.join(' ') + agent.acceptance.join(' ')))).toBe(true);
    expect(health.every(agent => /profissional/i.test(agent.method.join(' ') + agent.acceptance.join(' ')))).toBe(true);
  });

  it('roteia cada pedido para poucos especialistas relevantes e ignora conversa simples', () => {
    expect(routeExpertAgents('Oi, tudo bem?')).toEqual([]);
    expect(routeExpertAgents('Oi.')).toEqual([]);
    const pizza = routeExpertAgents('Crie um site de pizzaria com cardapio e delivery').map(agent => agent.id);
    expect(pizza).toContain('expert-pizzaria-delivery');
    expect(pizza.length).toBeLessThanOrEqual(4);
    const stock = routeExpertAgents('Preciso de um app de controle de estoque com graficos').map(agent => agent.id);
    expect(stock).toContain('expert-app-estoque');
    const tax = routeExpertAgents('Como declarar imposto do MEI?').map(agent => agent.id);
    expect(tax).toContain('expert-impostos-mei');
  });

  it('entra na politica do chat somente quando ha especialistas relevantes', () => {
    const pizza = AIRequestOrchestrator.plan({ mode: 'smart', prompt: 'Crie um site de pizzaria com cardapio e delivery' }).systemPolicy;
    expect(pizza).toContain('ESPECIALISTAS ACIONADOS');
    expect(pizza).toContain('Pizzaria e delivery');
    const hello = AIRequestOrchestrator.plan({ mode: 'smart', prompt: 'Oi.' }).systemPolicy;
    expect(hello).not.toContain('ESPECIALISTAS ACIONADOS');
    expect(expertTeamPolicy('Oi.')).toBe('');
  });

  it('o inventario informa 85 perfis base e 300 no total, sem alterar a lista dos 85', () => {
    const inventory = installedSelfSiteAgentInventory();
    expect(inventory.agents).toHaveLength(85);
    expect(inventory.expertAgents).toBe(215);
    expect(inventory.totalWithExperts).toBe(300);
  });
});

describe('portao de sites: texto de exemplo', () => {
  it('reprova lorem ipsum e placeholders', () => {
    const result = validateGeneratedSiteFunctionality(
      'Crie um site de pizzaria',
      '<!doctype html><html><head></head><body><h1>Lorem ipsum dolor</h1><button id="b">Pedir</button><script>b.addEventListener("click",()=>{})</script></body></html>',
    );
    expect(result.passed).toBe(false);
    expect(result.issues.join(' ')).toMatch(/textos de exemplo/);
  });
});
