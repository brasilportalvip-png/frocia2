import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ docs: new Map<string, any>() }));
vi.mock('../server/lib/firebaseAdmin.js', () => {
  const ref = (key: string): any => ({
    get: async () => ({ exists: state.docs.has(key), data: () => state.docs.get(key) }),
    set: async (value: any) => state.docs.set(key, value),
    update: async (value: any) => state.docs.set(key, { ...state.docs.get(key), ...value }),
  });
  const query = (collection: string, filters: any[] = [], after = '', count = 100): any => ({
    doc: (id: string) => ref(collection + '/' + id),
    where: (...filter: any[]) => query(collection, [...filters, filter], after, count),
    orderBy: () => query(collection, filters, after, count),
    startAfter: (id: string) => query(collection, filters, id, count),
    limit: (limit: number) => query(collection, filters, after, limit),
    get: async () => ({ docs: [...state.docs.entries()].filter(([key, value]) => key.startsWith(collection + '/') && key.split('/')[1] > after &&
      filters.every(([field, , expected]) => value[field] === expected)).sort(([a], [b]) => a.localeCompare(b)).slice(0, count)
      .map(([key, value]) => ({ id: key.split('/')[1], data: () => value, ref: ref(key) })) }),
  });
  return { adminDb: { collection: (name: string) => query(name) }, isFirebaseAdminConfigured: () => false,
    getMediaStorageBucket: vi.fn(), getServiceAccountCredentials: () => null };
});
import { monitorProfessionalProjects } from '../server/siteFactory/professionalMonitoringService.js';
import { ProfessionalMaintenanceService } from '../server/siteFactory/professionalMaintenanceService.js';
import { sourceDigest } from '../server/siteFactory/professionalContract.js';
const digest = sourceDigest([{ path: 'index.html', content: 'test' }]);
function add(id: string, overrides = {}) {
  const b: any = { id, userId: 'owner', tenantId: 'tenant', projectId: 'project-' + id, status: 'ready',
    publication: { productionUrl: 'https://test.vercel.app' }, bundle: { files: [{ path: 'index.html', content: 'test' }], integrations: [] }, ...overrides };
  state.docs.set('site_factory_builds/' + id, b);
  state.docs.set('projects/' + b.projectId, { userId: b.userId, tenantId: b.tenantId, professionalBuildId: id });
  return b;
}
beforeEach(() => {
  vi.restoreAllMocks(); state.docs.clear();
  vi.spyOn(ProfessionalMaintenanceService.prototype, 'reconcile').mockResolvedValue(undefined);
  vi.spyOn(ProfessionalMaintenanceService.prototype, 'react').mockResolvedValue({ status: 'observing' });
});
describe('monitoramento rotativo dos projetos publicados', () => {
  it('não deixa projetos depois da primeira página sem monitoramento', async () => {
    for (let i = 0; i < 27; i++) add(i.toString(16).padStart(64, '0'));
    const request = vi.fn(async () => Response.json({ releaseDigest: digest }));
    await monitorProfessionalProjects(request as any);
    expect(request).toHaveBeenCalledTimes(25);
    await monitorProfessionalProjects(request as any);
    expect(request).toHaveBeenCalledTimes(27);
    await monitorProfessionalProjects(request as any);
    expect(request).toHaveBeenCalledTimes(52);
  });
  it('não chama integração saudável quando a resposta não contém evidência', async () => {
    const b = add('a'.repeat(64), { bundle: { files: [{ path: 'index.html', content: 'test' }], integrations: [{ name: 'Payments', healthPath: '/api/payment-health' }] } });
    const request = vi.fn(async (url: string) => Response.json(url.endsWith('froc-release.json')
      ? { releaseDigest: digest } : { ok: true, environment: 'production', checks: [] }));
    await monitorProfessionalProjects(request as any);
    const monitoring = state.docs.get('site_factory_builds/' + b.id).monitoring;
    expect(monitoring.status).toBe('degraded');
    expect(monitoring.consecutiveFailures).toBe(1);
    expect(ProfessionalMaintenanceService.prototype.react).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ consecutiveFailures: 1 }));
  });
  it('confirma falha em outra verificação e resolve o alerta após recuperação', async () => {
    const b = add('b'.repeat(64), { monitoring: { status: 'degraded', failures: ['Falha'], consecutiveFailures: 1,
      checkedAt: new Date(Date.now() - 600000).toISOString() } });
    await monitorProfessionalProjects(vi.fn(async () => new Response('', { status: 500 })) as any);
    expect(state.docs.get('site_factory_builds/' + b.id).monitoring.consecutiveFailures).toBe(2);
    await monitorProfessionalProjects(vi.fn(async () => Response.json({ releaseDigest: digest })) as any);
    expect(state.docs.get('site_factory_builds/' + b.id).monitoring.status).toBe('healthy');
    expect(state.docs.get('site_factory_alerts/' + b.id).resolved).toBe(true);
  });
});
