import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { type AuthenticatedRequest } from '../types.js';
import { DevelopmentService } from '../development/service.js';
import { DevelopmentError, sha256 } from '../development/archive.js';
import { db, owned, type DevelopmentScope } from '../development/persistence.js';
import { publishDevelopmentPullRequest } from '../development/publisher.js';

export const developmentRouter = Router();
developmentRouter.use(requireAuth, createRateLimiter({ windowMs: 60_000, max: 240, keyPrefix: 'development' }));
developmentRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const actor = (req: AuthenticatedRequest) => ({ userId: req.user!.uid, tenantId: req.user!.tenantId });
const id = (value: unknown) => z.string().regex(/^[\w-]{1,160}$/).parse(value);
const route = (handler: (req: AuthenticatedRequest, res: any) => Promise<any>) => async (req: AuthenticatedRequest, res: any) => {
  try { await handler(req, res); }
  catch (error) {
    res.status(error instanceof z.ZodError ? 400 : error instanceof DevelopmentError ? error.status : 503).json({ error: {
      code: error instanceof DevelopmentError ? error.code : 'development_unavailable',
      message: error instanceof DevelopmentError ? error.message : error instanceof z.ZodError ? 'Confira os dados do projeto.' : 'Operação indisponível. O projeto e os recibos anteriores foram preservados.',
    } });
  }
};
developmentRouter.get('/control', route(async (req, res) => {
  if (req.user!.role !== 'admin') throw new DevelopmentError('administrator_required', 'Controle global disponível somente ao administrador.', 403);
  const data = (await db().collection('development_config').doc('system').get()).data();
  res.json({ enabled: data?.enabled !== false, changedAt: data?.changedAt || null });
}));
developmentRouter.put('/control', route(async (req, res) => {
  if (req.user!.role !== 'admin') throw new DevelopmentError('administrator_required', 'Controle global disponível somente ao administrador.', 403);
  const input = z.object({ enabled: z.boolean() }).strict().parse(req.body);
  await db().collection('development_config').doc('system').set({ enabled: input.enabled, changedBy: req.user!.uid, changedAt: new Date().toISOString() }, { merge: true });
  let resumed = 0;
  if (input.enabled) {
    const paused = await db().collection('development_jobs').where('status', '==', 'paused').limit(20).get();
    for (const document of paused.docs) {
      const job = document.data();
      const result = await DevelopmentService.resumeJob({ userId: job.userId, tenantId: job.tenantId }, document.id).catch(() => null);
      if (result?.dispatchAccepted) resumed++;
    }
  }
  res.json({ enabled: input.enabled, resumed, message: input.enabled ? 'Controle habilitado. Pedidos anteriores conservam o orçamento autorizado; pausas individuais são respeitadas.' : 'Execução pausada. Os workers interrompem os comandos na próxima verificação de controle.' });
}));
developmentRouter.post('/imports/github', createRateLimiter({ windowMs: 60_000, max: 3, keyPrefix: 'development-import' }), route(async (req, res) => {
  const input = z.object({ url: z.string().max(2048) }).strict().parse(req.body);
  res.json({ workspace: await DevelopmentService.importGithub(actor(req), input.url) });
}));
developmentRouter.post('/imports/saved', route(async (req, res) => {
  const input = z.object({ projectId: z.string().max(160) }).strict().parse(req.body);
  res.json({ workspace: await DevelopmentService.importSaved(actor(req), input.projectId) });
}));
developmentRouter.post('/uploads', route(async (req, res) => {
  const input = z.object({ name: z.string().min(1).max(120), size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
  res.json(await DevelopmentService.createUpload(actor(req), input.name, input.size, input.sha256));
}));
developmentRouter.put('/uploads/:id/parts/:index', route(async (req, res) => {
  const input = z.object({ data: z.string().max(525_000) }).strict().parse(req.body);
  res.json(await DevelopmentService.uploadPart(actor(req), id(req.params.id), z.coerce.number().int().min(0).max(134).parse(req.params.index), input.data));
}));
developmentRouter.post('/uploads/:id/complete', route(async (req, res) => res.json({ workspace: await DevelopmentService.completeUpload(actor(req), id(req.params.id)) })));
developmentRouter.get('/workspaces/:id', route(async (req, res) => res.json({ workspace: await DevelopmentService.workspace(actor(req), id(req.params.id)) })));
developmentRouter.get('/workspaces/:id/manifest', route(async (req, res) => res.json(await DevelopmentService.manifest(actor(req), id(req.params.id)))));
developmentRouter.get('/workspaces/:id/file', route(async (req, res) => res.json(await DevelopmentService.file(actor(req), id(req.params.id), z.string().max(500).parse(req.query.path)))));
developmentRouter.post('/workspaces/:id/jobs', route(async (req, res) => {
  const input = z.object({ instruction: z.string().min(1).max(40_000), idempotencyKey: z.string().min(8).max(160), authorizedCredits: z.number().int().min(1).max(50) }).strict().parse(req.body);
  res.json({ job: await DevelopmentService.requestJob(actor(req), id(req.params.id), input.instruction, input.idempotencyKey, input.authorizedCredits) });
}));
developmentRouter.put('/workspaces/:id/pause', route(async (req, res) => {
  const input = z.object({ paused: z.boolean() }).strict().parse(req.body);
  res.json({ workspace: await DevelopmentService.pause(actor(req), id(req.params.id), input.paused) });
}));
developmentRouter.get('/jobs/:id', route(async (req, res) => res.json({ job: await DevelopmentService.job(actor(req), id(req.params.id)) })));
developmentRouter.post('/jobs/:id/cancel', route(async (req, res) => res.json({ job: await DevelopmentService.cancel(actor(req), id(req.params.id)) })));
developmentRouter.post('/jobs/:id/resume', route(async (req, res) => res.json({ job: await DevelopmentService.resumeJob(actor(req), id(req.params.id)) })));
developmentRouter.post('/jobs/:id/pull-request', route(async (req, res) => {
  z.object({ humanConfirmed: z.literal(true) }).strict().parse(req.body);
  res.json({ delivery: await publishDevelopmentPullRequest(actor(req), id(req.params.id)) });
}));

async function artifact(scope: DevelopmentScope, kind: string, resourceId: string) {
  let blob: string | undefined;
  if (kind === 'export') blob = (await DevelopmentService.workspace(scope, resourceId)).revision;
  else { const job = await DevelopmentService.job(scope, resourceId); blob = kind === 'preview' ? job.previewHtml : kind === 'logs' ? job.commandLog : kind === 'diff' ? job.diffBlob : undefined; }
  if (!blob) throw new DevelopmentError('artifact_not_ready', 'Este artefato ainda não está pronto. Consulte o estado registrado.', 409);
  const { data } = await owned('development_blobs', blob, scope);
  if (!data.ready) throw new DevelopmentError('artifact_incomplete', 'Artefato ainda está sendo confirmado.', 409);
  return { revision: blob, sha256: data.digest, size: data.size, chunks: data.chunks };
}
for (const [prefix, kind] of [['workspaces', 'export'], ['jobs', 'preview'], ['jobs', 'logs'], ['jobs', 'diff']]) {
  developmentRouter.get(`/${prefix}/:id/${kind}`, route(async (req, res) => res.json(await artifact(actor(req), kind, id(req.params.id)))));
  developmentRouter.get(`/${prefix}/:id/${kind}/parts/:index`, route(async (req, res) => {
    const metadata = await artifact(actor(req), kind, id(req.params.id));
    if (req.query.revision !== metadata.revision) throw new DevelopmentError('artifact_version_changed', 'A versão mudou. Reinicie o download para manter integridade.', 409);
    const index = z.coerce.number().int().min(0).max(metadata.chunks - 1).parse(req.params.index);
    const data = (await db().collection('development_blob_chunks').doc(`${metadata.revision}-${index}`).get()).data();
    if (!data || data.digest !== metadata.sha256) throw new DevelopmentError('artifact_corrupted', 'Parte indisponível.', 409);
    res.json({ data: data.data, index, sha256: sha256(Buffer.from(data.data, 'base64')) });
  }));
}
