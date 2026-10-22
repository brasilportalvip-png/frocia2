import { describe, expect, it } from 'vitest';
import { COMMITTEE_ROLES } from '../server/selfEvolution/selfEvolutionTypes.js';
import {
  INNOVATION_AGENTS, buildInnovationPrompt, selectInnovationAgent,
  validateInnovationProposal,
  type TechnologyEvidence,
} from '../server/selfEvolution/innovationAgentCatalog.js';

const evidence: TechnologyEvidence[] = [{
  repository: 'nodejs/node', title: 'Node update',
  url: 'https://github.com/nodejs/node/releases/tag/v22.0.0',
  publishedAt: '2026-10-01T12:00:00Z', description: 'Release',
}];

const valid = {
  title: 'Melhorar a confiabilidade das tarefas assincronas',
  summary: 'Uma mudanca pequena que trata falhas transitorias sem alterar os contratos existentes.',
  hypothesis: 'A repeticao de falhas transitorias provoca perdas que podem ser medidas.',
  expectedBehavior: 'A mesma tarefa termina sem duplicacao e com comportamento monitoravel.',
  testPlan: 'Reproduzir perda anterior em teste de concorrencia e medir antes e depois.',
  probableFiles: ['server/ai/durableExecutionService.ts'],
  sourceUrls: [evidence[0].url],
  measurableGain: 'Reduzir falhas reproduzidas sem aumentar latencia p95.',
};

const architecture = INNOVATION_AGENTS.find(a => a.id === 'nextgen-architecture')!;

describe('10 agentes de inovacao somados aos 10 revisores', () => {
  it('mantem 20 papeis distintos, sem substituir os revisores', () => {
    expect(COMMITTEE_ROLES).toHaveLength(10);
    expect(INNOVATION_AGENTS).toHaveLength(10);
    expect(new Set(INNOVATION_AGENTS.map(a => a.id)).size).toBe(10);
    expect(new Set(INNOVATION_AGENTS.map(a => a.name)).size).toBe(10);
    expect(INNOVATION_AGENTS.every(a => a.sources.length === 2 && a.targetFiles.length === 2)).toBe(true);
  });

  it('faz rodizio completo de 10 agentes em 10 dias', () => {
    const firstDay = Date.UTC(2026, 9, 22);
    const ids = Array.from({length: 10}, (_, day) =>
      selectInnovationAgent(new Date(firstDay + day * 86_400_000)).id);
    expect(new Set(ids).size).toBe(10);
  });

  it('aceita propostas com evidencia e arquivos permitidos', () => {
    const output = validateInnovationProposal(valid, architecture, evidence);
    expect(output?.sourceUrls).toEqual([evidence[0].url]);
    expect(output?.probableFiles).toEqual(['server/ai/durableExecutionService.ts']);
  });

  it('recusa links inventados e alteracoes fora do dominio', () => {
    expect(validateInnovationProposal({...valid, sourceUrls: ['https://example.com/']}, architecture, evidence)).toBeNull();
    expect(validateInnovationProposal({...valid, probableFiles: ['.github/workflows/ci.yml']}, architecture, evidence)).toBeNull();
  });

  it('recusa ideias vagas sem criterios mensuraveis', () => {
    expect(validateInnovationProposal({...valid, measurableGain: 'melhorar'}, architecture, evidence)).toBeNull();
    expect(validateInnovationProposal({noProposal: true}, architecture, evidence)).toBeNull();
  });

  it('define limite de escopo e impede criacao de referencias falsas', () => {
    const prompt = buildInnovationPrompt(architecture);
    expect(prompt).toContain('exclusivamente URLs presentes');
    expect(prompt).toContain('UMA melhoria pequena');
    expect(prompt).toContain('teste que FALHE');
  });
});
