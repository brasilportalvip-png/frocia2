import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: new Map<string, any>(), nextId: 0 }));
vi.mock('../server/lib/firebaseAdmin.js', () => {
  const reference = (collection: string, id: string) => ({ key: collection + '/' + id,
    get: async () => ({ exists: state.rows.has(collection + '/' + id), data: () => state.rows.get(collection + '/' + id) }),
    set: async (data: any) => state.rows.set(collection + '/' + id, data),
    update: async (data: any) => state.rows.set(collection + '/' + id, { ...state.rows.get(collection + '/' + id), ...data }),
    id,
  });
  return { isFirebaseAdminConfigured: () => true, adminDb: {
    collection: (name: string) => ({ doc: (id = 'generated-' + state.nextId++) => reference(name, id) }),
    runTransaction: async (work: any) => work({ get: (ref: any) => ref.get(), set: (ref: any, data: any) => state.rows.set(ref.key, data) }),
  } };
});
vi.mock('../server/middlewares/requireAuth.js', () => ({ requireAuth: (req: any, res: any, next: any) => {
  if (!req.headers['x-user']) return res.status(401).json({ error: { code: 'unauthenticated' } });
  req.user = { uid: req.headers['x-user'], tenantId: req.headers['x-tenant'] || 'tenant-a' }; next();
} }));
vi.mock('../server/middlewares/rateLimiter.js', () => ({ createRateLimiter: () => (_req: any, _res: any, next: any) => next() }));
import { githubAppRouter } from '../server/routes/githubAppRoutes.js';
import { GithubAppService } from '../server/services/githubAppService.js';
import { GithubUserConnectionError, GithubUserConnectionService } from '../server/services/githubUserConnectionService.js';
const app = express(); app.use(express.json()); app.use('/api/github', githubAppRouter);
beforeEach(() => { state.rows.clear(); state.nextId = 0; });
afterEach(() => vi.restoreAllMocks());

describe('Conexão de projetos GitHub: autorização na fronteira HTTP', () => {
  it('bloqueia visitante e não usa token da instalação para contornar acesso do usuário', async () => {
    const list = vi.spyOn(GithubUserConnectionService, 'repositories').mockRejectedValue(new GithubUserConnectionError('github_repository_not_authorized', 'Sem acesso.', 403));
    const token = vi.spyOn(GithubAppService, 'installationToken');
    expect((await request(app).get('/api/github/installations/777/repositories')).status).toBe(401);
    const response = await request(app).get('/api/github/installations/777/repositories').set('x-user', 'user-a');
    expect(response.status).toBe(403); expect(token).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({ userId: 'user-a', tenantId: 'tenant-a' }, 777, 1);
  });
  it('valida paginação e mantém cache privado', async () => {
    const list = vi.spyOn(GithubUserConnectionService, 'repositories').mockResolvedValue({ repositories: [], hasNextPage: true });
    const response = await request(app).get('/api/github/installations/10/repositories?page=2').set('x-user', 'user-a');
    expect(response.body.hasNextPage).toBe(true); expect(response.headers['cache-control']).toBe('no-store');
    expect(list).toHaveBeenCalledWith(expect.anything(), 10, 2);
    expect((await request(app).get('/api/github/installations/10/repositories?page=-1').set('x-user', 'user-a')).status).toBe(400);
  });
  it('valida o proprietário do projeto antes de vincular qualquer repositório', async () => {
    state.rows.set('projects/private-project', { userId: 'real-owner', tenantId: 'tenant-a' });
    const access = vi.spyOn(GithubUserConnectionService, 'assertRepositoryAccess');
    const response = await request(app).post('/api/github/connections').set('x-user', 'attacker').send({ projectId: 'private-project', installationId: 123, owner: 'owner', repository: 'repo', humanConfirmed: true });
    expect(response.status).toBe(404); expect(access).not.toHaveBeenCalled();
  });
  it('rejeita vincular instalação a quem não provou acesso GitHub', async () => {
    state.rows.set('projects/mine', { userId: 'user-a', tenantId: 'tenant-a' });
    vi.spyOn(GithubUserConnectionService, 'assertRepositoryAccess').mockRejectedValue(new GithubUserConnectionError('github_repository_not_authorized', 'Sem acesso.', 403));
    const list = vi.spyOn(GithubAppService, 'listInstallationRepositories');
    const response = await request(app).post('/api/github/connections').set('x-user', 'user-a').send({ projectId: 'mine', installationId: 123, owner: 'other-user', repository: 'repo', humanConfirmed: true });
    expect(response.status).toBe(403); expect(list).not.toHaveBeenCalled();
    expect(state.rows.size).toBe(1);
  });
  it('reimporta o mesmo destino sem duplicar ou reescrever o projeto existente', async () => {
    vi.spyOn(GithubUserConnectionService, 'assertRepositoryAccess').mockResolvedValue({ id: 1, owner: 'owner', name: 'repo', private: true, defaultBranch: 'main', canPush: true });
    vi.spyOn(GithubAppService, 'connectProject').mockResolvedValue({ owner: 'owner', repository: 'repo' } as any);
    const input = { owner: 'owner', repository: 'repo', installationId: 123, humanConfirmed: true };
    const first = await request(app).post('/api/github/imports').set('x-user', 'user-a').send(input);
    expect(first.status).toBe(201);
    const id = first.body.projectId; state.rows.get('projects/' + id).title = 'Título que o usuário alterou';
    const second = await request(app).post('/api/github/imports').set('x-user', 'user-a').send(input);
    expect(second.body.projectId).toBe(id); expect(state.rows.size).toBe(1);
    expect(state.rows.get('projects/' + id).title).toBe('Título que o usuário alterou');
    expect(state.rows.get('projects/' + id).sourceKind).toBe('github');
    expect(state.rows.get('projects/' + id).html).toBe('');
  });
});
