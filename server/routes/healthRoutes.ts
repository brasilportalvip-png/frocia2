import { Router } from 'express';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { AuthenticatedRequest } from '../types.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';

export const healthRouter = Router();

// GET /api/health - Light ping check matching IntegrationsPage expectations (Público e Mínimo)
healthRouter.get('/health', (req: AuthenticatedRequest, res) => {
  return res.json({
    status: 'ok',
    healthy: true,
    service: 'Froc.IA Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId || `corr-${Date.now()}`,
  });
});

// GET /api/health/detailed - Detailed subsystem status check (Somente Administrador)
healthRouter.get('/health/detailed', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const timestamp = new Date().toISOString();

  const firestoreOk = Boolean(adminDb);
  const authOk = isFirebaseAdminConfigured();
  const geminiOk = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5
  );
  const mercadoPagoOk = Boolean(
    process.env.MERCADO_PAGO_ACCESS_TOKEN && process.env.MERCADO_PAGO_ACCESS_TOKEN.trim().length > 5
  );

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (!firestoreOk || !geminiOk || !authOk) {
    overallStatus = (firestoreOk || geminiOk) ? 'degraded' : 'unhealthy';
  }

  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  return res.status(statusCode).json({
    status: overallStatus,
    timestamp,
    correlationId: req.correlationId,
    checks: {
      firestore: firestoreOk,
      auth: authOk,
      gemini: geminiOk,
      mercadoPago: mercadoPagoOk,
    },
    environment: process.env.NODE_ENV || 'development',
  });
});
