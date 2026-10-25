import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommitteeGateService } from '../server/selfEvolution/committeeGateService.js';
import { SpecialistCommitteeExecutionService } from '../server/selfEvolution/specialistCommitteeExecutionService.js';
import { COMMITTEE_ROLES, ImprovementCandidate } from '../server/selfEvolution/selfEvolutionTypes.js';

const candidate = {
  id: 'candidate-committee', title: 'Mudança', summary: 'Mudança testada', evidence: ['trace:1'],
  frequency: 1, affectedUsersCount: 1, severity: 'medium', confidence: 1,
  affectedComponents: ['api'], probableFiles: ['server/api.ts'], hypothesis: 'bug',
  expectedBehavior: 'ok', riskLevel: 'R1', estimatedCostCredits: 1,
  testPlan: 'npm test', rollbackStrategy: 'revert', duplicates: [], requiresApproval: false,
  state: 'pull_request_opened', headCommitSha: 'a'.repeat(40),
  createdAt: '', updatedAt: '',
} satisfies ImprovementCandidate;

describe('SpecialistCommitteeExecutionService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const role of COMMITTEE_ROLES) delete process.env[`SPECIALIST_${role.toUpperCase()}_ACTOR_UID`];
  });

  it('executa papéis separados e persiste pareceres no mesmo commit', async () => {
    for (const [index, role] of COMMITTEE_ROLES.entries()) {
      process.env[`SPECIALIST_${role.toUpperCase()}_ACTOR_UID`] = `actor-${index}`;
    }
    SpecialistCommitteeExecutionService.setAdapter({
      review: async (role) => ({
        verdict: 'approved', summary: `Parecer concreto do papel ${role}.`,
        fileRefs: ['server/api.ts'], testRefs: ['tests/api.test.ts'],
        evidenceRefs: ['trace:1'], risks: ['risco residual registrado'],
      }),
    });
    const submit = vi.spyOn(CommitteeGateService, 'submitReview').mockImplementation(async (input) => ({
      id: `review-${input.role}`, ...input, createdAt: '', updatedAt: '',
    }));
    const reviews = await SpecialistCommitteeExecutionService.execute(candidate);
    expect(reviews).toHaveLength(COMMITTEE_ROLES.length);
    expect(new Set(reviews.map((review) => review.actorUid)).size).toBe(COMMITTEE_ROLES.length);
    expect(submit).toHaveBeenCalledTimes(COMMITTEE_ROLES.length);
  });

   it('usa identidades internas únicas quando variáveis externas não estão configuradas', () => {
    const actors =
      SpecialistCommitteeExecutionService
        .configuredActors();

    expect(
      Object.keys(actors)
    ).toHaveLength(
      COMMITTEE_ROLES.length
    );

    expect(
      new Set(
        Object.values(actors)
      ).size
    ).toBe(
      COMMITTEE_ROLES.length
    );

    for (
      const role of
      COMMITTEE_ROLES
    ) {
      expect(
        actors[role]
      ).toBe(
        `froc-specialist-${role}`
      );
    }
  });

  it('bloqueia identidades repetidas entre especialistas', () => {
    for (
      const role of
      COMMITTEE_ROLES
    ) {
      process.env[
        `SPECIALIST_${role.toUpperCase()}_ACTOR_UID`
      ] = 'same-actor';
    }

    expect(
      () =>
        SpecialistCommitteeExecutionService
          .configuredActors()
    ).toThrow('not_unique');
  });
  it('uma falha consultiva não impede baixo risco, sem inventar parecer aprovado', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    SpecialistCommitteeExecutionService.setAdapter({ review: async role => {
      if (role === 'product') throw new Error('provider unavailable');
      return { verdict: 'approved', summary: 'Análise de código com evidência concreta.', fileRefs: ['src/fix.ts'],
        testRefs: [], evidenceRefs: ['trace:real'], risks: [] };
    } });
    vi.spyOn(CommitteeGateService, 'submitReview').mockImplementation(async input => ({ id: input.role, ...input, createdAt: '', updatedAt: '' }));
    const reviews = await SpecialistCommitteeExecutionService.execute(candidate);
    expect(reviews.some(review => review.role === 'product')).toBe(false);
    expect(CommitteeGateService.evaluateReviews({ candidateId: candidate.id, commitSha: candidate.headCommitSha, riskLevel: 'R1', reviews }).approved).toBe(true);
  });
  it('a falta de um verificador obrigatório impede prosseguir', async () => {
    SpecialistCommitteeExecutionService.setAdapter({ review: async role => {
      if (role === 'security') throw new Error('provider unavailable');
      return { verdict: 'approved', summary: 'Análise de código com evidência concreta.', fileRefs: ['src/fix.ts'],
        testRefs: [], evidenceRefs: ['trace:real'], risks: [] };
    } });
    vi.spyOn(CommitteeGateService, 'submitReview').mockImplementation(async input => ({ id: input.role, ...input, createdAt: '', updatedAt: '' }));
    await expect(SpecialistCommitteeExecutionService.execute(candidate)).rejects.toThrow('specialist_required_review_unavailable:security');
  });
  it('não entrega ao comitê evidência de outro commit, preview ou CI contraditório', async () => {
    const review = vi.fn();
    SpecialistCommitteeExecutionService.setAdapter({ review });
    const validated = { commitSha: candidate.headCommitSha, ci: { status: 'success', passed: true, details: 'CI oficial.' },
      browser: { commitSha: candidate.headCommitSha, previewUrl: 'https://preview.example.com/', passed: true, completedAt: '', scenarios: [] },
      capabilityComparisonPassed: true };
    const current = { ...candidate, previewUrl: 'https://preview.example.com/' };
    for (const validation of [
      { ...validated, commitSha: 'b'.repeat(40) },
      { ...validated, browser: { ...validated.browser, previewUrl: 'https://wrong.example.com/' } },
      { ...validated, ci: { ...validated.ci, status: 'failed' } },
    ]) await expect(SpecialistCommitteeExecutionService.execute(current, validation)).rejects.toThrow('specialist_validation_evidence_mismatch');
    expect(review).not.toHaveBeenCalled();
  });
  it('aceita a URL canônica do mesmo preview sem confundir a barra final com outro destino', async () => {
    SpecialistCommitteeExecutionService.setAdapter({ review: async () => ({ verdict: 'approved',
      summary: 'Análise com evidência concreta do commit.', fileRefs: ['src/fix.ts'], testRefs: [], evidenceRefs: ['trace:real'], risks: [] }) });
    vi.spyOn(CommitteeGateService, 'submitReview').mockImplementation(async input => ({ id: input.role, ...input, createdAt: '', updatedAt: '' }));
    expect(await SpecialistCommitteeExecutionService.execute({ ...candidate, previewUrl: 'https://preview.example.com' }, {
      commitSha: candidate.headCommitSha, ci: { status: 'success', passed: true, details: 'CI aprovado.' },
      browser: { commitSha: candidate.headCommitSha, previewUrl: 'https://preview.example.com/', passed: true, completedAt: '', scenarios: [] },
      capabilityComparisonPassed: true,
    })).toHaveLength(10);
  });
});
