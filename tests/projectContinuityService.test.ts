import { describe, expect, it } from 'vitest';
import { activeProjectContinuity, ProjectContinuityEntry } from '../server/ai/projectContinuityService.js';

function entry(overrides: Partial<ProjectContinuityEntry>): ProjectContinuityEntry {
  return {
    id: 'id-1', userId: 'u1', tenantId: 't1', projectId: 'p1', kind: 'decision',
    title: 'Stack', content: 'React', sourceRefs: ['msg:1'], confidence: 1,
    validFrom: '2026-01-01T00:00:00.000Z', validUntil: null, version: 1,
    supersedesId: null, status: 'active', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

describe('project continuity ledger', () => {
  it('preserva a decisão nova e remove a decisão substituída', () => {
    const active = activeProjectContinuity([
      entry({ id: 'old', version: 1, content: 'JavaScript' }),
      entry({ id: 'new', version: 2, content: 'TypeScript', supersedesId: 'old' }),
    ]);
    expect(active.map((item) => item.id)).toEqual(['new']);
  });

  it('remove fatos expirados e mantém pendências válidas em ordem de versão', () => {
    const active = activeProjectContinuity([
      entry({ id: 'expired', version: 3, validUntil: '2025-01-01T00:00:00.000Z' }),
      entry({ id: 'pending', version: 2, kind: 'pending_action', validUntil: '2027-01-01T00:00:00.000Z' }),
      entry({ id: 'constraint', version: 4, kind: 'constraint' }),
    ], new Date('2026-09-17T00:00:00.000Z'));
    expect(active.map((item) => item.id)).toEqual(['constraint', 'pending']);
  });
});
