import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ configured: true, data: undefined as Record<string, any> | undefined,
  update: vi.fn(), set: vi.fn() }));
vi.mock('../server/lib/firebaseAdmin.js', () => ({
  isFirebaseAdminConfigured: () => fixture.configured, hasFullServiceAccountCredentials: () => false,
  adminDb: {
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
    runTransaction: async (fn: any) => fn({
      get: async () => ({ exists: Boolean(fixture.data), data: () => fixture.data }),
      update: fixture.update, set: fixture.set,
    }),
  },
}));
import { CandidateQueueService } from '../server/selfEvolution/candidateQueueService';
import { LockService } from '../server/selfEvolution/lockService';
import { AuditService } from '../server/selfEvolution/auditService';
import { SelfEvolutionOrchestrator } from '../server/selfEvolution/selfEvolutionOrchestrator';
import { ImprovementPlannerService } from '../server/selfEvolution/improvementPlannerService';
import { SelfEvolutionPolicyEngine } from '../server/selfEvolution/selfEvolutionPolicyEngine';
import { CodeAgentService } from '../server/selfEvolution/codeAgentService';

describe('Excluir uma tarefa da fila preservando a auditoria', () => {
  beforeEach(() => {
    fixture.configured = true; fixture.data = { state: 'failed', riskLevel: 'R2', evidence: ['trace-real'] };
    fixture.update.mockClear(); fixture.set.mockClear();
    vi.spyOn(LockService, 'acquireLock').mockResolvedValue({} as any);
    vi.spyOn(LockService, 'releaseLock').mockResolvedValue(true);
    vi.spyOn(AuditService, 'logEvent').mockResolvedValue({} as any);
  });
  afterEach(() => vi.restoreAllMocks());
  it('retira somente a tarefa pedida, registra autor e mantém o documento histórico', async () => {
    const result = await CandidateQueueService.remove('owner-task', 'verified-owner');
    expect(result).toEqual({ candidateId: 'owner-task', deleted: true, alreadyDeleted: false });
    expect(fixture.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      state: 'cancelled', deletedBy: 'verified-owner', deletedFromState: 'failed',
    }));
    expect(fixture.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      candidateId: 'owner-task', actorUid: 'verified-owner', previousState: 'failed',
    }));
    expect(fixture.data?.evidence).toEqual(['trace-real']);
    expect(LockService.releaseLock).toHaveBeenCalled();
  });
  it('recusa tarefa bloqueada por um executor sem alterar os dados', async () => {
    vi.mocked(LockService.acquireLock).mockResolvedValue(null);
    await expect(CandidateQueueService.remove('owner-task', 'owner')).rejects.toMatchObject({ status: 409 });
    expect(fixture.update).not.toHaveBeenCalled(); expect(fixture.set).not.toHaveBeenCalled();
  });
  it.each(['agent_running', 'approved_for_release', 'canary_deployed', 'monitoring'])('protege uma tarefa no estado %s mesmo sem lock válido', async state => {
    fixture.data!.state = state;
    await expect(CandidateQueueService.remove('owner-task', 'owner')).rejects.toMatchObject({ status: 409 });
    expect(fixture.update).not.toHaveBeenCalled(); expect(LockService.releaseLock).toHaveBeenCalled();
  });
  it('torna a repetição idempotente e não substitui a identidade de quem excluiu', async () => {
    fixture.data = { state: 'cancelled', deletedAt: '2026-10-25T18:00:00Z', deletedBy: 'first-owner' };
    expect(await CandidateQueueService.remove('owner-task', 'second-owner')).toMatchObject({ alreadyDeleted: true });
    expect(fixture.update).not.toHaveBeenCalled(); expect(AuditService.logEvent).not.toHaveBeenCalled();
  });
  it('não simula persistência quando o Firestore está indisponível', async () => {
    fixture.configured = false;
    await expect(CandidateQueueService.remove('owner-task', 'owner')).rejects.toMatchObject({ status: 503 });
    expect(fixture.update).not.toHaveBeenCalled();
  });
  it('retorna tarefa inexistente sem criar outro registro', async () => {
    fixture.data = undefined;
    await expect(CandidateQueueService.remove('owner-task', 'owner')).rejects.toMatchObject({ status: 404 });
    expect(fixture.update).not.toHaveBeenCalled();
  });
  it('mantém o evento transacional quando a cópia para a auditoria global fica indisponível', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(AuditService.logEvent).mockRejectedValue(new Error('audit unavailable'));
    expect(await CandidateQueueService.remove('owner-task', 'owner')).toMatchObject({ deleted: true });
    expect(fixture.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'removed_from_queue' }));
    expect(LockService.releaseLock).toHaveBeenCalled();
  });
  it('o executor rele a tarefa depois do lock e respeita uma exclusão concorrente', async () => {
    vi.spyOn(SelfEvolutionPolicyEngine, 'isSelfEvolutionEnabledPersisted').mockResolvedValue(true);
    vi.spyOn(ImprovementPlannerService, 'getCandidateById')
      .mockResolvedValueOnce({ id: 'owner-task', state: 'detected' } as any)
      .mockResolvedValue({ id: 'owner-task', state: 'cancelled', deletedAt: 'now' } as any);
    const generate = vi.spyOn(CodeAgentService, 'generatePatchAndTest');
    expect(await SelfEvolutionOrchestrator.processCandidateLifecycle('owner-task')).toMatchObject({ state: 'cancelled' });
    expect(generate).not.toHaveBeenCalled();
  });
});
