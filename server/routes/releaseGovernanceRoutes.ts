import { Response, Router } from 'express';
import { z, ZodError } from 'zod';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import {
  PRODUCTION_GATE_KEYS,
  ProductionGateEvidence,
  ProductionReleaseError,
  getProductionReleaseService,
} from '../release/productionReleaseService.js';
import { AuthenticatedRequest } from '../types.js';

export const releaseGovernanceRouter = Router();

const limiter = createRateLimiter({ windowMs: 60_000, max: 40, keyPrefix: 'release-governance' });
const releaseId = z.string().regex(/^[A-Za-z0-9:_-]{8,160}$/);
const createSchema = z.object({
  releaseId,
  version: z.string().trim().min(1).max(120),
  baseCommitSha: z.string().regex(/^[a-f0-9]{40}$/i),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/i),
}).strict();
const evidenceSchema = z.object({
  evidenceId: z.string().min(8).max(160),
  uri: z.string().min(4).max(2048),
  digest: z.string().regex(/^[a-f0-9]{64}$/i),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/i),
  environment: z.enum(['local', 'test', 'staging', 'production']),
  command: z.string().min(2).max(2000),
  result: z.string().min(4).max(5000),
  observedAt: z.string().datetime(),
  recordedBy: z.string().max(160),
  reviewerUserId: z.string().max(160).nullable(),
}).strict();
const gateSchema = z.object({
  expectedPlanVersion: z.number().int().positive(),
  status: z.enum(['passed', 'failed', 'external_blocker']),
  evidence: evidenceSchema.optional(),
  failureReason: z.string().trim().max(2000).optional(),
  blockerCode: z.string().trim().max(160).optional(),
}).strict();
const gateKeySchema = z.enum(PRODUCTION_GATE_KEYS);

function sendError(error: unknown, req: AuthenticatedRequest, res: Response) {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: { code: 'invalid_release_request', message: 'Dados da release inválidos.', details: error.issues, correlationId: req.correlationId } });
  }
  if (error instanceof ProductionReleaseError) {
    return res.status(error.httpStatus).json({ error: { code: error.code, message: error.message, correlationId: req.correlationId } });
  }
  console.error('release_governance_failed', { correlationId: req.correlationId, error: error instanceof Error ? error.message : String(error) });
  return res.status(500).json({ error: { code: 'release_governance_failed', message: 'Não foi possível concluir a operação de release.', correlationId: req.correlationId } });
}

releaseGovernanceRouter.use(requireAuth, requireAdmin, limiter);

releaseGovernanceRouter.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const body = createSchema.parse(req.body);
    const release = await getProductionReleaseService().create({
      ...body,
      implementerUserId: req.user!.uid,
    });
    return res.status(201).json({ release, correlationId: req.correlationId });
  } catch (error) {
    return sendError(error, req, res);
  }
});

releaseGovernanceRouter.get('/:releaseId', async (req: AuthenticatedRequest, res) => {
  try {
    const id = releaseId.parse(req.params.releaseId);
    const release = await getProductionReleaseService().get(id);
    return res.json({ release, correlationId: req.correlationId });
  } catch (error) {
    return sendError(error, req, res);
  }
});

releaseGovernanceRouter.post('/:releaseId/gates/:gateKey', async (req: AuthenticatedRequest, res) => {
  try {
    const id = releaseId.parse(req.params.releaseId);
    const gateKey = gateKeySchema.parse(req.params.gateKey);
    const body = gateSchema.parse(req.body);
    const release = await getProductionReleaseService().recordGate({
      releaseId: id,
      gateKey,
      expectedPlanVersion: body.expectedPlanVersion,
      status: body.status,
      actorUserId: req.user!.uid,
      evidence: body.evidence as ProductionGateEvidence | undefined,
      failureReason: body.failureReason,
      blockerCode: body.blockerCode,
    });
    return res.json({ release, correlationId: req.correlationId });
  } catch (error) {
    return sendError(error, req, res);
  }
});

releaseGovernanceRouter.get('/:releaseId/decision', async (req: AuthenticatedRequest, res) => {
  try {
    const id = releaseId.parse(req.params.releaseId);
    const decision = await getProductionReleaseService().evaluate(id);
    return res.status(decision.ready ? 200 : 409).json({ decision, correlationId: req.correlationId });
  } catch (error) {
    return sendError(error, req, res);
  }
});

releaseGovernanceRouter.get('/:releaseId/report', async (req: AuthenticatedRequest, res) => {
  try {
    const id = releaseId.parse(req.params.releaseId);
    const report = await getProductionReleaseService().finalReport(id);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ report, correlationId: req.correlationId });
  } catch (error) {
    return sendError(error, req, res);
  }
});
