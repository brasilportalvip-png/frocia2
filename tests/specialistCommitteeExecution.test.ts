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

  it('bloqueia identidades repetidas entre especialistas', () => {
    for (const role of COMMITTEE_ROLES) process.env[`SPECIALIST_${role.toUpperCase()}_ACTOR_UID`] = 'same-actor';
    expect(() => SpecialistCommitteeExecutionService.configuredActors()).toThrow('not_unique');
  });
});
