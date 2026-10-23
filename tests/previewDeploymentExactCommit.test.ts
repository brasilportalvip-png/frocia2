import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewDeploymentService } from '../server/selfEvolution/previewDeploymentService.js';

const sha = 'a'.repeat(40);
const item = { uid: 'dpl_preview', state: 'READY', meta: { githubCommitSha: sha } };
describe('Preview do commit exato da correcao', () => {
  beforeEach(() => { vi.stubEnv('VERCEL_TOKEN', 'private'); vi.stubEnv('VERCEL_PROJECT_ID', 'prj_site'); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  function setup(details: Record<string, unknown> = {}) {
    const f = vi.fn(async (url: string | URL) => String(url).includes('/v6/deployments') ? Response.json({ deployments: [item] })
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
  it('nao consulta deploys quando o SHA nao foi informado', async () => {
    const f = setup();
    expect((await PreviewDeploymentService.createPreviewDeployment('candidate', 'branch')).status).toBe('pending');
    expect(f).not.toHaveBeenCalled();
  });
});
