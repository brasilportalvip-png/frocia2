import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('comitê operacional e simulação segura', () => {
  const routes = readFileSync(new URL('../server/routes/selfEvolutionRoutes.ts', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../src/components/self-evolution/SelfEvolutionDashboard.tsx', import.meta.url), 'utf8');

  it('oferece simulação sem IA, créditos, PR ou deploy e prova o bloqueio sem verificador', () => {
    expect(routes).toContain("'/committee/simulation'");
    expect(routes).toContain("reviews.filter((review) => review.role !== 'independent_verifier')");
    expect(routes).toContain('sideEffects: { credits: 0, aiCalls: 0, pullRequests: 0, deployments: 0 }');
  });

  it('expõe os dez pareceres, referências, riscos, commit e decisão no painel', () => {
    expect(dashboard).toContain('Comitê de Agentes');
    expect(dashboard).toContain('Independent Verifier');
    expect(dashboard).toContain('review.fileRefs');
    expect(dashboard).toContain('review.testRefs');
    expect(dashboard).toContain('review.evidenceRefs');
    expect(dashboard).toContain('review.risks');
    expect(dashboard).toContain('committee.commitSha');
  });
});
