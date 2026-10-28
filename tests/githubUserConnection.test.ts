import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ rows: new Map<string, any>(), configured: true }));
vi.mock('../server/lib/firebaseAdmin.js', () => {
  const ref = (name: string, id: string) => ({ key: name + '/' + id,
    get: async () => ({ exists: db.rows.has(name + '/' + id), data: () => db.rows.get(name + '/' + id) }),
    set: async (data: any) => db.rows.set(name + '/' + id, structuredClone(data)),
    delete: async () => db.rows.delete(name + '/' + id),
  });
  return { isFirebaseAdminConfigured: () => db.configured, adminDb: {
    collection: (name: string) => ({ doc: (id: string) => ref(name, id) }),
    runTransaction: async (work: any) => work({ get: (r: any) => r.get(), delete: (r: any) => db.rows.delete(r.key),
      update: (r: any, data: any) => db.rows.set(r.key, { ...db.rows.get(r.key), ...structuredClone(data) }) }),
  } };
});
import { GithubUserConnectionService as Service } from '../server/services/githubUserConnectionService.js';
const actor = { userId: 'user-a', tenantId: 'tenant-a' };
const token = 'ghu_only-a-test-user-token';
const response = (data: any, status = 200, headers?: Record<string, string>) => Response.json(data, { status, headers });

