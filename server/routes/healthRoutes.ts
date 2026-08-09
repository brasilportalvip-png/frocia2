import { Router } from 'express';
import { adminDb, adminAuth } from '../lib/firebaseAdmin.js';

export const healthRouter = Router();

// GET /api/health - Light ping check
healthRouter.get('/health', (_req, res) => {
  return res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Froc.IA Backend',
    version: '2.0.0',
  });
});

// GET /api/health/detailed - Detailed subsystem status check
healthRouter.get('/health/detailed', async (_req, res) => {
  const timestamp = new Date().toISOString();

  let firestoreOk = false;
  if (adminDb) {
    try {
      await adminDb.collection('health_check').doc('ping').set(
        { lastPing: new Date() },
        { merge: true }
      );
      firestoreOk = true;
    } catch {
      firestoreOk = false;
    }
  }

  const authOk = Boolean(adminAuth);
  const geminiOk = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5);
  const mercadoPagoOk = Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN && process.env.MERCADO_PAGO_ACCESS_TOKEN.trim().length > 5);

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (!firestoreOk || !geminiOk || !authOk) {
    overallStatus = (firestoreOk || geminiOk) ? 'degraded' : 'unhealthy';
  }

  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  return res.status(statusCode).json({
    status: overallStatus,
    timestamp,
    checks: {
      firestore: firestoreOk,
      auth: authOk,
      gemini: geminiOk,
      mercadoPago: mercadoPagoOk,
    },
    environment: process.env.NODE_ENV || 'development',
  });
});
