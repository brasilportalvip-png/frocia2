import { describe, expect, it } from 'vitest';
import {
  createCapabilityRunFromGitHubChecks,
} from '../server/ai/githubCapabilityEvaluationService.js';
import { CAPABILITY_CATEGORIES } from '../server/ai/continuousCapabilityEvaluationService.js';

const baselineSha = 'a'.repeat(40);
const candidateSha = 'b'.repeat(40);
function actualShapedChecks(sha: string) {
  return CAPABILITY_CATEGORIES.map((category, index) => ({
    id: index + 11,
    name: `Capability: ${category}`,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    app: { slug: 'github-actions' },
  }));
}

describe('GitHub capability CI evidence', () => {
  it('constrói uma medição apenas com nove checks reais completos e confiáveis', () => {
    const run = createCapabilityRunFromGitHubChecks(candidateSha, actualShapedChecks(candidateSha));
    expect(run?.scores).toHaveLength(CAPABILITY_CATEGORIES.length);
    expect(run?.scores.every((score) => score.passed === 1 && score.evidenceRefs.length === 1)).toBe(true);
  });

  it('bloqueia checks de outra aplicação, outro commit, pendentes e ausentes', () => {
    const foreignApp = actualShapedChecks(candidateSha);
    foreignApp[0].app.slug = 'external-application';
    expect(createCapabilityRunFromGitHubChecks(candidateSha, foreignApp)).toBeNull();
    const stale = actualShapedChecks(baselineSha);
    expect(createCapabilityRunFromGitHubChecks(candidateSha, stale)).toBeNull();
    const incomplete = actualShapedChecks(candidateSha);
    incomplete.pop();
    expect(createCapabilityRunFromGitHubChecks(candidateSha, incomplete)).toBeNull();
    const pending = actualShapedChecks(candidateSha);
    pending[0].status = 'in_progress';
    expect(createCapabilityRunFromGitHubChecks(candidateSha, pending)).toBeNull();
  });

  it('reconhece falha de suíte sem inventar aprovação', () => {
    const checks = actualShapedChecks(candidateSha);
    checks[0].conclusion = 'failure';
    const run = createCapabilityRunFromGitHubChecks(candidateSha, checks);
    expect(run?.scores[0]).toMatchObject({ passed: 0, total: 1, score: 0 });
  });
});
