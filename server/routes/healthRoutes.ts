import { Router } from 'express';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { MercadoPagoService } from '../services/mercadoPagoService.js';
import { AuthenticatedRequest } from '../types.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { configuredGeminiFailoverChain } from '../ai/geminiFailoverService.js';
import { SocialSearchService } from '../ai/socialSearchService.js';

export const healthRouter = Router();

// GET /live - Minimal liveness probe (Public)
healthRouter.get(['/live', '/api/live'], (req: AuthenticatedRequest, res) => {
  return res.status(200).json({
    status: 'live',
    timestamp: new Date().toISOString(),
  });
});

// GET /ready - Deep readiness probe for Kubernetes / Cloud Run ingress (Public, 503 if unavailable)
healthRouter.get(['/ready', '/api/ready'], async (req: AuthenticatedRequest, res) => {
  const timestamp = new Date().toISOString();
  const authConfigured = isFirebaseAdminConfigured();
  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5
  );
  const geminiFailoverModels = configuredGeminiFailoverChain(
    process.env.GEMINI_DEFAULT_MODEL || 'gemini-3.7-flash'
  );
  const socialPlatformsConfigured = SocialSearchService.capabilities()
    .filter((capability) => capability.configured)
    .map((capability) => capability.platform);

  let firestoreReachable = false;
  if (authConfigured && adminDb) {
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

  const isReady = firestoreReachable && geminiConfigured;
  const statusCode = isReady ? 200 : 503;

  return res.status(statusCode).json({
    status: isReady ? 'ready' : 'not_ready',
    timestamp,
    checks: {
      firebaseAdminConfigured: authConfigured,
      firestoreReachable,
      geminiConfigured,
      mercadoPagoConfigured: MercadoPagoService.isConfigured(),
      agenticResearchConfigured: geminiConfigured && authConfigured,
      modelFailoverConfigured: geminiFailoverModels.length >= 4,
    },
    evidenceLevel: {
      firebaseAdmin: 'configuration',
      firestore: 'live_read',
      gemini: 'configuration_only',
      mercadoPago: 'configuration_only',
      agenticResearch: 'gemini_configuration_and_firestore_live_read',
      modelFailover: 'configuration_and_automated_tests',
      socialSearch: 'configuration_only',
    },
    configuredModels: geminiFailoverModels,
    configuredSocialPlatforms: socialPlatformsConfigured,
    limitations: [
      'Este endpoint não chama Gemini nem Mercado Pago para evitar custo e efeitos externos.',
      'Uma chave configurada não equivale a uma operação homologada no provedor.',
      'A pesquisa profunda usa o Gemini configurado no projeto; nenhuma chave OpenAI é necessária.',
    ],
  });
});

// GET /api/health - Light ping check matching IntegrationsPage expectations (Público e Mínimo)
healthRouter.get('/health', (req: AuthenticatedRequest, res) => {
  const firebaseConfigured = isFirebaseAdminConfigured();
  const mercadoPagoConfigured = MercadoPagoService.isConfigured();
  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5
  );

   const healthy =
    firebaseConfigured &&
    mercadoPagoConfigured &&
    geminiConfigured;

  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'not_ready',
    healthy,
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

   if (
    !firestoreReachable ||
    !geminiOk ||
    !authOk ||
    !mercadoPagoOk
  ) {
    const availableChecks = [
      firestoreReachable,
      geminiOk,
      authOk,
      mercadoPagoOk
    ].filter(Boolean).length;

    overallStatus =
      availableChecks === 0 ? 'unhealthy' : 'degraded';
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
