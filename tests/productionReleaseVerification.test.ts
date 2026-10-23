import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionReleaseVerificationService } from '../server/selfEvolution/productionReleaseVerificationService.js';
import { AutonomousBrowserValidationService } from '../server/selfEvolution/autonomousBrowserValidationService.js';

const sha = 'a'.repeat(40);
function deployment(overrides = {}) {
  return { id: 'dpl_site', projectId: 'prj_site', readyState: 'READY', target: 'production', gitSource: { sha }, ...overrides };
}
const alias = { alias: 'froc.example.com', projectId: 'prj_site', deploymentId: 'dpl_site' };
const responseFor = (url: string | URL, deployed = deployment()) => String(url).includes('/aliases/') ? Response.json(alias)
  : String(url).includes('api.vercel.com') ? Response.json(deployed) : new Response('ok');
describe('Publicacao automatica comprovada de ponta a ponta', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_TOKEN', 'test-token');
    vi.stubEnv('VERCEL_PROJECT_ID', 'prj_site');
    vi.stubEnv('SELF_EVOLUTION_TARGET_URL', 'https://froc.example.com/');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('nao confunde outro commit publicado com o merge esperado', async () => {
    const f = vi.fn(async (url: string | URL) => responseFor(url, deployment({ gitSource: { sha: 'b'.repeat(40) } })));
    vi.stubGlobal('fetch', f);
    expect((await ProductionReleaseVerificationService.verify('candidate', sha)).status).toBe('pending');
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('bloqueia projeto diferente ou ambiente de preview', async () => {
    for (const bad of [{ projectId: 'other' }, { target: 'preview' }]) {
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => responseFor(url, deployment(bad))));
      expect((await ProductionReleaseVerificationService.verify('candidate', sha)).status).toBe('blocked');
    }
  });
  it('aceita somente depois da versao exata, dos tres smoke tests e do navegador', async () => {
    const f = vi.fn(async (url: string | URL) => responseFor(url));
    vi.stubGlobal('fetch', f);
    const browser = vi.spyOn(AutonomousBrowserValidationService, 'validate').mockResolvedValue({ passed: true, scenarios: [] } as any);
    expect(await ProductionReleaseVerificationService.verify('candidate', sha)).toMatchObject({ status: 'accepted', deploymentId: 'dpl_site' });
    expect(f).toHaveBeenCalledTimes(6);
    expect(browser).toHaveBeenCalledWith({ candidateId: 'candidate', commitSha: sha, previewUrl: 'https://froc.example.com/' });
  });
  it('identifica falha de saude da versao publicada', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => String(url).includes('api.vercel.com') ? responseFor(url) : new Response('failed', { status: 503 })));
    expect((await ProductionReleaseVerificationService.verify('candidate', sha)).status).toBe('failed');
  });
  it('nao chama falta de sessao de sucesso nem de regressao comprovada', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => responseFor(url)));
    vi.spyOn(AutonomousBrowserValidationService, 'validate').mockResolvedValue({ passed: false, scenarios: [{ status: 'external_blocker' }] } as any);
    expect((await ProductionReleaseVerificationService.verify('candidate', sha)).status).toBe('blocked');
  });
  it('registra a falta de credencial sem inventar uma publicacao', async () => {
    vi.stubEnv('VERCEL_TOKEN', '');
    expect((await ProductionReleaseVerificationService.verify('candidate', sha)).status).toBe('blocked');
  });
});
