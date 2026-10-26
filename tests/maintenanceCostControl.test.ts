import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryFirestoreFixture } from './helpers/memoryFirestoreFixture.js';
const database = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createMemoryFirestoreFixture>, configured: true }));
vi.mock('../server/lib/firebaseAdmin.js', async () => {
  const { createMemoryFirestoreFixture } = await import('./helpers/memoryFirestoreFixture.js');
  database.store = createMemoryFirestoreFixture();
  return { adminDb: database.store.adminDb, isFirebaseAdminConfigured: () => database.configured,
    hasFullServiceAccountCredentials: () => false };
});
import { SelfSiteOwnerService } from '../server/selfEvolution/selfSiteOwnerService.js';
import { SelfEvolutionPolicyEngine } from '../server/selfEvolution/selfEvolutionPolicyEngine.js';
import { GithubAutomationService, type MaintenanceWorkflowControl } from '../server/selfEvolution/githubAutomationService.js';
import { LockService } from '../server/selfEvolution/lockService.js';
import { AuditService } from '../server/selfEvolution/auditService.js';
import { DefaultCodeAgentAdapter } from '../server/selfEvolution/codeAgentService.js';
import { GeminiSpecialistReviewAdapter } from '../server/selfEvolution/specialistCommitteeExecutionService.js';
import { WorkerHttpClient } from '../server/selfEvolution/workerHttpClient.js';
import { GeminiProvider } from '../server/ai/providers/geminiProvider.js';
import type { ImprovementCandidate } from '../server/selfEvolution/selfEvolutionTypes.js';

const receipt = (enabled: boolean, success = true): MaintenanceWorkflowControl => ({
  enabled, success, workflowState: success ? enabled ? 'active' : 'disabled_manually' : 'unknown',
  checkedAt: '2026-10-25T20:00:00Z', workflowUrl: 'https://github.com/brasilportalvip-png/frocia2/actions/workflows/self-evolution-runner.yml',
  cancellationRequested: [], cancellationIncomplete: false, message: success ? 'Controle confirmado.' : 'GitHub indisponível.',
});
const current = () => database.store.documents.get('self_evolution_config/system');

