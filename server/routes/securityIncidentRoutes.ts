import { Router } from 'express';
import { z } from 'zod';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { getSecurityEventService } from '../security/securityEventService.js';
import { AuthenticatedRequest } from '../types.js';

export const securityIncidentRouter = Router();
const limiter = createRateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'security-incidents' });
const transitionSchema = z.object({
  status: z.enum(['investigating', 'contained', 'resolved']),
  resolutionSummary: z.string().trim().max(2000).optional(),
}).strict();

securityIncidentRouter.use(requireAuth, requireAdmin, limiter);

securityIncidentRouter.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
    const incidents = await getSecurityEventService().listIncidents(limit);
    return res.json({ incidents, correlationId: req.correlationId });
  } catch (error) {
    console.error('security_incident_list_failed', error);
    return res.status(500).json({ error: { code: 'security_incident_list_failed', message: 'Não foi possível consultar os incidentes.', correlationId: req.correlationId } });
  }
});

securityIncidentRouter.post('/:incidentId/transition', async (req: AuthenticatedRequest, res) => {
  const parsed = transitionSchema.safeParse(req.body);
  if (!parsed.success || !/^[A-Za-z0-9:_-]{8,160}$/.test(req.params.incidentId)) {
    return res.status(400).json({ error: { code: 'invalid_incident_transition', message: 'Transição de incidente inválida.', correlationId: req.correlationId } });
  }
  try {
    const incident = await getSecurityEventService().transitionIncident({
      incidentId: req.params.incidentId,
      actorUserId: req.user!.uid,
      ...parsed.data,
    });
    return res.json({ incident, correlationId: req.correlationId });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'security_incident_transition_failed';
    const status = code === 'security_incident_not_found' ? 404 : code.startsWith('invalid_') || code.endsWith('_required') ? 409 : 500;
    return res.status(status).json({ error: { code, message: 'Não foi possível atualizar o incidente.', correlationId: req.correlationId } });
  }
});
