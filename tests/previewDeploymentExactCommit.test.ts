import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewDeploymentService } from '../server/selfEvolution/previewDeploymentService.js';

const sha = 'a'.repeat(40);
const item = { uid: 'dpl_preview', state: 'READY', meta: { githubCommitSha: sha } };
describe('Preview do commit exato da correcao', () => {
  beforeEach(() => { vi.stubEnv('VERCEL_TOKEN', 'private'); vi.stubEnv('VERCEL_PROJECT_ID', 'prj_site'); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  function setup(details: Record<string, unknown> = {}) {
    const f = vi.fn(async (url: string | URL, _options?: RequestInit) => String(url).includes('/v6/deployments') ? Response.json({ deployments: [item] })
      : String(url).includes('/v13/deployments') ? Response.json({ id: item.uid, projectId: 'prj_site', target: null,
        readyState: 'READY', gitSource: { sha }, url: 'preview.vercel.app', ...details }) : new Response('ok'));
    vi.stubGlobal('fetch', f); return f;
  }
  it('aguarda o SHA exato e nao aceita um deployment antigo da mesma branch', async () => {
    const f = setup({ gitSource: { sha: 'b'.repeat(40) } });
    expect((await PreviewDeploymentService.createPreviewDeployment('candidate', 'froc-evolution/r1/fix', sha)).status).toBe('pending');
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('recusa outro projeto e ambiente de producao', async () => {
    for (const details of [{ projectId: 'other' }, { target: 'production' }]) {
      setup(details);
      expect((await PreviewDeploymentService.createPreviewDeployment('candidate', 'branch', sha)).status).toBe('failed');
    }
  });
  it('so retorna ready depois da versao conferida e do health real', async () => {
    const f = setup();
    expect(await PreviewDeploymentService.createPreviewDeployment('candidate', 'branch', sha)).toMatchObject({ status: 'ready', previewUrl: 'https://preview.vercel.app' });
    expect(f).toHaveBeenCalledTimes(3);
    expect(String(f.mock.calls[0][0])).toContain(`meta-githubCommitSha=${sha}`);
  });
  it.each([401, 403, 503, 500])('preserva HTTP %s e não aprova preview indisponível', async status => {
    const f = setup();
    const original = f.getMockImplementation()!;
    f.mockImplementation(async (url: string | URL) => String(url).endsWith('/api/health')
      ? Response.json({ firebaseConfigured: true, mercadoPagoConfigured: false, geminiConfigured: true, secret: 'never-return-body' }, { status })
      : original(url));
    const result = await PreviewDeploymentService.createPreviewDeployment('candidate', 'branch', sha);
    expect(result).toMatchObject({ status: 'failed', smokeTestsPassed: false, diagnostic: { phase: 'smoke', httpStatus: status } });
    expect(result.errorMessage).toContain(`HTTP ${status}`);
    expect(JSON.stringify(result)).not.toContain('never-return-body');
    if (status === 503) expect(result.diagnostic?.dependencies).toEqual({ firebaseConfigured: true, mercadoPagoConfigured: false, geminiConfigured: true });
  });
  it('distingue timeout de rejeição HTTP sem divulgar a exceção', async () => {
    const f = setup(); const original = f.getMockImplementation()!;
    f.mockImplementation(async (url: string | URL) => {
      if (String(url).endsWith('/api/health')) throw Object.assign(new Error('private-secret'), { name: 'TimeoutError' });
      return original(url);
    });
    const result = await PreviewDeploymentService.createPreviewDeployment('candidate', 'branch', sha);
    expect(result).toMatchObject({ status: 'failed', diagnostic: { failureKind: 'timeout' } });
    expect(JSON.stringify(result)).not.toContain('private-secret');
  });
  it('detecta redirecionamento para login e não o segue', async () => {
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', '');
    const f = setup(); const original = f.getMockImplementation()!;
    f.mockImplementation(async (url: string | URL) => String(url).endsWith('/api/health')
      ? new Response(null, { status: 302, headers: { location: 'https://vercel.com/sso-api?nonce=private-nonce' } }) : original(url));
    const result = await PreviewDeploymentService.createPreviewDeployment('candidate', 'branch', sha);
    expect(result).toMatchObject({ status: 'failed', diagnostic: { httpStatus: 302, failureKind: 'redirect_or_deployment_protection', bypassConfigured: false } });
    expect(result.errorMessage).toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(JSON.stringify(result)).not.toContain('private-nonce');
    expect(f.mock.calls.at(-1)?.[1]).toMatchObject({ redirect: 'manual' });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('envia o segredo apenas ao health do deployment conferido, nunca à API Vercel', async () => {
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'automation-test-secret');
    const f = setup();
    expect((await PreviewDeploymentService.createPreviewDeployment('candidate', 'branch', sha)).status).toBe('ready');
    expect(f.mock.calls.at(-1)?.[1]).toMatchObject({ headers: { 'x-vercel-protection-bypass': 'automation-test-secret' }, redirect: 'manual' });
    for (const call of f.mock.calls.slice(0, 2)) expect(JSON.stringify(call)).not.toContain('automation-test-secret');
  });
  it('nao consulta deploys quando o SHA nao foi informado', async () => {
    const f = setup();
    expect((await PreviewDeploymentService.createPreviewDeployment('candidate', 'branch')).status).toBe('pending');
    expect(f).not.toHaveBeenCalled();
  });
});
