import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { AuthenticatedRequest } from '../types.js';
import { GithubAppError, GithubAppService } from '../services/githubAppService.js';

export const githubAppRouter = Router();
githubAppRouter.use(requireAuth);
githubAppRouter.use(createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'github-app' }));

const connectSchema = z.object({
  projectId: z.string().min(1).max(160),
  installationId: z.number().int().positive(),
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

function stateFor(req: AuthenticatedRequest): string {
  const secret = process.env.GITHUB_APP_STATE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new GithubAppError('github_app_state_not_configured', 'Segredo de estado do GitHub App não configurado.', 503);
  const payload = Buffer.from(JSON.stringify({
    uid: req.user!.uid, tenantId: req.user!.tenantId,
    nonce: crypto.randomBytes(16).toString('hex'), exp: Date.now() + 10 * 60_000,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function failure(res: any, error: unknown) {
  const appError = error instanceof GithubAppError
    ? error : new GithubAppError('github_app_failed', 'Operação do GitHub App falhou.', 500);
  return res.status(appError.status).json({ error: { code: appError.code, message: appError.message } });
}

githubAppRouter.get('/install-url', (req: AuthenticatedRequest, res) => {
  try {
    return res.json({ configured: GithubAppService.isConfigured(), url: GithubAppService.installationUrl(stateFor(req)) });
  } catch (error) { return failure(res, error); }
});

githubAppRouter.get('/installations/:installationId/repositories', async (req: AuthenticatedRequest, res) => {
  try {
    const installationId = Number(req.params.installationId);
    const repositories = await GithubAppService.listInstallationRepositories(installationId);
    return res.json({ repositories });
  } catch (error) { return failure(res, error); }
});

githubAppRouter.post('/connections', async (req: AuthenticatedRequest, res) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'invalid_github_connection', message: parsed.error.issues[0].message } });
  try {
    const { humanConfirmed: _confirmed, ...input } = parsed.data;
    const connection = await GithubAppService.connectProject({
      userId: req.user!.uid, tenantId: req.user!.tenantId, ...input,
    });
    return res.status(201).json({ connection });
  } catch (error) { return failure(res, error); }
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
