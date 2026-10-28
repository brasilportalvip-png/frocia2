import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { AuthenticatedRequest } from '../types.js';
import { GithubAppError, GithubAppService } from '../services/githubAppService.js';
import { GithubUserConnectionError, GithubUserConnectionService } from '../services/githubUserConnectionService.js';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';

export const githubAppRouter = Router();
githubAppRouter.use(requireAuth);
githubAppRouter.use(createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'github-app' }));
githubAppRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const actor = (req: AuthenticatedRequest) => ({ userId: req.user!.uid, tenantId: req.user!.tenantId });
const pageNumber = (value: unknown) => z.coerce.number().int().min(1).max(100).default(1).parse(value);

const connectSchema = z.object({
  projectId: z.string().min(1).max(160),
  installationId: z.number().int().positive().optional(),
  owner: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  humanConfirmed: z.literal(true),
}).strict();

const branchSchema = z.object({
  baseSha: z.string().regex(/^[a-f0-9]{40}$/i),
  branch: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/),
  humanConfirmed: z.literal(true),
}).strict();

const commitSchema = z.object({
  branch: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/),
  path: z.string().min(1).max(240), content: z.string().max(1_000_000),
  message: z.string().min(1).max(120), expectedBlobSha: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  humanConfirmed: z.literal(true),
}).strict();

const pullSchema = z.object({
  title: z.string().min(1).max(160), body: z.string().max(20_000),
  head: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/), base: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/),
  humanConfirmed: z.literal(true),
}).strict();

function failure(res: any, error: unknown) {
  const appError = error instanceof GithubAppError || error instanceof GithubUserConnectionError
    ? error : new GithubAppError('github_app_failed', 'Operação do GitHub App falhou.', 500);
  if (error instanceof z.ZodError) return res.status(400).json({ error: { code: 'invalid_github_input', message: 'Confira os dados enviados ao GitHub.' } });
  return res.status(appError.status).json({ error: { code: appError.code, message: appError.message } });
}

githubAppRouter.get('/install-url', async (req: AuthenticatedRequest, res) => {
  try {
    return res.json({ configured: GithubAppService.isConfigured(), url: GithubAppService.installationUrl(await GithubUserConnectionService.installationState(actor(req))) });
  } catch (error) { return failure(res, error); }
});

githubAppRouter.get('/account', async (req: AuthenticatedRequest, res) => {
  try { return res.json({ ...await GithubUserConnectionService.status(actor(req)), appConfigured: GithubAppService.isConfigured() }); }
  catch (error) { return failure(res, error); }
});
githubAppRouter.post('/authorize-url', async (req: AuthenticatedRequest, res) => {
  try { return res.json(await GithubUserConnectionService.authorizationUrl(actor(req))); }
  catch (error) { return failure(res, error); }
});
githubAppRouter.post('/oauth/callback', async (req: AuthenticatedRequest, res) => {
  try {
    const input = z.object({ code: z.string().min(1).max(300), state: z.string().length(43) }).strict().parse(req.body);
    return res.json(await GithubUserConnectionService.completeAuthorization(actor(req), input.code, input.state));
  } catch (error) { return failure(res, error); }
});
githubAppRouter.delete('/account', async (req: AuthenticatedRequest, res) => {
  try { await GithubUserConnectionService.disconnect(actor(req)); return res.status(204).end(); }
  catch (error) { return failure(res, error); }
});
githubAppRouter.get('/installations', async (req: AuthenticatedRequest, res) => {
  try { return res.json(await GithubUserConnectionService.installations(actor(req), pageNumber(req.query.page))); }
  catch (error) { return failure(res, error); }
});
githubAppRouter.post('/repositories', async (req: AuthenticatedRequest, res) => {
  try {
    const input = z.object({ name: z.string().min(1).max(100), private: z.boolean() }).strict().parse(req.body);
    const repository = await GithubUserConnectionService.createRepository(actor(req), input.name, input.private);
    return res.status(201).json({ repository });
  } catch (error) { return failure(res, error); }
});

githubAppRouter.get('/installations/:installationId/repositories', async (req: AuthenticatedRequest, res) => {
  try {
    const installationId = Number(req.params.installationId);
    return res.json(await GithubUserConnectionService.repositories(actor(req), installationId, pageNumber(req.query.page)));
  } catch (error) { return failure(res, error); }
});

