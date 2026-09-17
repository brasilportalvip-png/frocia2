import { describe, expect, it } from 'vitest';
import { CAPABILITY_CATEGORIES, CapabilityEvaluationRun, ContinuousCapabilityEvaluationService } from '../server/ai/continuousCapabilityEvaluationService.js';

function run(version: string, sha: string, override: Partial<Record<(typeof CAPABILITY_CATEGORIES)[number], number>> = {}): CapabilityEvaluationRun {
  return {
    version, commitSha: sha, createdAt: new Date().toISOString(),
    scores: CAPABILITY_CATEGORIES.map((category) => {
      const passed = override[category] ?? 9;
      return { category, passed, total: 10, score: passed / 10, evidenceRefs: [`test:${category}`] };
    }),
  };
}

describe('ContinuousCapabilityEvaluationService', () => {
  it('aprova candidato sem regressão e com evidências em todas as capacidades', () => {
    const result = ContinuousCapabilityEvaluationService.compare(
      run('v1', 'a'.repeat(40), { code: 8 }), run('v2', 'b'.repeat(40), { code: 9 })
    );
    expect(result.passed).toBe(true);
    expect(result.delta).toBeGreaterThan(0);
  });

  it('bloqueia regressão mesmo quando a média geral aumenta', () => {
    const result = ContinuousCapabilityEvaluationService.compare(
      run('v1', 'a'.repeat(40)),
      run('v2', 'b'.repeat(40), { security: 8, conversation: 10, research: 10 })
    );
    expect(result.passed).toBe(false);
    expect(result.regressions).toContainEqual({ category: 'security', delta: expect.closeTo(-0.1) });
  });

  it('rejeita pontuação sem referência de evidência', () => {
    const candidate = run('v2', 'b'.repeat(40));
    candidate.scores[0].evidenceRefs = [];
    expect(() => ContinuousCapabilityEvaluationService.compare(run('v1', 'a'.repeat(40)), candidate)).toThrow('evidence');
  });
});