beforeEach(() => {
  db.rows.clear(); db.configured = true;
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.test-client'); vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'test-client-secret');
  vi.stubEnv('GITHUB_APP_STATE_SECRET', 'a-test-secret-with-more-than-thirty-two-characters'); vi.stubEnv('APP_URL', 'https://froc.example');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function pending() {
  const result = await Service.authorizationUrl(actor);
  const url = new URL(result.url), state = url.searchParams.get('state')!;
  return { url, state, key: 'github_oauth_states/' + crypto.createHash('sha256').update(state).digest('hex') };
}
async function connect(expiring = false) {
  const p = await pending();
  const fetch = vi.fn().mockResolvedValueOnce(response({ access_token: token, ...(expiring ? { expires_in: 0, refresh_token: 'test-refresh', refresh_token_expires_in: 1000 } : {}) }))
    .mockResolvedValueOnce(response({ id: 42, login: 'owner-a' }));
  vi.stubGlobal('fetch', fetch);
  await Service.completeAuthorization(actor, 'test-code', p.state);
  return { ...p, fetch };
}

describe('Autorização GitHub por usuário', () => {
  it('usa PKCE, callback fixo e estado opaco com validade limitada', async () => {
    const { url, state, key } = await pending(), row = db.rows.get(key);
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://froc.example/?github=callback');
    expect(url.searchParams.get('code_challenge')).toBe(crypto.createHash('sha256').update(row.verifier).digest('base64url'));
    expect(row.expiresAt - Date.now()).toBeLessThanOrEqual(600000);
  });
  it('não troca código de outra conta ou tenant e não consome o estado correto', async () => {
    const { state, key } = await pending(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(Service.completeAuthorization({ ...actor, userId: 'attacker' }, 'code', state)).rejects.toMatchObject({ code: 'invalid_github_oauth_state' });
    await expect(Service.completeAuthorization({ ...actor, tenantId: 'other-tenant' }, 'code', state)).rejects.toMatchObject({ code: 'invalid_github_oauth_state' });
    expect(db.rows.has(key)).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejeita estado expirado e repetido sem reusar o código do GitHub', async () => {
    const p = await pending(); db.rows.get(p.key).expiresAt = Date.now() - 1;
    await expect(Service.completeAuthorization(actor, 'code', p.state)).rejects.toMatchObject({ code: 'invalid_github_oauth_state' });
    const c = await connect();
    await expect(Service.completeAuthorization(actor, 'code', c.state)).rejects.toMatchObject({ code: 'invalid_github_oauth_state' });
    expect(c.fetch).toHaveBeenCalledTimes(2);
  });
  it('criptografa credenciais e vincula a cifra ao usuário e tenant', async () => {
    const c = await connect();
    expect(JSON.stringify([...db.rows.values()])).not.toContain(token);
    expect(c.fetch.mock.calls[0][1].body).toContain('code_verifier');
    await expect(Service.accessToken(actor)).resolves.toBe(token);
    await expect(Service.accessToken({ ...actor, userId: 'another-user' })).rejects.toMatchObject({ code: 'github_user_not_connected' });
    const [key, row] = [...db.rows.entries()].find(([key]) => key.startsWith('github_user_connections/'))!;
    const other = { userId: 'other', tenantId: 'tenant-a' };
    const otherKey = crypto.createHash('sha256').update(JSON.stringify([other.tenantId, other.userId])).digest('hex');
    db.rows.set('github_user_connections/' + otherKey, { ...row, ...other });
    await expect(Service.accessToken(other)).rejects.toMatchObject({ code: 'github_reconnect_required' });
    expect(key).not.toContain(actor.userId);
  });
  it('renova token expirado com uma concessão concorrente por conta', async () => {
    const c = await connect(true);
    let finish!: (r: Response) => void;
    c.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const renewing = Service.accessToken(actor);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await expect(Service.accessToken(actor)).rejects.toMatchObject({ code: 'github_refresh_in_progress' });
    finish(response({ access_token: 'new-user-token', refresh_token: 'new-refresh-token', expires_in: 3600, refresh_token_expires_in: 7200 }));
    await expect(renewing).resolves.toBe('new-user-token');
    await expect(Service.accessToken(actor)).resolves.toBe('new-user-token');
    expect(JSON.stringify([...db.rows.values()])).not.toContain('new-user-token');
  });
  it('não mascara acesso recusado como acesso público ou autorização do App', async () => {
    const c = await connect(); c.fetch.mockResolvedValueOnce(response({ message: 'forbidden' }, 403));
    await expect(Service.repositories(actor, 9999)).rejects.toMatchObject({ status: 403 });
    expect(String(c.fetch.mock.calls[2][0])).toContain('/user/installations/9999/repositories');
  });
  it('preserva a página seguinte da lista e valida IDs antes de chamar o GitHub', async () => {
    const c = await connect(); c.fetch.mockResolvedValueOnce(response({ repositories: [{ id: 8, owner: { login: 'owner-a' }, name: 'Repo.Case', permissions: { push: true } }] }, 200, { link: '<next>; rel="next"' }));
    expect(await Service.repositories(actor, 17, 2)).toMatchObject({ hasNextPage: true, repositories: [{ owner: 'owner-a', name: 'Repo.Case', canPush: true }] });
    await expect(Service.repositories(actor, NaN)).rejects.toMatchObject({ code: 'invalid_github_installation' });
    expect(c.fetch).toHaveBeenCalledTimes(3);
  });
  it('bloqueia escrita sem permissão do usuário mesmo que o App possua acesso', async () => {
    const c = await connect(); c.fetch.mockResolvedValueOnce(response({ id: 8, owner: { login: 'owner-a' }, name: 'repo', permissions: { push: false } }));
    await expect(Service.assertRepositoryAccess(actor, 'owner-a', 'repo', true)).rejects.toMatchObject({ code: 'github_write_not_authorized' });
  });
  it('não revela erro externo com segredos e permite desconectar sem apagar repositório', async () => {
    const p = await pending(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'bad_verification_code', error_description: 'test-client-secret' })));
    const failure = await Service.completeAuthorization(actor, 'code', p.state).catch(e => e);
    expect(failure.code).toBe('github_oauth_exchange_failed'); expect(failure.message).not.toContain('test-client-secret');
    const c = await connect(); await Service.disconnect(actor);
    await expect(Service.accessToken(actor)).rejects.toMatchObject({ code: 'github_user_not_connected' });
    expect(c.fetch).toHaveBeenCalledTimes(2);
  });
});
