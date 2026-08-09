import express, {
  NextFunction,
  Request,
  Response
} from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import helmet from 'helmet';
import crypto from 'crypto';
import { requireAuth } from './server/middlewares/requireAuth.js';
import { requireAdmin } from './server/middlewares/requireAdmin.js';
import { correlationIdMiddleware } from './server/middlewares/correlationId.js';
import { createRateLimiter } from './server/middlewares/rateLimiter.js';
import { adminAuth, adminDb, isFirebaseAdminConfigured } from './server/lib/firebaseAdmin.js';
import { AuthenticatedRequest } from './server/types.js';
import { CREDIT_PACKAGES, getCreditPackageById } from './server/config/creditPackages.js';
import {
  CreditWalletService,
  InsufficientCreditsError,
  InvalidReservationError,
  InvalidAmountError,
  IdempotencyConflictError
} from './server/services/creditWalletService.js';
import {
  MercadoPagoService,
  PaymentProviderConfigurationError,
  PaymentCreationError,
  PaymentValidationError
} from './server/services/mercadoPagoService.js';
import { CheckoutInputSchema, AdminGrantCreditsInputSchema } from './server/validators/paymentValidators.js';
import { FieldValue } from 'firebase-admin/firestore';
import { env } from './server/config/env.js';
import { internalRouter } from './server/routes/internalRoutes.js';
import { conversationRouter } from './server/routes/conversationRoutes.js';
import { memoryRouter } from './server/routes/memoryRoutes.js';
import { knowledgeRouter } from './server/routes/knowledgeRoutes.js';
import { adminAiRouter } from './server/routes/adminAiRoutes.js';


import { aiRouter } from './server/routes/aiRoutes.js';
import { featureFlagRouter } from './server/routes/featureFlagRoutes.js';
import { externalImportRouter } from './server/routes/externalImportRoutes.js';
import { portableRecoveryRouter } from './server/routes/portableRecoveryRoutes.js';
import { AIExecutionService } from './server/ai/aiExecutionService.js';



import {
  FeatureFlagDisabledError,
  FeatureFlagKey,
  FeatureFlagService
} from './server/services/featureFlagService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp() {
  const app = express();

  const requireFeatureFlag = (key: FeatureFlagKey) =>
    async (
      req: Request,
      res: Response,
      next: NextFunction
    ) => {
      try {
        await FeatureFlagService.assertEnabled(key);
        return next();
      } catch (error) {
        const request = req as AuthenticatedRequest;

        if (error instanceof FeatureFlagDisabledError) {
          return res.status(503).json({
            error: {
              code: 'feature_temporarily_disabled',
              message:
                'Este recurso está temporariamente indisponível.',
              feature: error.flag,
              correlationId: request.correlationId
            }
          });
        }

        return res.status(503).json({
          error: {
            code: 'feature_flag_check_failed',
            message:
              'Não foi possível validar a disponibilidade do recurso.',
            correlationId: request.correlationId
          }
        });
      }
    };

  const isProd = process.env.NODE_ENV === 'production';
  const scriptDirectives = isProd
    ? ["'self'", "'unsafe-inline'"]
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

  // Security & Middleware
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: scriptDirectives,
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
                    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'", 'https:', 'wss:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'", 'https:', 'http:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(correlationIdMiddleware);

  // Mount Sub-routers
  app.use('/api/internal', internalRouter);
  app.use('/api/conversations', conversationRouter);
  app.use('/api/memories', memoryRouter);
  app.use('/api', knowledgeRouter);



  app.use('/api/admin/ai', adminAiRouter);
