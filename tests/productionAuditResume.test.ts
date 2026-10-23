import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const data = new Map<string, any>();
  const snapshot = (p: string) => ({ id: p.split('/').at(-1), exists: data.has(p), data: () => data.get(p) });
  const doc = (p: string): any => ({
    id: p.split('/').at(-1), path: p, get: async () => snapshot(p),
    set: async (value: any, options?: any) => data.set(p, options?.merge ? { ...data.get(p), ...value } : value),
    collection: (name: string) => collection(p + '/' + name),
  });
  const collection = (p: string): any => ({ doc: (id: string) => doc(p + '/' + id), get: async () => ({
    docs: [...data.keys()].filter(key => key.startsWith(p + '/') && !key.slice(p.length + 1).includes('/')).map(snapshot),
  }) });
  const db = { collection, runTransaction: async (fn: any) => fn({
    get: (ref: any) => ref.get(), create: (ref: any, value: any) => data.set(ref.path, value),
    set: (ref: any, value: any) => data.set(ref.path, value),
  }) };
  return { data, db, audit: vi.fn(), browser: vi.fn() };
});

vi.mock('../server/lib/firebaseAdmin.js', () => ({ adminDb: state.db, isFirebaseAdminConfigured: () => true }));
vi.mock('../server/services/siteAuditService.js', () => ({ SiteAuditService: { audit: state.audit } }));
vi.mock('../server/selfEvolution/autonomousBrowserValidationService.js', () => ({ AutonomousBrowserValidationService: { validate: state.browser } }));
vi.mock('../server/selfEvolution/lockService.js', () => ({ LockService: { acquireLock: async () => ({}), releaseLock: async () => true } }));
vi.mock('../server/selfEvolution/auditService.js', () => ({ AuditService: { logEvent: async () => ({}) } }));
vi.mock('../server/selfEvolution/selfEvolutionPolicyEngine.js', () => ({ SelfEvolutionPolicyEngine: {
  isSelfEvolutionEnabledPersisted: async () => true, classifyRisk: () => 'R1',
} }));

import { ProductionSiteAuditDiscoveryService } from '../server/selfEvolution/productionSiteAuditDiscoveryService.js';
import { REQUIRED_SELF_SITE_VIEWS } from '../worker/site-navigation-audit.mjs';

function html(pending: string[], issues = 0) {
  return { origin: 'https://froc.example.com', status: pending.length ? 'partial' : 'complete', auditId: 'fixture',
    startedAt: '2026-10-23T12:17:00.000Z', discovery: { robotsBlockedUrls: 0 },
    pages: [{ finalUrl: 'https://froc.example.com/', contentHash: 'a'.repeat(64), signals: { likelyClientRendered: true },
      issues: Array.from({ length: issues }, (_, i) => ({ code: `REAL_ISSUE_${i}`, severity: 'medium', category: 'content',
        url: 'https://froc.example.com/', message: 'Falha observada', evidence: `evidence ${i}` })) }],
    failures: [], siteWideIssues: [], limitations: [],
    checkpoint: { origin: 'https://froc.example.com', pendingUrls: pending, visitedUrls: ['https://froc.example.com/'],
      pendingSitemaps: [], processedSitemaps: [], loadedSitemaps: [] },
  };
}
function browser() {
  return { completedAt: '2026-10-23T12:18:00.000Z', scenarios: [], consoleErrors: [], failedRequests: [],
    navigation: REQUIRED_SELF_SITE_VIEWS.map(view => ({ view, status: 'passed', details: 'ok', traceSha256: 'b'.repeat(64) })),
    navigationCatalog: REQUIRED_SELF_SITE_VIEWS,
  };
}

describe('Varredura persistente e fila completa de defeitos', () => {
  beforeEach(() => {
    state.data.clear(); state.audit.mockReset(); state.browser.mockReset();
    state.browser.mockResolvedValue(browser());
    vi.stubEnv('SELF_EVOLUTION_TARGET_URL', 'https://froc.example.com/');
    vi.stubEnv('GITHUB_SHA', 'a'.repeat(40));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('encaminha todos os grupos de falhas, inclusive alem do quinto', async () => {
    state.audit.mockResolvedValue(html([], 9));
    const result = await ProductionSiteAuditDiscoveryService.discoverOne(new Date('2026-10-23T12:17:00Z'));
    const candidates = [...state.data.keys()].filter(key => key.startsWith('self_evolution_candidates/'));
    expect(candidates).toHaveLength(9);
    expect(result).toMatchObject({ status: 'created', findings: 9, coverageComplete: true, requiresResume: false });
  });

  it('retoma o checkpoint no dia seguinte e nao descarta achados nem duplica tarefas', async () => {
    state.audit.mockResolvedValueOnce(html(['https://froc.example.com/pendente'], 8)).mockResolvedValueOnce(html([]));
    const first = await ProductionSiteAuditDiscoveryService.discoverOne(new Date('2026-10-23T22:17:00Z'));
    expect(first.requiresResume).toBe(true);
    const second = await ProductionSiteAuditDiscoveryService.discoverOne(new Date('2026-10-24T12:17:00Z'));
    expect(state.audit.mock.calls[1][0].checkpoint.pendingUrls).toEqual(['https://froc.example.com/pendente']);
    expect(second).toMatchObject({ findings: 8, coverageComplete: true, requiresResume: false });
    expect([...state.data.keys()].filter(key => key.startsWith('self_evolution_candidates/'))).toHaveLength(8);
  });

  it('uma auditoria parcial nao e tratada como execucao diaria ja concluida', async () => {
    state.audit.mockResolvedValueOnce(html(['https://froc.example.com/pendente'])).mockResolvedValueOnce(html([]));
    await ProductionSiteAuditDiscoveryService.discoverOne(new Date('2026-10-23T12:17:00Z'));
    await ProductionSiteAuditDiscoveryService.discoverOne(new Date('2026-10-23T12:47:00Z'));
    expect(state.audit).toHaveBeenCalledTimes(2);
    expect(state.browser).toHaveBeenCalledTimes(2);
  });
});
