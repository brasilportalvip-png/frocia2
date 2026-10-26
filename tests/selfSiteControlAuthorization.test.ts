import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../server/lib/firebaseAdmin.js', () => ({
  isFirebaseAdminConfigured: () => false, hasFullServiceAccountCredentials: () => false, adminDb: {},
  adminAuth: { verifyIdToken: async (token: string) => ({ uid: token === 'admin-token' ? 'owner' : 'ordinary-user',
    email: 'test@example.com', role: token === 'admin-token' ? 'admin' : 'user' }) },
}));

import { selfEvolutionRouter } from '../server/routes/selfEvolutionRoutes.js';
import { SelfSiteKnowledgeService } from '../server/selfEvolution/selfSiteKnowledgeService.js';
import { SelfSiteOwnerService } from '../server/selfEvolution/selfSiteOwnerService.js';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService.js';
import { CandidateQueueService } from '../server/selfEvolution/candidateQueueService.js';

const app = express(); app.use(express.json()); app.use('/api/admin/self-evolution', selfEvolutionRouter);
describe('Controle do proprio site reservado ao dono autenticado', () => {
  beforeEach(() => {
    vi.spyOn(SelfSiteKnowledgeService, 'latest').mockResolvedValue({ filesCount: 400 } as any);
    vi.spyOn(SelfSiteOwnerService, 'operationalSnapshot').mockResolvedValue({ lastRunner: { status: 'pending' } });
    vi.spyOn(SelfSiteOwnerService, 'requestRun').mockResolvedValue({ status: 'requested', candidateId: 'test' });
    vi.spyOn(SelfSiteOwnerService, 'setEnabled').mockResolvedValue({ status: 'enabled' });
    vi.spyOn(GithubAutomationService, 'inspectMaintenanceConnection').mockResolvedValue({ scope: 'chat_backend', status: 'not_configured' });
  });
  afterEach(() => vi.restoreAllMocks());
  it('exige autenticacao para consultar o mapa', async () => {
    expect((await request(app).get('/api/admin/self-evolution/site-map')).status).toBe(401);
  });
  it('impede um usuario comum de consultar o mapa interno', async () => {
    expect((await request(app).get('/api/admin/self-evolution/site-map').set('Authorization', 'Bearer user-token')).status).toBe(403);
    expect(SelfSiteKnowledgeService.latest).not.toHaveBeenCalled();
  });
  it('consulta a ponte de manutencao somente depois de verificar o administrador', async () => {
    expect((await request(app).get('/api/admin/self-evolution/control/status').set('Authorization', 'Bearer user-token')).status).toBe(403);
    expect(GithubAutomationService.inspectMaintenanceConnection).not.toHaveBeenCalled();
    const result = await request(app).get('/api/admin/self-evolution/control/status').set('Authorization', 'Bearer admin-token');
    expect(result.status).toBe(200);
    expect(result.body.connection).toMatchObject({ scope: 'chat_backend', status: 'not_configured' });
  });
  it('retorna mapa e estado operacional ao administrador autenticado', async () => {
    const result = await request(app).get('/api/admin/self-evolution/site-map').set('Authorization', 'Bearer admin-token');
    expect(result.status).toBe(200);
    expect(result.body.knowledge.filesCount).toBe(400);
  });
  it('nao aceita privilegio administrativo declarado no corpo pelo usuario', async () => {
    const result = await request(app).post('/api/admin/self-evolution/control/run').set('Authorization', 'Bearer user-token')
      .send({ role: 'admin', reason: 'Corrija os erros no meu site.' });
    expect(result.status).toBe(403);
    expect(SelfSiteOwnerService.requestRun).not.toHaveBeenCalled();
  });
  it('usa a identidade verificada do dono para iniciar a manutencao', async () => {
    const result = await request(app).post('/api/admin/self-evolution/control/run').set('Authorization', 'Bearer admin-token')
      .send({ userId: 'someone-else', reason: 'Corrija os erros no meu site.' });
    expect(result.status).toBe(202);
    expect(SelfSiteOwnerService.requestRun).toHaveBeenCalledWith('owner', 'Corrija os erros no meu site.');
  });
  it('permite ao dono retomar o sistema sem editar o Firestore manualmente', async () => {
    const result = await request(app).post('/api/admin/self-evolution/control/enabled').set('Authorization', 'Bearer admin-token').send({ enabled: true });
    expect(result.status).toBe(200);
    expect(SelfSiteOwnerService.setEnabled).toHaveBeenCalledWith('owner', true, expect.any(String));
  });
  it('reserva o liga/desliga ao administrador e recusa valores ambíguos', async () => {
    const endpoint = '/api/admin/self-evolution/control/enabled';
    expect((await request(app).post(endpoint).send({ enabled: false })).status).toBe(401);
    expect((await request(app).post(endpoint).set('Authorization', 'Bearer user-token').send({ enabled: false, role: 'admin' })).status).toBe(403);
    expect((await request(app).post(endpoint).set('Authorization', 'Bearer admin-token').send({ enabled: 'false' })).status).toBe(400);
    expect(SelfSiteOwnerService.setEnabled).not.toHaveBeenCalled();
    expect((await request(app).post(endpoint).set('Authorization', 'Bearer admin-token').send({ enabled: false, userId: 'forged' })).status).toBe(200);
    expect(SelfSiteOwnerService.setEnabled).toHaveBeenCalledWith('owner', false, expect.any(String));
  });
  it('exige autenticação e privilégio administrativo para excluir uma tarefa', async () => {
    const remove = vi.spyOn(CandidateQueueService, 'remove');
    const endpoint = '/api/admin/self-evolution/candidates/owner-task';
    expect((await request(app).delete(endpoint).send({ confirmation: 'owner-task' })).status).toBe(401);
    expect((await request(app).delete(endpoint).set('Authorization', 'Bearer user-token').send({ confirmation: 'owner-task', role: 'admin' })).status).toBe(403);
    expect(remove).not.toHaveBeenCalled();
  });
  it('exige confirmação do mesmo item e usa a identidade autenticada, sem aceitar autor no corpo', async () => {
    const remove = vi.spyOn(CandidateQueueService, 'remove').mockResolvedValue({ candidateId: 'owner-task', deleted: true, alreadyDeleted: false });
    const endpoint = '/api/admin/self-evolution/candidates/owner-task';
    expect((await request(app).delete(endpoint).set('Authorization', 'Bearer admin-token').send({ confirmation: 'other-task' })).status).toBe(400);
    expect((await request(app).delete(endpoint).set('Authorization', 'Bearer admin-token').send({ confirmation: 'owner-task', actorUid: 'someone-else' })).status).toBe(400);
    expect(remove).not.toHaveBeenCalled();
    expect((await request(app).delete(endpoint).set('Authorization', 'Bearer admin-token').send({ confirmation: 'owner-task' })).status).toBe(200);
    expect(remove).toHaveBeenCalledWith('owner-task', 'owner');
  });
});