describe('Controle persistente de gastos da autoevolução', () => {
  beforeEach(() => {
    database.configured = true; database.store.reset(); SelfEvolutionPolicyEngine.setSystemEnabled(null);
    database.store.documents.set('self_evolution_config/system', { SELF_EVOLUTION_ENABLED: true, preserved: 'history' });
    vi.stubEnv('SELF_EVOLUTION_ENABLED', 'true');
    vi.spyOn(LockService, 'acquireLock').mockResolvedValue({} as any);
    vi.spyOn(LockService, 'releaseLock').mockResolvedValue(true);
    vi.spyOn(AuditService, 'logEvent').mockResolvedValue(undefined);
    vi.spyOn(GithubAutomationService, 'setMaintenanceWorkflowEnabled').mockImplementation(async enabled => receipt(enabled));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); SelfEvolutionPolicyEngine.setSystemEnabled(null); });

  it('salva a pausa antes de chamar GitHub e bloqueia gerador e comitê pagos', async () => {
    vi.mocked(GithubAutomationService.setMaintenanceWorkflowEnabled).mockImplementation(async enabled => {
      expect(current()?.SELF_EVOLUTION_ENABLED).toBe(false);
      return receipt(enabled);
    });
    expect(await SelfSiteOwnerService.setEnabled('owner', false, 'Pausa de gastos.')).toMatchObject({ status: 'paused', enabled: false });
    expect(current()).toMatchObject({ SELF_EVOLUTION_ENABLED: false, preserved: 'history', changedBy: 'owner' });
    const worker = vi.spyOn(WorkerHttpClient, 'postJson'); const provider = vi.spyOn(GeminiProvider, 'generate');
    vi.stubEnv('SELF_EVOLUTION_WORKER_URL', 'https://worker.example.com');
    vi.stubEnv('SELF_EVOLUTION_WORKER_TOKEN', 'test-token'); vi.stubEnv('SELF_EVOLUTION_WORKER_SIGNING_SECRET', 's'.repeat(40));
    const candidate = { id: 'paused-task' } as ImprovementCandidate;
    expect(await new DefaultCodeAgentAdapter().generatePatchAndTest(candidate)).toMatchObject({ success: false });
    await expect(new GeminiSpecialistReviewAdapter().review('qa', candidate)).rejects.toThrow('self_evolution_paused');
    expect(worker).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled();
  });
  it('só religa depois da confirmação do GitHub, sem iniciar um teste', async () => {
    await SelfSiteOwnerService.setEnabled('owner', false, 'Pausa.');
    expect(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted()).toBe(false);
    const dispatch = vi.spyOn(GithubAutomationService, 'dispatchSelfMaintenance');
    expect(await SelfSiteOwnerService.setEnabled('owner', true, 'Retomar diariamente.')).toMatchObject({ status: 'enabled', enabled: true });
    expect(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted()).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('uma instância que leu desligado reconhece a retomada salva por outra instância', async () => {
    database.store.documents.set('self_evolution_config/system', { SELF_EVOLUTION_ENABLED: false });
    expect(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted()).toBe(false);
    database.store.documents.set('self_evolution_config/system', { SELF_EVOLUTION_ENABLED: true });
    expect(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted()).toBe(true);
  });
  it('mantém desligado quando GitHub recusa religar', async () => {
    vi.mocked(GithubAutomationService.setMaintenanceWorkflowEnabled).mockResolvedValue(receipt(true, false));
    expect(await SelfSiteOwnerService.setEnabled('owner', true, 'Ligar.')).toMatchObject({ status: 'blocked', enabled: false });
    expect(current()?.SELF_EVOLUTION_ENABLED).toBe(false);
  });
  it('preserva a pausa e informa a sincronização incompleta se GitHub falhar ao desligar', async () => {
    vi.mocked(GithubAutomationService.setMaintenanceWorkflowEnabled).mockResolvedValue(receipt(false, false));
    expect(await SelfSiteOwnerService.setEnabled('owner', false, 'Pausa.')).toMatchObject({ status: 'paused', enabled: false,
      workflowControl: { success: false } });
    expect(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted()).toBe(false);
  });
  it('não considera o ambiente suficiente para gastar sem confirmar a configuração persistente', async () => {
    database.configured = false;
    expect(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted()).toBe(false);
    expect(await SelfSiteOwnerService.setEnabled('owner', true, 'Ligar.')).toMatchObject({ status: 'blocked' });
    expect(GithubAutomationService.setMaintenanceWorkflowEnabled).not.toHaveBeenCalled();
  });
  it('falha ao gravar mantém o bloqueio e não permite habilitar o workflow', async () => {
    const collection = vi.spyOn(database.store.adminDb, 'collection').mockReturnValue({ doc: () => ({ set: async () => { throw new Error('storage_unavailable'); } }) } as any);
    await expect(SelfSiteOwnerService.setEnabled('owner', true, 'Ligar.')).rejects.toThrow('storage_unavailable');
    expect(vi.mocked(GithubAutomationService.setMaintenanceWorkflowEnabled).mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    collection.mockRestore();
    expect(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted()).toBe(false);
  });
  it('serializa alterações entre painéis e não altera o estado se outro controle está em andamento', async () => {
    vi.mocked(LockService.acquireLock).mockResolvedValue(null);
    expect(await SelfSiteOwnerService.setEnabled('owner', false, 'Pausa.')).toMatchObject({ status: 'blocked' });
    expect(database.store.writes).toHaveLength(0);
    expect(GithubAutomationService.setMaintenanceWorkflowEnabled).not.toHaveBeenCalled();
  });
});
