import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { zipSync, strToU8 } from 'fflate';
const fixture = vi.hoisted(() => ({ db: null as any }));
vi.mock('../server/lib/firebaseAdmin.js', async () => {
  const { createMemoryFirestoreFixture } = await import('./helpers/memoryFirestoreFixture'); fixture.db = createMemoryFirestoreFixture();
  return { adminDb: fixture.db.adminDb, isFirebaseAdminConfigured: () => true, hasFullServiceAccountCredentials: () => false,
    adminAuth: { verifyIdToken: async (token: string) => ({ uid: token === 'alice' || token === 'admin' ? 'alice' : 'bob', tenantId: 'team', role: token === 'admin' ? 'admin' : 'user' }) } };
});
vi.mock('../server/development/publicGithub.js', async actual => ({ ...await actual<any>(), publicGithubArchive: vi.fn() }));
import { developmentRouter } from '../server/routes/developmentRoutes';
import { publicGithubArchive } from '../server/development/publicGithub';
import { DevelopmentService } from '../server/development/service';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService';
import { CreditWalletService } from '../server/services/creditWalletService';
import { sha256 } from '../server/development/archive';

const app = express(); app.use(express.json({ limit: '2mb' })); app.use('/api/development', developmentRouter);
const alice = { userId: 'alice', tenantId: 'team' }, bob = { userId: 'bob', tenantId: 'team' };
const zip = () => zipSync({ 'root/package.json': strToU8('{"name":"existing"}'), 'root/package-lock.json': strToU8('{"lockfileVersion":3}'), 'root/server/main.ts': strToU8('export const original=true'), 'root/asset.bin': Uint8Array.from([0, 255, 2]) });
describe('API de desenvolvimento isolada por usuário e projeto', () => {
  beforeEach(() => {
    fixture.db.reset();
    vi.mocked(publicGithubArchive).mockResolvedValue({ archive: Buffer.from(zip()), source: { kind: 'github', owner: 'public', repository: 'existing', url: 'https://github.com/public/existing', commitSha: 'a'.repeat(40), branch: 'main' } });
    vi.spyOn(GithubAutomationService, 'dispatchDevelopmentJob').mockResolvedValue({ success: false, message: 'Workflow central desabilitado.' });
    vi.spyOn(CreditWalletService, 'reserveCredits').mockResolvedValue({ success: true, reservationId: 'reservation', availableAfter: 50, reservedAfter: 50 });
    vi.spyOn(CreditWalletService, 'confirmConsumption').mockResolvedValue({ success: true, availableAfter: 100 });
  });
  afterEach(() => vi.restoreAllMocks());
  it('exige sessão antes de importar ou ler qualquer arquivo', async () => {
    expect((await request(app).post('/api/development/imports/github').send({ url: 'https://github.com/public/existing' })).status).toBe(401);
    expect(publicGithubArchive).not.toHaveBeenCalled();
  });
  it('reserva o botão mestre ao papel administrativo verificado pelo servidor', async () => {
    expect((await request(app).put('/api/development/control').set('Authorization', 'Bearer alice').send({ enabled: false, role: 'admin' })).status).toBe(403);
    const changed = await request(app).put('/api/development/control').set('Authorization', 'Bearer admin').send({ enabled: false });
    expect(changed.status).toBe(200); expect(changed.body.enabled).toBe(false);
    expect(fixture.db.documents.get('development_config/system').enabled).toBe(false);
  });
  it('importa integralmente sem GitHub App, preserva bytes e isola outro usuário/tenant', async () => {
    const response = await request(app).post('/api/development/imports/github').set('Authorization', 'Bearer alice').send({ url: 'https://github.com/public/existing' });
    expect(response.status, response.text).toBe(200); const id = response.body.workspace.id;
    expect(response.body.workspace.fileCount).toBe(4);
    const file = await request(app).get(`/api/development/workspaces/${id}/file?path=server%2Fmain.ts`).set('Authorization', 'Bearer alice');
    expect(Buffer.from(file.body.data, 'base64').toString()).toBe('export const original=true');
    expect((await request(app).get(`/api/development/workspaces/${id}/manifest`).set('Authorization', 'Bearer bob')).status).toBe(404);
    await expect(DevelopmentService.workspace({ ...alice, tenantId: 'other-team' }, id)).rejects.toMatchObject({ status: 404 });
    expect(GithubAutomationService.dispatchDevelopmentJob).not.toHaveBeenCalled();
    expect(CreditWalletService.reserveCredits).not.toHaveBeenCalled();
  });
  it('preserva pedido bloqueado, libera reserva sem gasto e retoma sem duplicar a tarefa', async () => {
    const ws = await DevelopmentService.importGithub(alice, 'https://github.com/public/existing');
    const job = await DevelopmentService.requestJob(alice, ws.id, 'Corrija o título.', 'same-request-123', 50);
    expect(job.status).toBe('blocked'); expect(job.dispatchAccepted).toBe(false);
    expect(CreditWalletService.confirmConsumption).toHaveBeenCalledWith(expect.objectContaining({ amountConsumed: 0 }));
    vi.mocked(GithubAutomationService.dispatchDevelopmentJob).mockResolvedValue({ success: true, message: 'Dispatch aceito.' });
    const resumed = await DevelopmentService.resumeJob(alice, job.id);
    expect(resumed.status).toBe('awaiting_runner'); expect(resumed.id).toBe(job.id);
    expect((await DevelopmentService.requestJob(alice, ws.id, 'Corrija o título.', 'same-request-123', 50)).id).toBe(job.id);
    expect(GithubAutomationService.dispatchDevelopmentJob).toHaveBeenCalledTimes(2);
    const cancelled = await DevelopmentService.cancel(alice, job.id); expect(cancelled.status).toBe('cancelled');
    expect((await DevelopmentService.workspace(alice, ws.id)).activeJobId).toBeNull();
  });
  it('o botão mestre bloqueia dispatch e preserva a instrução autorizada', async () => {
    const ws = await DevelopmentService.importGithub(alice, 'https://github.com/public/existing');
    fixture.db.documents.set('development_config/system', { enabled: false });
    const job = await DevelopmentService.requestJob(alice, ws.id, 'Preserve o backend.', 'paused-request-123', 50);
    expect(job.status).toBe('paused'); expect(job.instruction).toBe('Preserve o backend.');
    expect(GithubAutomationService.dispatchDevelopmentJob).not.toHaveBeenCalled(); expect(CreditWalletService.reserveCredits).not.toHaveBeenCalled();
  });
  it('upload de ZIP é verificado por checksum, recuperável e inacessível a outra conta', async () => {
    const bytes = zip(), upload = await DevelopmentService.createUpload(alice, 'original.zip', bytes.length, sha256(bytes));
    await expect(DevelopmentService.uploadPart(bob, upload.id, 0, Buffer.from(bytes).toString('base64'))).rejects.toMatchObject({ status: 404 });
    await expect(DevelopmentService.completeUpload(alice, upload.id)).rejects.toMatchObject({ code: 'upload_incomplete' });
    await DevelopmentService.uploadPart(alice, upload.id, 0, Buffer.from(bytes).toString('base64'));
    const ws = await DevelopmentService.completeUpload(alice, upload.id); expect(ws.fileCount).toBe(4);
    expect(ws.source.rootPrefix).toBe('root/');
    const original = await DevelopmentService.source(alice, ws.id); expect([...original.get('asset.bin')!.bytes]).toEqual([0, 255, 2]);
  });
});
