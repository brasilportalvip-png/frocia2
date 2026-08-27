import { Response, Router } from 'express';
import { z, ZodError } from 'zod';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { OperationalTelemetryError } from '../observability/operationalTelemetryService.js';
import { getOperationalTelemetryService } from '../observability/operationalTelemetryRuntime.js';
import { AuthenticatedRequest } from '../types.js';

export const observabilityRouter = Router();

const observabilityLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  keyPrefix: 'observability-admin',
});

const querySchema = z
  .object({
    durationMinutes: z.coerce.number().int().min(1).max(43_200).default(60),
    tenantId: z.string().trim().regex(/^[A-Za-z0-9:_-]{1,120}$/).optional(),
  })
  .strict();

function sendError(error: unknown, req: AuthenticatedRequest, res: Response) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'invalid_observability_query',
        message: 'Consulta de observabilidade inválida.',
        details: error.issues,
        correlationId: req.correlationId,
      },
    });
  }
  if (error instanceof OperationalTelemetryError) {
    return res.status(error.httpStatus).json({
      error: {
        code: error.code,
        message: error.message,
        correlationId: req.correlationId,
      },
    });
  }
  console.error('observability_query_failed', {
    correlationId: req.correlationId,
    message: error instanceof Error ? error.message : String(error),
  });
  return res.status(500).json({
    error: {
      code: 'observability_query_failed',
      message: 'Não foi possível consultar a observabilidade operacional.',
      correlationId: req.correlationId,
    },
  });
}

observabilityRouter.use(requireAuth, requireAdmin, observabilityLimiter);

observabilityRouter.get('/snapshot', async (req: AuthenticatedRequest, res) => {
  try {
    const query = querySchema.parse(req.query);
    const service = getOperationalTelemetryService();
    const snapshot = await service.snapshot(query);
    const alerts = await service.evaluateAndPersistAlerts(snapshot);
    return res.json({
      snapshot,
      alerts,
      correlationId: req.correlationId,
    });
  } catch (error) {
    return sendError(error, req, res);
  }
});

observabilityRouter.get('/alerts', async (req: AuthenticatedRequest, res) => {
  try {
    const query = querySchema.parse(req.query);
    const alerts = await getOperationalTelemetryService().listAlerts(query);
    return res.json({ alerts, correlationId: req.correlationId });
  } catch (error) {
    return sendError(error, req, res);
  }
});