githubAppRouter.get('/projects/:projectId/connection', async (req: AuthenticatedRequest, res) => {
  try { return res.json({ connection: await GithubAppService.getProjectConnection(req.user!.uid, req.user!.tenantId, req.params.projectId) }); }
  catch (error) { return failure(res, error); }
});
githubAppRouter.get('/projects/:projectId/tree', async (req: AuthenticatedRequest, res) => {
  try {
    const connection = await GithubAppService.getProjectConnection(req.user!.uid, req.user!.tenantId, req.params.projectId);
    return res.json(await GithubAppService.sourceTree(connection, typeof req.query.ref === 'string' ? req.query.ref : undefined));
  } catch (error) { return failure(res, error); }
});
githubAppRouter.get('/projects/:projectId/file', async (req: AuthenticatedRequest, res) => {
  try {
    const connection = await GithubAppService.getProjectConnection(req.user!.uid, req.user!.tenantId, req.params.projectId);
    const input = z.object({ path: z.string().max(240), ref: z.string().regex(/^[a-f0-9]{40}$/i) }).strict().parse(req.query);
    return res.json(await GithubAppService.readSourceFile(connection, input.path, input.ref));
  } catch (error) { return failure(res, error); }
});
githubAppRouter.post('/imports', async (req: AuthenticatedRequest, res) => {
  let reference: FirebaseFirestore.DocumentReference | undefined;
  try {
    const input = connectSchema.omit({ projectId: true }).parse(req.body);
    if (!isFirebaseAdminConfigured()) throw new GithubAppError('database_not_configured', 'Banco de dados indisponível.', 503);
    await GithubUserConnectionService.assertRepositoryAccess(actor(req), input.owner, input.repository);
    const installationId = input.installationId ?? await GithubAppService.findRepositoryInstallation(input.owner, input.repository);
    const id = 'github-' + crypto.createHash('sha256').update(JSON.stringify([req.user!.tenantId, req.user!.uid, input.owner.toLowerCase(), input.repository.toLowerCase()])).digest('hex').slice(0, 40);
    reference = adminDb.collection('projects').doc(id);
    const now = new Date().toISOString();
    await adminDb.runTransaction(async tx => {
      const existing = await tx.get(reference!);
      if (existing.exists) {
        if (existing.data()?.userId !== req.user!.uid || existing.data()?.tenantId !== req.user!.tenantId) throw new GithubAppError('project_not_found', 'Projeto não encontrado.', 404);
      } else {
        tx.set(reference!, { ...actor(req), title: input.repository, sourceKind: 'github', sourceState: 'connection_pending', html: '',
          description: 'Projeto conectado ao repositório existente.', prompt: '', category: 'Projeto importado',
          githubRepositoryFullName: `${input.owner}/${input.repository}`, createdAt: now, updatedAt: now });
      }
    });
    const connection = await GithubAppService.connectProject({ ...actor(req), projectId: reference.id, installationId, owner: input.owner, repository: input.repository });
    await reference.update({ sourceState: 'connected', updatedAt: new Date().toISOString() });
    return res.status(201).json({ projectId: reference.id, connection });
  } catch (error) {
    return failure(res, error);
  }
});

githubAppRouter.post('/connections', async (req: AuthenticatedRequest, res) => {
  const parsed = connectSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: 'invalid_github_connection',
        message: parsed.error.issues[0].message
      }
    });
  }

  try {
    const {
      humanConfirmed: _confirmed,
      installationId: requestedInstallationId,
      owner,
      repository,
      projectId,
    } = parsed.data;

    const installationId =
      requestedInstallationId ??
      await GithubAppService.findRepositoryInstallation(
        owner,
        repository
      );

    const connection =
      await GithubAppService.connectProject({
        userId: req.user!.uid,
        tenantId: req.user!.tenantId,
        projectId,
        installationId,
        owner,
        repository,
      });

    return res.status(201).json({
      connection
    });
  } catch (error) {
    return failure(res, error);
  }
});

githubAppRouter.get('/projects/:projectId/intelligence', async (req: AuthenticatedRequest, res) => {
  try {
    const connection = await GithubAppService.getProjectConnection(req.user!.uid, req.user!.tenantId, req.params.projectId);
    const report = await GithubAppService.repositoryIntelligence(
      connection, typeof req.query.q === 'string' ? req.query.q.slice(0, 300) : ''
    );
    return res.json({ report });
  } catch (error) { return failure(res, error); }
});

githubAppRouter.get('/projects/:projectId/history', async (req: AuthenticatedRequest, res) => {
  try {
    const connection = await GithubAppService.getProjectConnection(req.user!.uid, req.user!.tenantId, req.params.projectId);
    return res.json({ report: await GithubAppService.developmentHistory(connection, typeof req.query.ref === 'string' ? req.query.ref : 'main') });
  } catch (error) { return failure(res, error); }
});

githubAppRouter.post('/projects/:projectId/branches', async (req: AuthenticatedRequest, res) => {
  const parsed = branchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'invalid_branch_request', message: parsed.error.issues[0].message } });
  try {
    const connection = await GithubAppService.getProjectConnection(req.user!.uid, req.user!.tenantId, req.params.projectId);
    const result = await GithubAppService.createBranch(connection, parsed.data.baseSha, parsed.data.branch, parsed.data.humanConfirmed);
    return res.status(201).json({ result });
  } catch (error) { return failure(res, error); }
});

githubAppRouter.put('/projects/:projectId/files', async (req: AuthenticatedRequest, res) => {
  const parsed = commitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'invalid_commit_request', message: parsed.error.issues[0].message } });
  try {
    const connection = await GithubAppService.getProjectConnection(req.user!.uid, req.user!.tenantId, req.params.projectId);
    return res.status(201).json({ result: await GithubAppService.commitFile(connection, parsed.data) });
  } catch (error) { return failure(res, error); }
});

githubAppRouter.post('/projects/:projectId/pulls', async (req: AuthenticatedRequest, res) => {
  const parsed = pullSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'invalid_pull_request', message: parsed.error.issues[0].message } });
  try {
    const connection = await GithubAppService.getProjectConnection(req.user!.uid, req.user!.tenantId, req.params.projectId);
    return res.status(201).json({ result: await GithubAppService.createPullRequest(connection, parsed.data) });
  } catch (error) { return failure(res, error); }
});