app.use('/api/admin/feature-flags', featureFlagRouter);
app.use('/api/admin/disaster-recovery', portableRecoveryRouter);
app.use('/api/imports', externalImportRouter);
  app.use(
    '/api/ai',




    requireFeatureFlag('ai_chat'),
    aiRouter
  );

  // Rate Limiters
  const checkoutLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: 'checkout' });
  const adminLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, keyPrefix: 'admin' });
  const walletLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, keyPrefix: 'wallet' });

  // Initialize Gemini Client safely
  const getGeminiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('A chave GEMINI_API_KEY nao foi configurada nos Segredos.');
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  };

  // API Route: Health Check
  app.get('/api/health', (req: AuthenticatedRequest, res) => {
    res.json({
      status: 'ok',
      service: 'froc.ia backend',
      correlationId: req.correlationId,
      mercadoPagoConfigured: MercadoPagoService.isConfigured(),
      firebaseConfigured: isFirebaseAdminConfigured(),
    });
  });

  // User Profile Routes
  app.get('/api/users/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      let userDoc: any = null;

      if (isFirebaseAdminConfigured()) {
        const docRef = await adminDb.collection('users').doc(uid).get();
        if (docRef.exists) {
          userDoc = docRef.data();
        }
      }

      const wallet = await CreditWalletService.getBalance(uid);

      if (!userDoc) {
        return res.json({
          profile: {
            id: uid,
            name: req.user!.email ? req.user!.email.split('@')[0] : 'Usuário',
            email: req.user!.email,
            avatarUrl: '',
            role: req.user!.role || 'user',
            plan: 'free',
            creditsRemaining: wallet.available,
            creditsMax: wallet.available,
            creditsReserved: wallet.reserved,
            isAuthenticated: true,
          },
        });
      }

      return res.json({
        profile: {
          id: uid,
          name: userDoc.displayName || userDoc.name || 'Usuário',
          email: userDoc.email || req.user!.email,
          avatarUrl: userDoc.avatarUrl || '',
          role: userDoc.role || 'user',
          plan: userDoc.plan || 'free',
          creditsRemaining: wallet.available,
          creditsMax: wallet.available,
          creditsReserved: wallet.reserved,
          isAuthenticated: true,
        },
      });
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'profile_fetch_failed',
          message: 'Erro ao buscar perfil do usuario.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  app.post('/api/users/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email;
      const { displayName } = req.body;

      const wallet = await CreditWalletService.getBalance(uid);

      let userProfile = {
        id: uid,
        uid,
        email,
        displayName: displayName || (email ? email.split('@')[0] : 'Usuário'),
        name: displayName || (email ? email.split('@')[0] : 'Usuário'),
        role: 'user' as const,
        plan: 'free' as const,
        creditsRemaining: wallet.available,
        creditsMax: wallet.available,
        creditsReserved: wallet.reserved,
        isAuthenticated: true,
      };

      if (isFirebaseAdminConfigured()) {
        const userRef = adminDb.collection('users').doc(uid);
        const docSnap = await userRef.get();

        if (docSnap.exists) {
          const existingData = docSnap.data();
          userProfile = {
            id: uid,
            uid,
            email: existingData?.email || email,
            displayName: existingData?.displayName || existingData?.name || displayName,
            name: existingData?.displayName || existingData?.name || displayName,
            role: existingData?.role || 'user',
            plan: existingData?.plan || 'free',
            creditsRemaining: wallet.available,
            creditsMax: wallet.available,
            creditsReserved: wallet.reserved,
            isAuthenticated: true,
          };
        } else {
          const now = new Date();
          await userRef.set({
            uid,
            email,
            displayName: userProfile.displayName,
            role: 'user',
            plan: 'free',
            creditsAvailable: 0,
            creditsRemaining: 0,
            creditsReserved: 0,
            creditsPurchased: 0,
            creditsConsumed: 0,
            creditsRefunded: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      return res.json({ profile: userProfile });
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'profile_update_failed',
          message: 'Erro ao criar ou atualizar perfil.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // List Active Credit Packages
  app.get('/api/credits/packages', (req: AuthenticatedRequest, res) => {
    const packages = CREDIT_PACKAGES.filter((p) => p.active).map((p) => ({
      id: p.id,
      name: p.name,
      credits: p.credits,
      bonusCredits: p.bonusCredits,
      totalCredits: p.totalCredits,
      priceBrl: p.priceBrl,
      description: p.description,
      badge: p.badge,
      popular: p.popular,
      features: p.features,
    }));
    res.json({ packages });
  });

  // Protected: Wallet Balance
  app.get('/api/wallet', requireAuth, walletLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const balance = await CreditWalletService.getBalance(req.user!.uid);
      res.json(balance);
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'wallet_balance_failed',
          message: 'Erro ao obter saldo da carteira.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // Protected: Wallet Transaction History
  app.get('/api/wallet/transactions', requireAuth, walletLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const limit = Math.min(Number(req.query.limit || 20), 100);

      const snap = await adminDb
        .collection('credit_transactions')
        .where('userId', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      const transactions = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          type: d.type,
          amount: d.amount,
          balanceBefore: d.balanceBefore,
          balanceAfter: d.balanceAfter,
          operation: d.operation,
          status: d.status,
          createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : new Date(d.createdAt).toISOString()) : new Date().toISOString(),
        };
      });

      res.json({ transactions });
    } catch (err: any) {
      console.error('Erro ao buscar extrato de transacoes:', err);
      res.status(500).json({
        error: {
          code: 'wallet_history_failed',
          message: 'Erro ao obter extrato de transacoes.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // Protected: Create Checkout (Pix via Mercado Pago)
  app.post('/api/payments/checkout', requireAuth, checkoutLimiter, requireFeatureFlag('payment_checkout'), async (req: AuthenticatedRequest, res) => {
    try {
      const parseResult = CheckoutInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: {
            code: 'invalid_checkout_input',
            message: parseResult.error.issues[0]?.message || 'Dados de entrada invalidos.',
            correlationId: req.correlationId,
          },
        });
      }

      const { packageId } = parseResult.data;
      const pkg = getCreditPackageById(packageId);

      if (!pkg) {
        return res.status(404).json({
          error: {
            code: 'package_not_found',
            message: 'Pacote de creditos invalido ou inativo.',
            correlationId: req.correlationId,
          },
        });
      }

      if (!MercadoPagoService.isConfigured()) {
        return res.status(503).json({
          error: {
            code: 'payment_provider_unavailable',
            message: 'Servico do Mercado Pago nao configurado no servidor.',
            correlationId: req.correlationId,
          },
        });
      }

      const uid = req.user!.uid;
      const userEmail = req.user!.email || 'cliente@froc.ia';

      // Internal Document ID and Idempotency Key
      const paymentRef = adminDb.collection('payments').doc();
      const paymentDocumentId = paymentRef.id;
      const externalReference = `froc-payment-${paymentDocumentId}`;
      const idempotencyKey = `chk-${paymentDocumentId}`;

      // Save initial internal state in Firestore with package snapshot
      await paymentRef.set({
        provider: 'mercadopago',
        providerPaymentId: null,
        providerPreferenceId: null,
        externalReference,
        userId: uid,
        packageSnapshot: {
          packageId: pkg.id,
          packageName: pkg.name,
          priceBrl: pkg.priceBrl,
          baseCredits: pkg.credits,
          bonusCredits: pkg.bonusCredits,
          totalCredits: pkg.totalCredits,
        },
        packageId: pkg.id,
        packageName: pkg.name,
        amountBrl: pkg.priceBrl,
        currency: 'BRL',
        baseCredits: pkg.credits,
        bonusCredits: pkg.bonusCredits,
        totalCredits: pkg.totalCredits,
        status: 'creating',
        liveMode: null,
        credited: false,
        creditedAt: null,
        refundedCredits: false,
        refundedAt: null,
        idempotencyKey,
        checkoutUrl: null,
        qrCode: null,
        qrCodeBase64: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      try {
        // Call Mercado Pago API
        const mpResult = await MercadoPagoService.createPixPayment({
          userId: uid,
          packageId: pkg.id,
          packageName: pkg.name,
          amountBrl: pkg.priceBrl,
          userEmail,
          externalReference,
          idempotencyKey,
        });

        // Update Firestore document with provider details
        await paymentRef.update({
          providerPaymentId: mpResult.providerPaymentId,
          status: mpResult.status || 'pending',
          liveMode: mpResult.liveMode ?? null,
          qrCode: mpResult.qrCode || null,
          qrCodeBase64: mpResult.qrCodeBase64 || null,
          checkoutUrl: mpResult.ticketUrl || null,
          expiresAt: mpResult.expiresAt || null,
          updatedAt: FieldValue.serverTimestamp(),
        });

        return res.json({
          paymentDocumentId,
          providerPaymentId: mpResult.providerPaymentId,
          status: mpResult.status || 'pending',
          qrCode: mpResult.qrCode,
          qrCodeBase64: mpResult.qrCodeBase64,
          checkoutUrl: mpResult.ticketUrl,
          expiresAt: mpResult.expiresAt,
          totalCredits: pkg.totalCredits,
          amountBrl: pkg.priceBrl,
          packageName: pkg.name,
          correlationId: req.correlationId,
        });
      } catch (mpErr: any) {
        await paymentRef.update({
          status: 'creation_failed',
          updatedAt: FieldValue.serverTimestamp(),
        });
        throw mpErr;
      }
    } catch (err: any) {
      console.error('❌ Erro no Checkout Mercado Pago:', err);
      const isConfigError = err instanceof PaymentProviderConfigurationError;
      res.status(isConfigError ? 503 : 500).json({
        error: {
          code: isConfigError ? 'payment_provider_unconfigured' : 'checkout_processing_error',
          message: err.message || 'Nao foi possivel iniciar o pagamento neste momento.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // Public Webhook: Mercado Pago Webhook Handler
  app.post('/api/payments/webhook', async (req: AuthenticatedRequest, res) => {
    try {
      const xSignature = req.headers['x-signature'] as string | undefined;
      const xRequestId = req.headers['x-request-id'] as string | undefined;

      const body = req.body || {};
      const query = req.query || {};

      const dataId = String(body.data?.id || query['data.id'] || query.id || body.id || '');
      const action = String(body.action || query.action || '');
      const type = String(body.type || query.type || '');

      // RULE 2 & 3: Validate HMAC Signature with NO bypass
      const isSignatureValid = MercadoPagoService.verifyWebhookSignature({
        xSignature,
        xRequestId,
        dataId,
      });

      const eventKeySeed = `mp:${dataId}:${action}:${xRequestId || 'none'}`;
      const eventDocId = crypto.createHash('sha256').update(eventKeySeed).digest('hex');
      const eventRef = adminDb.collection('payment_events').doc(eventDocId);

      await eventRef.set({
        provider: 'mercadopago',
        providerEventId: dataId || null,
        providerPaymentId: dataId || null,
        action,
        type,
        requestId: xRequestId || null,
        signatureValidated: isSignatureValid,
        processingStatus: isSignatureValid ? 'received' : 'failed',
        resultCode: isSignatureValid ? 'received' : 'invalid_signature',
        correlationId: req.correlationId,
        receivedAt: FieldValue.serverTimestamp(),
      });

      if (!isSignatureValid) {
        console.warn(`⚠️ Webhook rejeitado por assinatura HMAC invalida. CorrelationId: ${req.correlationId}`);
        return res.status(401).json({
          error: {
            code: 'invalid_webhook_signature',
            message: 'Assinatura do webhook ausente ou invalida.',
            correlationId: req.correlationId,
          },
        });
      }

      if (!dataId) {
        await eventRef.update({ processingStatus: 'ignored', resultCode: 'missing_data_id' });
        return res.status(200).send('OK');
      }

      // Query official Mercado Pago payment status
      let mpPayment: any;
      try {
        mpPayment = await MercadoPagoService.getPaymentById(dataId);
      } catch (mpErr: any) {
        await eventRef.update({ processingStatus: 'failed', resultCode: 'mp_query_failed' });
        return res.status(503).json({ error: 'Erro ao consultar cobranca oficial.' });
      }

      // Find matching payment document in Firestore
      let paymentSnap = await adminDb
        .collection('payments')
        .where('providerPaymentId', '==', dataId)
        .limit(1)
        .get();

      if (paymentSnap.empty && mpPayment.externalReference) {
        const paymentDocId = mpPayment.externalReference.replace('froc-payment-', '');
        const directDoc = await adminDb.collection('payments').doc(paymentDocId).get();
        if (directDoc.exists) {
          paymentSnap = { empty: false, docs: [directDoc] } as any;
        }
      }

      if (paymentSnap.empty) {
        await eventRef.update({ processingStatus: 'ignored', resultCode: 'payment_doc_not_found' });
        return res.status(200).send('OK');
      }

      const paymentDoc = paymentSnap.docs[0];
      const paymentData = paymentDoc.data();
      const paymentDocumentId = paymentDoc.id;

      // Validate official payment details match internal snapshot exactly
      if (
        paymentData.amountBrl !== mpPayment.transactionAmount ||
        mpPayment.currencyId !== 'BRL' ||
        paymentData.externalReference !== mpPayment.externalReference
      ) {
        await eventRef.update({ processingStatus: 'failed', resultCode: 'mismatched_amount_or_currency' });

        // Record reconciliation case
        await adminDb.collection('financial_reconciliation_cases').add({
          userId: paymentData.userId,
          paymentDocumentId,
          providerPaymentId: dataId,
          reason: 'amount_mismatch',
          amountBrl: mpPayment.transactionAmount,
          creditsOriginallyGranted: 0,
          status: 'open',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return res.status(400).json({ error: 'Divergencia de valor ou referencia.' });
      }

      // Handle official payment status
      if (mpPayment.status === 'approved') {
        if (!paymentData.credited) {
          const creditIdempotencyKey = `credit-${paymentDocumentId}`;
          await CreditWalletService.creditPurchase({
            userId: paymentData.userId,
            paymentDocumentId,
            providerPaymentId: dataId,
            baseCredits: paymentData.baseCredits,
            bonusCredits: paymentData.bonusCredits,
            amountBrl: paymentData.amountBrl,
            idempotencyKey: creditIdempotencyKey,
          });
          await eventRef.update({ processingStatus: 'processed', resultCode: 'approved_and_credited' });
        } else {
          await eventRef.update({ processingStatus: 'duplicate', resultCode: 'already_credited_idempotent' });
        }
      } else if (mpPayment.status === 'refunded' || mpPayment.status === 'charged_back') {
        await paymentDoc.ref.update({
          status: mpPayment.status,
          updatedAt: FieldValue.serverTimestamp(),
        });

        await adminDb.collection('financial_reconciliation_cases').add({
          userId: paymentData.userId,
          paymentDocumentId,
          providerPaymentId: dataId,
          reason: mpPayment.status === 'refunded' ? 'refund' : 'chargeback',
          amountBrl: mpPayment.transactionAmount,
          creditsOriginallyGranted: paymentData.totalCredits,
          status: 'open',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        await eventRef.update({ processingStatus: 'processed', resultCode: `recorded_${mpPayment.status}` });
      } else {
        await paymentDoc.ref.update({
          status: mpPayment.status,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await eventRef.update({ processingStatus: 'processed', resultCode: `status_updated_${mpPayment.status}` });
      }

      return res.status(200).send('OK');
    } catch (err: any) {
      console.error('❌ Erro no processamento do Webhook Mercado Pago:', err);
      return res.status(500).json({
        error: {
          code: 'webhook_processing_failed',
          message: 'Erro interno no processamento do webhook.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // Protected: Check Payment Status
  app.get('/api/payments/:paymentDocumentId', requireAuth, walletLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const { paymentDocumentId } = req.params;
      const paymentRef = adminDb.collection('payments').doc(paymentDocumentId);
      const snap = await paymentRef.get();

      if (!snap.exists) {
        return res.status(404).json({
          error: {
            code: 'payment_not_found',
            message: 'Pagamento nao encontrado.',
            correlationId: req.correlationId,
          },
        });
      }

      const d = snap.data() || {};
      if (d.userId !== req.user!.uid && req.user!.role !== 'admin') {
        return res.status(403).json({
          error: {
            code: 'access_denied',
            message: 'Acesso nao autorizado a este pagamento.',
            correlationId: req.correlationId,
          },
        });
      }

      // If pending, check Mercado Pago directly
      if (d.status === 'pending' && d.providerPaymentId && MercadoPagoService.isConfigured()) {
        try {
          const mpPayment = await MercadoPagoService.getPaymentById(d.providerPaymentId);
          if (mpPayment.status === 'approved' && !d.credited) {
            await CreditWalletService.creditPurchase({
              userId: d.userId,
              paymentDocumentId,
              providerPaymentId: d.providerPaymentId,
              baseCredits: d.baseCredits,
              bonusCredits: d.bonusCredits,
              amountBrl: d.amountBrl,
              idempotencyKey: `credit-${paymentDocumentId}`,
            });
            const fresh = (await paymentRef.get()).data() || {};
            d.status = fresh.status || 'approved';
            d.credited = fresh.credited ?? true;
          } else if (mpPayment.status !== d.status) {
            await paymentRef.update({ status: mpPayment.status, updatedAt: FieldValue.serverTimestamp() });
            d.status = mpPayment.status;
          }
        } catch (mpErr) {
          console.warn('Erro ao consultar Mercado Pago em tempo real:', mpErr);
        }
      }

      res.json({
        paymentDocumentId: snap.id,
        status: d.status,
        amountBrl: d.amountBrl,
        totalCredits: d.totalCredits,
        packageName: d.packageName,
        qrCode: d.qrCode,
        qrCodeBase64: d.qrCodeBase64,
        checkoutUrl: d.checkoutUrl,
        credited: d.credited,
        correlationId: req.correlationId,
        createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : new Date(d.createdAt).toISOString()) : new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'payment_status_check_failed',
          message: 'Erro ao consultar status do pagamento.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // Protected: User Payment History
  app.get('/api/payments', requireAuth, walletLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const limit = Math.min(Number(req.query.limit || 20), 100);

      const snap = await adminDb
        .collection('payments')
        .where('userId', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      const payments = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          packageName: d.packageName,
          amountBrl: d.amountBrl,
          totalCredits: d.totalCredits,
          status: d.status,
          credited: d.credited,
          createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : new Date(d.createdAt).toISOString()) : new Date().toISOString(),
        };
      });

      res.json({ payments });
    } catch (err: any) {
      console.error('Erro ao consultar historico de pagamentos:', err);
      res.status(500).json({
        error: {
          code: 'payment_history_failed',
          message: 'Erro ao buscar historico de pagamentos.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // API Route: Generate Website (Protected & Credit Deducted: 200 Credits)
  app.post('/api/generate-site', requireAuth, requireFeatureFlag('ai_chat'), async (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;
    const SITE_COST = 200;
    const idempotencyKey = req.body.idempotencyKey || `gen-${uid}-${Date.now()}`;

    try {
      const {
        prompt,
        category = 'General',
        colorPalette = 'Modern Blue',
        tone = 'Professional',
        features = [],
        language = 'pt-BR',
        modelName = 'gemini-3.6-flash'
      } = req.body;

      if (!prompt) {
        return res.status(400).json({
          error: {
            code: 'missing_prompt',
            message: 'O prompt do site e obrigatorio.',
            correlationId: req.correlationId,
          },
        });
      }

      const reserveResult = await CreditWalletService.reserveCredits({
        userId: uid,
        amount: SITE_COST,
        operation: 'Reserva para Generacao de Site Completo com IA (200 creditos)',
        idempotencyKey,
      });

      try {
        const ai = getGeminiClient();

        const systemInstruction = `Voce e o froc.ia, o motor de Inteligencia Artificial especialista em design, front-end e criacao de sites modernos, responsivos e de altissima conversao.
Responda estritamente em formato JSON valido.`;

        const userMessage = `Crie o site para o seguinte projeto/negocio: "${prompt}". Categoria: ${category}. Paleta: ${colorPalette}.`;

        const response = await ai.models.generateContent({
          model: modelName,
          contents: userMessage,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.7,
          },
        });

        const responseText = response.text || '';
        const parsedData = JSON.parse(responseText);

        await CreditWalletService.confirmConsumption({
          userId: uid,
          reservationId: reserveResult.reservationId,
          amountConsumed: SITE_COST,
          operation: 'Generacao de Site Completo com IA (200 creditos)',
          idempotencyKey,
        });

        res.json(parsedData);
      } catch (aiErr: any) {
        await CreditWalletService.releaseReservation({
          userId: uid,
          reservationId: reserveResult.reservationId,
          operation: 'Estorno por falha na generacao do site',
          idempotencyKey,
        });
        throw aiErr;
      }
    } catch (error: any) {
      console.error('Erro ao gerar site com froc.ia:', error);
      const isInsufficient = error instanceof InsufficientCreditsError;
      res.status(isInsufficient ? 402 : 500).json({
        error: {
          code: isInsufficient ? 'insufficient_credits' : 'ai_generation_error',
          message: error.message || 'Erro ao comunicar com a inteligência artificial froc.ia.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // Legacy AI Route: Refine Site
  app.post('/api/refine-site', requireAuth, requireFeatureFlag('ai_chat'), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await AIExecutionService.execute(
        {
          userId: req.user!.uid,
          mode: 'site-builder',
          prompt: req.body.instructions || req.body.prompt || 'Refine o site atual',
          responseFormat: 'json',
          idempotencyKey: req.body.idempotencyKey,
        },
        req.correlationId
      );
      try {
        const parsed = JSON.parse(result.text);
        return res.json(parsed);
      } catch {
        return res.json({ resultText: result.text, consumedCredits: result.consumedCredits });
      }
    } catch (err: any) {
      const isInsufficient = err instanceof InsufficientCreditsError;
      return res.status(isInsufficient ? 402 : 500).json({
        error: {
          code: isInsufficient ? 'insufficient_credits' : 'ai_refine_failed',
          message: err.message || 'Erro ao refinar site com froc.ia.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // Legacy AI Route: AI Chat
  app.post('/api/ai-chat', requireAuth, requireFeatureFlag('ai_chat'), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await AIExecutionService.execute(
        {
          userId: req.user!.uid,
          mode: req.body.mode || 'smart',
          prompt: req.body.message || req.body.prompt,
          conversationId: req.body.conversationId,
          idempotencyKey: req.body.idempotencyKey,
        },
        req.correlationId
      );
      return res.json({
        response: result.text,
        text: result.text,
        modelUsed: result.modelUsed,
        consumedCredits: result.consumedCredits,
        citations: result.citations,
      });
    } catch (err: any) {
      const isInsufficient = err instanceof InsufficientCreditsError;
      return res.status(isInsufficient ? 402 : 500).json({
        error: {
          code: isInsufficient ? 'insufficient_credits' : 'ai_chat_failed',
          message: err.message || 'Erro no chat froc.ia.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // Legacy AI Route: Chat Assistant
  app.post('/api/chat/assistant', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await AIExecutionService.execute(
        {
          userId: req.user!.uid,
          mode: 'smart',
          prompt: req.body.message || req.body.prompt,
          idempotencyKey: req.body.idempotencyKey,
        },
        req.correlationId
      );
      return res.json({
        reply: result.text,
        consumedCredits: result.consumedCredits,
      });
    } catch (err: any) {
      const isInsufficient = err instanceof InsufficientCreditsError;
      return res.status(isInsufficient ? 402 : 500).json({
        error: {
          code: isInsufficient ? 'insufficient_credits' : 'assistant_failed',
          message: err.message || 'Erro no assistente froc.ia.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // Admin Dashboard Overview (Real Firestore Aggregations)
  app.get('/api/admin/dashboard/overview', requireAuth, requireAdmin, adminLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      if (!isFirebaseAdminConfigured()) {
        return res.json({
          status: 'unavailable',
          reason: 'firebase_admin_not_configured',
        });
      }

      const usersSnap = await adminDb.collection('users').count().get();
      const totalUsers = usersSnap.data().count;

      const paymentsApprovedSnap = await adminDb
        .collection('payments')
        .where('status', '==', 'approved')
        .get();

      let totalRevenueBrl = 0;
      let totalCreditsSold = 0;
      let approvedPaymentsCount = paymentsApprovedSnap.docs.length;

      paymentsApprovedSnap.docs.forEach((doc) => {
        const d = doc.data();
        totalRevenueBrl += Number(d.amountBrl || 0);
        totalCreditsSold += Number(d.totalCredits || 0);
      });

      const paymentsCreatedSnap = await adminDb.collection('payments').count().get();
      const totalPaymentsCreated = paymentsCreatedSnap.data().count;

      const eventsSnap = await adminDb.collection('payment_events').count().get();
      const totalWebhookEvents = eventsSnap.data().count;

      res.json({
        timestamp: new Date().toISOString(),
        usersCount: totalUsers,
        totalRevenueBrl,
        totalCreditsSold,
        approvedPaymentsCount,
        totalPaymentsCreated,
        totalWebhookEvents,
        dataSource: 'Real Firestore Aggregations',
        correlationId: req.correlationId,
      });
    } catch (err: any) {
      console.error('Erro ao agregar metricas do painel administrativo:', err);
      res.status(500).json({
        error: {
          code: 'admin_metrics_failed',
          message: 'Erro ao calcular metricas administrativas.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  // Admin Manual Credit Grant
  app.post('/api/admin/grant-credits', requireAuth, requireAdmin, adminLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const parseResult = AdminGrantCreditsInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: {
            code: 'invalid_grant_input',
            message: parseResult.error.issues[0]?.message || 'Parametros invalidos.',
            correlationId: req.correlationId,
          },
        });
      }

      const { userEmail, userId, amount, reason, idempotencyKey: providedKey } = parseResult.data;
      let targetUid = userId || '';

      if (!targetUid && userEmail) {
        const snap = await adminDb
          .collection('users')
          .where('email', '==', userEmail.toLowerCase())
          .limit(1)
          .get();

        if (!snap.empty) {
          targetUid = snap.docs[0].id;
        } else {
          try {
            const fbUser = await adminAuth.getUserByEmail(userEmail);
            targetUid = fbUser.uid;
          } catch (authErr) {
            return res.status(404).json({
              error: {
                code: 'user_not_found',
                message: `Usuario com e-mail ${userEmail} nao foi localizado.`,
                correlationId: req.correlationId,
              },
            });
          }
        }
      }

      if (!targetUid) {
        return res.status(400).json({
          error: {
            code: 'target_user_unresolved',
            message: 'Nao foi possivel determinar o usuario de destino.',
            correlationId: req.correlationId,
          },
        });
      }

      const idempotencyKey = providedKey || `grant-${targetUid}-${amount}-${Date.now()}`;
      const result = await CreditWalletService.grantCreditsByAdmin({
        adminUid: req.user!.uid,
        targetUserId: targetUid,
        amount,
        reason,
        idempotencyKey,
      });

      return res.json({
        success: true,
        targetUserId: targetUid,
        amountGranted: amount,
        reason,
        availableAfter: result.availableAfter,
        correlationId: req.correlationId,
      });
    } catch (err: any) {
      console.error('Erro na concessao administrativa de creditos:', err);
      res.status(500).json({
        error: {
          code: 'admin_grant_failed',
          message: err.message || 'Erro ao conceder creditos.',
          correlationId: req.correlationId,
        },
      });
    }
  });

    // Frontend local. Na Vercel, esta aplicação atende somente as rotas /api.
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const require = createRequire(import.meta.url);
    const vitePackageName = ['vi', 'te'].join('');
    const { createServer: createViteServer } = require(
      vitePackageName
    ) as typeof import('vite');

    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

let appPromise: ReturnType<typeof createApp> | undefined;

export function getApp() {
  appPromise ??= createApp();
  return appPromise;
}

async function startLocalServer() {
  const app = await getApp();
  const PORT = Number(env.PORT) || 3000;

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`⚠️ Recebido sinal ${signal}. Iniciando encerramento gracioso do servidor...`);

    server.close(() => {
      console.log('✅ Servidor HTTP encerrado com sucesso.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('❌ Encerramento forçado por timeout de 10 segundos.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
  });
}

if (!process.env.VERCEL) {
  startLocalServer().catch((error) => {
    console.error('❌ Falha ao iniciar servidor local:', error);
    process.exit(1);
  });
}