import { Router } from 'express';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { MercadoPagoService } from '../services/mercadoPagoService.js';
import { AuthenticatedRequest } from '../types.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';

export const healthRouter = Router();

// GET /api/health - Light ping check matching IntegrationsPage expectations (Público e Mínimo)
healthRouter.get('/health', (req: AuthenticatedRequest, res) => {
  const firebaseConfigured = isFirebaseAdminConfigured();
  const mercadoPagoConfigured = MercadoPagoService.isConfigured();
  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5
  );

  return res.json({
    status: 'ok',
    healthy: true,
    service: 'Froc.IA Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId || `corr-${Date.now()}`,
    firebaseConfigured,
    mercadoPagoConfigured,
    geminiConfigured,
  });
});

// GET /api/health/detailed - Detailed subsystem status check (Somente Administrador)
healthRouter.get('/health/detailed', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const timestamp = new Date().toISOString();

  const authOk = isFirebaseAdminConfigured();
  const geminiOk = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5
  );
  const mercadoPagoOk = MercadoPagoService.isConfigured();

  let firestoreReachable = false;
  if (authOk && adminDb) {
    try {
      const pingDoc = adminDb.collection('_healthcheck').doc('ping');
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 3000)
      );
      await Promise.race([pingDoc.get(), timeoutPromise]);
      firestoreReachable = true;
    } catch {
      firestoreReachable = false;
    }
  }

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (!firestoreReachable || !geminiOk || !authOk) {
    overallStatus = (firestoreReachable || geminiOk) ? 'degraded' : 'unhealthy';
  }

  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  return res.status(statusCode).json({
    status: overallStatus,
    timestamp,
    correlationId: req.correlationId,
    checks: {
      firestore: {
        configured: authOk,
        reachable: firestoreReachable
      },
      auth: authOk,
      gemini: geminiOk,
      mercadoPago: mercadoPagoOk,
    },
    environment: process.env.NODE_ENV || 'development',
  });
});
