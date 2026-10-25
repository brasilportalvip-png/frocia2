import { describe, expect, it } from 'vitest';
import { ownerDispatchDecision } from '../server/selfEvolution/ownerDispatchPolicy.js';
import { formatSelfSiteControlReceipt } from '../server/ai/selfSiteChatControlService.js';
const now = Date.now();
describe('retomada por versão sem duplicação de pedidos', () => {
  it('retoma a mesma tarefa falha depois da publicação de uma versão nova', () => {
    expect(ownerDispatchDecision({ dispatchConfirmed: true, dispatchVersion: 'old', dispatchAttempts: 3 }, { state: 'tests_failed' }, 'new', now)).toMatchObject({ allowed: true, resumed: true });
  });
  it('conserva a trava ativa e o limite/cooldown da mesma versão', () => {
    expect(ownerDispatchDecision({ dispatchLeaseUntil: now + 1000 }, { state: 'tests_failed' }, 'new', now).allowed).toBe(false);
    expect(ownerDispatchDecision({ dispatchConfirmed: true, dispatchVersion: 'same', dispatchAttempts: 3 }, { state: 'tests_failed' }, 'same', now).allowed).toBe(false);
    expect(ownerDispatchDecision({ dispatchConfirmed: true, dispatchVersion: 'same', lastDispatchedAt: new Date(now).toISOString() }, { state: 'tests_failed' }, 'same', now).allowed).toBe(false);
  });
  it('não duplica trabalho ativo ou tarefa já publicada', () => {
    for (const state of ['agent_running', 'ci_pending', 'accepted', 'no_change'])
      expect(ownerDispatchDecision({ dispatchConfirmed: true }, { state }, 'new', now).allowed).toBe(false);
  });
  it('não associa erro de outro disparo ao pedido atual', () => {
    const text = formatSelfSiteControlReceipt({ action: { status: 'requested', candidateId: 'owner-current', dispatchId: 'current' },
      operations: { requestedCandidateId: 'owner-current', taskOutcome: { candidateId: 'owner-current', dispatchId: 'old', state: 'tests_failed', message: 'OLD_PRIVATE_ERROR' }, lastRunner: { state: 'failed', message: 'OTHER_TASK_ERROR' } } });
    expect(text).toContain('não confirma o resultado do disparo atual');
    expect(text).not.toContain('OLD_PRIVATE_ERROR'); expect(text).not.toContain('OTHER_TASK_ERROR');
  });
});
