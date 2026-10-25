import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommitteeGateService } from '../server/selfEvolution/committeeGateService';
import { COMMITTEE_ROLES, type CommitteeReview } from '../server/selfEvolution/selfEvolutionTypes';
const sha = 'a'.repeat(40);
function reviews(): CommitteeReview[] {
  return COMMITTEE_ROLES.map(role => ({ id: role, candidateId: 'review-test', role, actorUid: 'actor-' + role,
    commitSha: sha, verdict: 'approved', summary: 'Inspeção verificada com evidência concreta.',
    fileRefs: ['src/fix.ts'], testRefs: ['tests/fix.test.ts'], evidenceRefs: ['ci:passed'], risks: [], createdAt: '', updatedAt: '' }));
}
function gate(rows: CommitteeReview[], riskLevel: 'R0' | 'R1' | 'R2' | 'R3' = 'R1') {
  return CommitteeGateService.evaluateReviews({ candidateId: 'review-test', commitSha: sha, riskLevel, reviews: rows });
}
afterEach(() => vi.unstubAllEnvs());
describe('Revisão proporcional ao risco', () => {
  it('aceita baixo risco após Segurança, QA e Verificação Independente sem exigir dez opiniões', () => {
    expect(gate(reviews().filter(r => ['security', 'qa', 'independent_verifier'].includes(r.role))).approved).toBe(true);
  });
  it('registra sugestão consultiva sem paralisar uma correção de baixo risco', () => {
    const rows = reviews(); rows.find(r => r.role === 'ux_ui')!.verdict = 'changes_required';
    expect(gate(rows)).toMatchObject({ approved: true, advisoryRoles: ['ux_ui'] });
  });
  it.each(['security', 'qa', 'independent_verifier'])('uma solicitação de correção de %s exige código e testes novos', role => {
    const rows = reviews(); rows.find(r => r.role === role)!.verdict = 'changes_required';
    expect(gate(rows)).toMatchObject({ approved: false, conflictingRoles: [role] });
    expect(gate(rows).reason).toContain(role);
  });
  it('um veto explícito continua bloqueando mesmo vindo de um papel consultivo', () => {
    const rows = reviews(); rows.find(r => r.role === 'product')!.verdict = 'blocked';
    expect(gate(rows)).toMatchObject({ approved: false, conflictingRoles: ['product'] });
  });
  it('não aceita falta de prova, SHA diferente ou identidade duplicada dos verificadores', () => {
    const rows = reviews(); rows.find(r => r.role === 'security')!.evidenceRefs = [];
    expect(gate(rows).invalidRoles).toContain('security');
    rows.find(r => r.role === 'security')!.evidenceRefs = ['ci'];
    rows.find(r => r.role === 'qa')!.commitSha = 'b'.repeat(40);
    expect(gate(rows).staleRoles).toContain('qa');
    rows.find(r => r.role === 'qa')!.commitSha = sha;
    rows.find(r => r.role === 'qa')!.actorUid = 'actor-backend';
    expect(gate(rows).approved).toBe(false);
  });
  it.each(['R2', 'R3'] as const)('preserva a revisão completa para %s', risk => {
    vi.stubEnv('SELF_EVOLUTION_ENABLED', 'true'); vi.stubEnv('AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED', 'true');
    const rows = reviews(); rows.find(r => r.role === 'product')!.verdict = 'changes_required';
    expect(gate(rows, risk).approved).toBe(false);
    expect(gate(rows.filter(r => r.role !== 'data'), risk).missingRoles).toContain('data');
  });
});
