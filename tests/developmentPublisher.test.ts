import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const fixture = vi.hoisted(() => ({ store: null as any }));
vi.mock('../server/lib/firebaseAdmin.js', async () => { const { createMemoryFirestoreFixture } = await import('./helpers/memoryFirestoreFixture'); fixture.store = createMemoryFirestoreFixture(); return { adminDb: fixture.store.adminDb, isFirebaseAdminConfigured: () => true }; });
import { GithubAppService } from '../server/services/githubAppService';
import { GithubUserConnectionService } from '../server/services/githubUserConnectionService';
import { publishDevelopmentPullRequest } from '../server/development/publisher';
import { putBlob } from '../server/development/persistence';
import { writeArchive } from '../server/development/archive';

const scope = { userId: 'alice', tenantId: 'team' }, base = 'a'.repeat(40), id = 'devjob-' + '1'.repeat(40), wsid = 'workspace-' + '2'.repeat(40);
describe('Entrega opcional com permissão do dono e origem preservada', () => {
  const calls: Array<{ url: string; body?: any; method?: string }> = [];
  beforeEach(async () => {
    fixture.store.reset(); calls.length = 0;
    const source = new Map([['index.html', { bytes: Buffer.from('<main>Original</main>'), mode: 0o644 }], ['vercel.json', { bytes: Buffer.from('{"version":2}'), mode: 0o644 }]]);
    const originalRevision = await putBlob(scope, writeArchive(source)); source.get('index.html')!.bytes = Buffer.from('<main>Atualizado</main>');
    const revision = await putBlob(scope, writeArchive(source));
    fixture.store.documents.set('development_workspaces/' + wsid, { ...scope, id: wsid, projectId: wsid, revision, originalRevision, source: { kind: 'github', owner: 'alice', repository: 'Existing-App', branch: 'main', commitSha: base } });
    fixture.store.documents.set('development_jobs/' + id, { ...scope, id, workspaceId: wsid, status: 'ready', revision, checks: [{ command: 'npm test', exitCode: 0 }] });
    vi.spyOn(GithubAppService, 'getProjectConnection').mockResolvedValue({ owner: 'alice', repository: 'Existing-App', installationId: 1 } as any);
    vi.spyOn(GithubAppService, 'installationToken').mockResolvedValue({ token: 'installation-only-token', expiresAt: '', permissions: { contents: 'write', pull_requests: 'write' } });
    vi.spyOn(GithubUserConnectionService, 'assertRepositoryAccess').mockResolvedValue({} as any);
    let branchCreated = false;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init: any = {}) => {
      const url = String(input), body = init.body ? JSON.parse(init.body) : undefined; calls.push({ url, body, method: init.method });
      expect(url).toMatch(/^https:\/\/api.github.com\/repos\/alice\/Existing-App\//);
      expect(init.headers.Authorization).toBe('Bearer installation-only-token');
      if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: base } });
      if (url.includes('/git/ref/heads/froc')) return branchCreated ? Response.json({ object: { sha: 'c'.repeat(40) } }) : new Response(null, { status: 404 });
      if (url.endsWith('/git/commits/' + base)) return Response.json({ tree: { sha: '0'.repeat(40) } });
      if (url.endsWith('/git/commits/' + 'c'.repeat(40))) return Response.json({ tree: { sha: 'b'.repeat(40) }, parents: [{ sha: base }] });
      if (url.endsWith('/git/blobs')) { const bytes = Buffer.from(body.content, 'base64'); return Response.json({ sha: createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex') }); }
      if (url.endsWith('/git/trees')) return Response.json({ sha: 'b'.repeat(40) });
      if (url.endsWith('/git/commits')) return Response.json({ sha: 'c'.repeat(40) });
      if (url.endsWith('/git/refs')) { branchCreated = true; return Response.json({ ref: body.ref }); }
      if (url.includes('/pulls?')) return Response.json([]);
      if (url.endsWith('/pulls')) return Response.json({ html_url: 'https://github.com/alice/Existing-App/pull/1' });
      throw new Error('unexpected_endpoint');
    }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('gera árvore incremental e PR em rascunho, sem tocar main nem Vercel', async () => {
    const delivery = await publishDevelopmentPullRequest(scope, id);
    expect(delivery.pullRequestUrl).toBe('https://github.com/alice/Existing-App/pull/1');
    const tree = calls.find(call => call.url.endsWith('/git/trees'))!.body;
    expect(tree.base_tree).toBe('0'.repeat(40)); expect(tree.tree.map((entry: any) => entry.path)).toEqual(['index.html']);
    expect(calls.find(call => call.url.endsWith('/pulls'))!.body).toMatchObject({ base: 'main', draft: true });
    expect(calls.some(call => call.method === 'PATCH' || call.url.includes('/merge') || call.url.includes('vercel'))).toBe(false);
  });
  it('bloqueia outro usuário e falta de escrita antes de criar blobs', async () => {
    await expect(publishDevelopmentPullRequest({ userId: 'bob', tenantId: 'team' }, id)).rejects.toMatchObject({ status: 404 });
    vi.mocked(GithubUserConnectionService.assertRepositoryAccess).mockRejectedValue(new Error('write-denied'));
    await expect(publishDevelopmentPullRequest(scope, id)).rejects.toThrow('write-denied'); expect(calls).toHaveLength(0);
  });
  it('bloqueia destino diferente e origem que avançou', async () => {
    vi.mocked(GithubAppService.getProjectConnection).mockResolvedValueOnce({ owner: 'alice', repository: 'Other', installationId: 1 } as any);
    await expect(publishDevelopmentPullRequest(scope, id)).rejects.toMatchObject({ code: 'github_source_mismatch' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ object: { sha: 'f'.repeat(40) } })));
    await expect(publishDevelopmentPullRequest(scope, id)).rejects.toMatchObject({ code: 'github_origin_changed' });
  });
});
