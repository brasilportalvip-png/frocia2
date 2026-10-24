import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createMemoryFirestoreFixture } from './helpers/memoryFirestoreFixture.js';
import { ProfessionalMaintenanceService } from '../server/siteFactory/professionalMaintenanceService.js';
const scope = { userId: 'owner', tenantId: 'tenant', projectId: 'project' };
const source: any = { ...scope, id: 'source-build', status: 'ready', consumedCredits: 45 };
const failing = { status: 'degraded', consecutiveFailures: 2, failures: ['A integração de teste não respondeu.'] };
function setup() {
  const data = createMemoryFirestoreFixture();
  data.documents.set('projects/project', { ...scope, professionalBuildId: source.id });
  const change = vi.fn(async (_id, current, _instructions, key) => {
    const id = createHash('sha256').update(JSON.stringify([current.tenantId, current.userId, current.projectId, key])).digest('hex');
    const b = { ...scope, id, status: 'queued', consumedCredits: 0 };
    data.documents.set('site_factory_builds/' + id, b);
    return b;
  });
  const factory = { get: vi.fn(async () => source), change };
  const service = new ProfessionalMaintenanceService(data.adminDb as any, (() => factory) as any);
  return { ...data, service, factory };
}
describe('manutenção autorizada dos projetos entregues', () => {
  it('não inicia correção ou cobrança sem ativação do dono do projeto', async () => {
    const s = setup();
    expect((await s.service.get(scope)).enabled).toBe(false);
    await s.service.react(source, failing);
    expect(s.factory.change).not.toHaveBeenCalled();
  });
  it('bloqueia outra conta e atualização concorrente da configuração', async () => {
    const s = setup();
    await expect(s.service.configure({ ...scope, userId: 'intruder' }, { revision: 0, enabled: true, dailyCreditLimit: 95 })).rejects.toThrow('Projeto não encontrado');
    await s.service.configure(scope, { revision: 0, enabled: true, dailyCreditLimit: 95 });
    await expect(s.service.configure(scope, { revision: 0, enabled: false, dailyCreditLimit: 95 })).rejects.toThrow('configuração mudou');
    await expect(s.service.configure(scope, { revision: 1, enabled: true, dailyCreditLimit: 1 })).rejects.toThrow();
  });
  it('aguarda confirmação, cria uma tarefa idempotente e reutiliza a mídia', async () => {
    const s = setup();
    await s.service.configure(scope, { revision: 0, enabled: true, dailyCreditLimit: 95 });
    await s.service.react(source, { ...failing, consecutiveFailures: 1 });
    expect(s.factory.change).not.toHaveBeenCalled();
    const queued = await s.service.react(source, failing);
    expect(queued.status).toBe('queued');
    await s.service.react(source, failing);
    expect(s.factory.change).toHaveBeenCalledTimes(1);
    expect(s.factory.change).toHaveBeenCalledWith(source.id, scope, expect.stringContaining('certificação'), expect.stringMatching(/^maintenance:/), { maintenance: true });
    expect((await s.service.get(scope)).activeBuildId).toBe(queued.buildId);
  });
  it('não repara uma versão substituída por outro trabalho do usuário', async () => {
    const s = setup();
    await s.service.configure(scope, { revision: 0, enabled: true, dailyCreditLimit: 95 });
    s.documents.set('projects/project', { ...scope, professionalBuildId: 'another-build' });
    await s.service.react(source, failing);
    expect(s.factory.change).not.toHaveBeenCalled();
  });
  it('recupera interrupção da fila, contabiliza só a rodada finalizada e respeita o limite', async () => {
    const s = setup();
    await s.service.configure(scope, { revision: 0, enabled: true, dailyCreditLimit: 95 });
    s.factory.change.mockRejectedValueOnce(new Error('interruption'));
    await expect(s.service.react(source, failing)).rejects.toThrow('interruption');
    const pending = await s.service.get(scope);
    expect(pending.activeBuildId).toBeTruthy();
    await s.service.reconcile();
    const record = s.documents.get('site_factory_builds/' + pending.activeBuildId)!;
    record.status = 'ready'; record.consumedCredits = 45;
    await s.service.reconcile();
    await s.service.reconcile();
    expect((await s.service.get(scope)).usedCredits).toBe(45);
    const next = { ...source, id: 'second-source' };
    s.documents.set('projects/project', { ...scope, professionalBuildId: next.id });
    await s.service.react(next, failing);
    expect(s.factory.change).toHaveBeenCalledTimes(2);
  });
  it('desativar impede uma tarefa ainda não iniciada mas não apaga custos anteriores', async () => {
    const s = setup();
    await s.service.configure(scope, { revision: 0, enabled: true, dailyCreditLimit: 95 });
    s.factory.change.mockRejectedValueOnce(new Error('interruption'));
    await expect(s.service.react(source, failing)).rejects.toThrow();
    await s.service.configure(scope, { revision: 1, enabled: false, dailyCreditLimit: 95 });
    await s.service.reconcile();
    expect(s.factory.change).toHaveBeenCalledTimes(1);
    expect((await s.service.get(scope)).activeBuildId).toBeNull();
  });
});
