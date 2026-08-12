import express, {
  NextFunction,
  Request,
  Response
} from 'express';
import path from 'path';
import fs from 'fs';
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


import { UserAdminService } from './server/services/userAdminService.js';


import {
  MercadoPagoService,
  PaymentProviderConfigurationError,
  PaymentCreationError,
  PaymentValidationError
} from './server/services/mercadoPagoService.js';
import {
  CheckoutInputSchema,
  AdminGrantCreditsInputSchema,
  CardPaymentInputSchema
} from './server/validators/paymentValidators.js';
import { AggregateField, FieldValue } from 'firebase-admin/firestore';
import { env } from './server/config/env.js';
import { internalRouter } from './server/routes/internalRoutes.js';
import { conversationRouter } from './server/routes/conversationRoutes.js';
import { memoryRouter } from './server/routes/memoryRoutes.js';
import { knowledgeRouter } from './server/routes/knowledgeRoutes.js';
import { adminAiRouter } from './server/routes/adminAiRoutes.js';
import { projectRouter } from './server/routes/projectRoutes.js';
import { siteBuilderRouter } from './server/routes/siteBuilderRoutes.js';
import { healthRouter } from './server/routes/healthRoutes.js';
import { capabilityRouter } from './server/routes/capabilityRoutes.js';
import { selfEvolutionRouter } from './server/routes/selfEvolutionRoutes.js';
import { mediaRouter } from './server/routes/mediaRoutes.js';
import { deployRouter } from './server/routes/deployRoutes.js';


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
  // Portable backups can reach 12 MB. Keep the larger parser restricted to
  // the two authenticated disaster-recovery endpoints; all other JSON stays
  // capped at 2 MB.
  app.use(
    [
      '/api/admin/disaster-recovery/validate',
      '/api/admin/disaster-recovery/restore'
    ],
    express.json({ limit: '14mb' })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(correlationIdMiddleware);

  // Mount Sub-routers
  app.use('/api', healthRouter);
  app.use('/api', capabilityRouter);
  app.use('/api/internal', internalRouter);
  app.use('/api/conversations', conversationRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/memories', memoryRouter);
  app.use('/api', knowledgeRouter);
  app.use('/api', siteBuilderRouter);

  app.use('/api/admin/ai', adminAiRouter);
  app.use('/api/admin/self-evolution', selfEvolutionRouter);
  app.use('/api/admin/feature-flags', featureFlagRouter);
  app.use('/api/admin/disaster-recovery', portableRecoveryRouter);
  app.use('/api/imports', externalImportRouter);
  app.use(
    '/api/ai',
    requireFeatureFlag('ai_chat'),
    aiRouter
  );
  app.use('/api/ai/media', mediaRouter);
  app.use('/api/deploy', deployRouter);

  // Rate Limiters
  const checkoutLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: 'checkout' });
  const adminLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, keyPrefix: 'admin' });
  const walletLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, keyPrefix: 'wallet' });

  // Initialize Gemini Client safely

  // User Profile Routes
  app.get('/api/users/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;

      if (!isFirebaseAdminConfigured() || !adminDb) {
        return res.status(503).json({
          error: {
            code: 'database_unavailable',
            message: 'Banco de dados temporariamente indisponível no servidor.',
            correlationId: req.correlationId,
          },
        });
      }

      const provisionResult = await CreditWalletService.provisionUserWithWelcomeCredits({
        userId: uid,
        email: req.user!.email || '',
        displayName: req.user!.name || (req.user!.email ? req.user!.email.split('@')[0] : 'Usuário'),
        avatarUrl: req.user!.picture || '',
        role: req.user!.role || 'user',
      });

      const wallet = await CreditWalletService.getBalance(uid);
      const userRef = adminDb.collection('users').doc(uid);
      const docSnap = await userRef.get();
      const userDoc = docSnap.exists ? (docSnap.data() || {}) : {};

      return res.json({
        profile: {
          id: uid,
          uid,
          name: userDoc.displayName || userDoc.name || provisionResult.profile.displayName,
          email: userDoc.email || req.user!.email,
          avatarUrl: userDoc.avatarUrl || req.user!.picture || '',
          role: userDoc.role || 'user',
          plan: userDoc.plan || 'Inicial',
          creditsRemaining: wallet.available,
          creditsMax: userDoc.creditsAvailable || wallet.available,
          creditsReserved: wallet.reserved,
          isAuthenticated: true,
          emailVerified: req.user!.emailVerified === true,
        },
      });
    } catch (err: any) {
      console.error('❌ Error in GET /api/users/me:', err);
      if (err.name === 'WalletUnavailableError') {
        return res.status(503).json({
          error: {
            code: 'wallet_unavailable',
            message: err.message,
            correlationId: req.correlationId,
          },
        });
      }
      res.status(500).json({
        error: {
          code: 'profile_fetch_failed',
          message: 'Erro ao buscar perfil do usuário.',
          correlationId: req.correlationId,
        },
      });
    }
  });

  app.post('/api/users/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email;
      let { displayName, avatarUrl } = req.body;

      if (!isFirebaseAdminConfigured() || !adminDb) {
        return res.status(503).json({
          error: {
            code: 'database_unavailable',
            message: 'Banco de dados temporariamente indisponível no servidor.',
            correlationId: req.correlationId,
          },
        });
      }

      if (displayName !== undefined && displayName !== null) {
        if (typeof displayName !== 'string') {
          return res.status(400).json({
            error: { code: 'invalid_profile_input', message: 'O nome de exibição deve ser um texto.', correlationId: req.correlationId }
          });
        }
        displayName = displayName.replace(/[\x00-\x1F\x7F]/g, '').trim();
        if (displayName.length < 2 || displayName.length > 80) {
          return res.status(400).json({
            error: { code: 'invalid_profile_input', message: 'O nome deve ter entre 2 e 80 caracteres.', correlationId: req.correlationId }
          });
        }
      }

      if (avatarUrl !== undefined && avatarUrl !== null && avatarUrl !== '') {
        if (typeof avatarUrl !== 'string') {
          return res.status(400).json({
            error: { code: 'invalid_profile_input', message: 'A URL do avatar deve ser um texto.', correlationId: req.correlationId }
          });
        }
        avatarUrl = avatarUrl.trim();
        if (avatarUrl.length > 2048) {
          return res.status(400).json({
            error: { code: 'invalid_profile_input', message: 'A URL do avatar excede o limite de 2048 caracteres.', correlationId: req.correlationId }
          });
        }
        if (!avatarUrl.startsWith('https://')) {
          return res.status(400).json({
            error: { code: 'invalid_profile_input', message: 'A URL do avatar deve utilizar o protocolo HTTPS.', correlationId: req.correlationId }
          });
        }
      } else {
        avatarUrl = '';
      }

      await CreditWalletService.provisionUserWithWelcomeCredits({
        userId: uid,
        email: email || '',
        displayName: displayName || req.user!.name || (email ? email.split('@')[0] : 'Usuário'),
        avatarUrl: avatarUrl || req.user!.picture || '',
        role: req.user!.role || 'user',
      });

      const wallet = await CreditWalletService.getBalance(uid);
      const userRef = adminDb.collection('users').doc(uid);
      const docSnap = await userRef.get();

      let finalDisplayName = displayName || (email ? email.split('@')[0] : 'Usuário');
      let finalAvatarUrl = avatarUrl || req.user!.picture || '';

      if (docSnap.exists) {
        const existingData = docSnap.data() || {};
        finalDisplayName = displayName || existingData.displayName || existingData.name || finalDisplayName;
        finalAvatarUrl = avatarUrl !== undefined ? avatarUrl : (existingData.avatarUrl || finalAvatarUrl);

        await userRef.update({
          displayName: finalDisplayName,
          name: finalDisplayName,
          avatarUrl: finalAvatarUrl,
          updatedAt: new Date(),
        });

        return res.json({
          profile: {
            id: uid,
            uid,
            name: finalDisplayName,
            email: existingData.email || email,
            avatarUrl: finalAvatarUrl,
            role: existingData.role || 'user',
            plan: existingData.plan || 'Inicial',
            creditsRemaining: wallet.available,
            creditsMax: existingData.creditsAvailable || wallet.available,
            creditsReserved: wallet.reserved,
            isAuthenticated: true,
            emailVerified: req.user!.emailVerified === true,
          },
        });
      } else {
        const profileToSave = {
          uid,
          email: email || '',
          displayName: finalDisplayName,
          name: finalDisplayName,
          avatarUrl: finalAvatarUrl,
          role: req.user!.role || 'user',
          plan: 'Inicial',
          planId: 'plan_inicial',
          creditsAvailable: wallet.available,
          creditsRemaining: wallet.available,
          creditsReserved: wallet.reserved,
          welcomeCredited: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await userRef.set(profileToSave, { merge: true });

        return res.json({
          profile: {
            id: uid,
            uid,
            name: finalDisplayName,
            email: email || '',
            avatarUrl: finalAvatarUrl,
            role: req.user!.role || 'user',
            plan: 'Inicial',
            creditsRemaining: wallet.available,
            creditsMax: wallet.available,
            creditsReserved: wallet.reserved,
            isAuthenticated: true,
            emailVerified: req.user!.emailVerified === true,
          },
        });
      }
    } catch (err: any) {
      console.error('❌ Error in POST /api/users/profile:', err);
      if (err.name === 'WalletUnavailableError') {
        return res.status(503).json({
          error: {
            code: 'wallet_unavailable',
            message: err.message,
            correlationId: req.correlationId,
          },
        });
      }
      res.status(500).json({
        error: {
          code: 'profile_update_failed',
          message: 'Erro ao atualizar perfil.',
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
      if (!isFirebaseAdminConfigured() || !adminDb) {
        return res.status(503).json({
          error: {
            code: 'database_unavailable',
            message: 'Banco de dados temporariamente indisponível no servidor.',
            correlationId: req.correlationId,
          },
        });
      }
      const balance = await CreditWalletService.getBalance(req.user!.uid);
      res.json(balance);
    } catch (err: any) {
      if (err.name === 'WalletUnavailableError') {
        return res.status(503).json({
          error: {
            code: 'wallet_unavailable',
            message: err.message || 'Serviço de carteira indisponível.',
            correlationId: req.correlationId,
          },
        });
      }
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
      if (!isFirebaseAdminConfigured() || !adminDb) {
        return res.status(503).json({
          error: {
            code: 'database_unavailable',
            message: 'Banco de dados temporariamente indisponível no servidor.',
            correlationId: req.correlationId,
          },
        });
      }
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
      if (err.name === 'WalletUnavailableError') {
        return res.status(503).json({
          error: {
            code: 'wallet_unavailable',
            message: err.message || 'Serviço de carteira indisponível.',
            correlationId: req.correlationId,
          },
        });
      }
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

  // Protected: Create Card Payment (Mercado Pago Credit Card)
  app.post('/api/payments/card', requireAuth, checkoutLimiter, requireFeatureFlag('payment_checkout'), async (req: AuthenticatedRequest, res) => {
    try {
      const parseResult = CardPaymentInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: {
            code: 'invalid_card_input',
            message: parseResult.error.issues[0]?.message || 'Dados do pagamento por cartão são inválidos.',
            details: parseResult.error.issues.map((issue) => issue.message),
            correlationId: req.correlationId,
          },
        });
      }

      const {
        token,
        issuerId: rawIssuerId,
        paymentMethodId,
        installments,
        packageId,
        idempotencyKey,
      } = parseResult.data;

      const issuerId = rawIssuerId === undefined
        ? undefined
        : String(rawIssuerId);

      const pkg = getCreditPackageById(packageId);
      if (!pkg) {
        return res.status(404).json({
          error: {
            code: 'package_not_found',
            message: 'Pacote de créditos inválido ou inativo.',
            correlationId: req.correlationId,
          },
        });
      }

      if (!MercadoPagoService.isConfigured()) {
        return res.status(503).json({
          error: {
            code: 'payment_provider_unavailable',
            message: 'Serviço de pagamentos não configurado no servidor.',
            correlationId: req.correlationId,
          },
        });
      }

      const uid = req.user!.uid;
      const userEmail = req.user!.email || 'cliente@froc.ia';

      // A deterministic document ID prevents duplicate charges when the same
      // client request is retried after a timeout or connection failure.
      const paymentDocumentId = crypto
        .createHash('sha256')
        .update(`card:${uid}:${idempotencyKey}`)
        .digest('hex');
      const paymentRef = adminDb.collection('payments').doc(paymentDocumentId);
      const externalReference = `froc-payment-${paymentDocumentId}`;

      const existingPayment = await paymentRef.get();
      if (existingPayment.exists) {
        const existing = existingPayment.data() || {};
        if (existing.providerPaymentId) {
          return res.json({
            success: true,
            reused: true,
            paymentDocumentId,
            providerPaymentId: existing.providerPaymentId,
            status: existing.status || 'pending',
            statusDetail: existing.statusDetail || null,
            totalCredits: existing.totalCredits,
            amountBrl: existing.amountBrl,
            packageName: existing.packageName,
            correlationId: req.correlationId,
          });
        }
      }

      if (!existingPayment.exists) {
        await paymentRef.create({
          provider: 'mercadopago',
          paymentType: 'credit_card',
          providerPaymentId: null,
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
          credited: false,
          refundedCredits: false,
          idempotencyKey,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const cardResult = await MercadoPagoService.createCardPayment({
        token,
        issuerId,
        paymentMethodId,
        installments: Number(installments),
        amountBrl: pkg.priceBrl,
        payerEmail: userEmail,
        description: `Froc.IA - ${pkg.name} (${pkg.totalCredits} créditos)`,
        externalReference,
        idempotencyKey,
      });

      await paymentRef.update({
        providerPaymentId: cardResult.providerPaymentId,
        status: cardResult.status || 'pending',
        statusDetail: cardResult.statusDetail || null,
        liveMode: cardResult.liveMode ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (cardResult.status === 'approved') {
        const creditIdempotencyKey = `credit-${paymentDocumentId}`;
        await CreditWalletService.creditPurchase({
          userId: uid,
          paymentDocumentId,
          providerPaymentId: cardResult.providerPaymentId,
          baseCredits: pkg.credits,
          bonusCredits: pkg.bonusCredits,
          amountBrl: pkg.priceBrl,
          idempotencyKey: creditIdempotencyKey,
        });
        await paymentRef.update({
          credited: true,
          creditedAt: FieldValue.serverTimestamp(),
        });
      }

      return res.json({
        success: true,
        paymentDocumentId,
        providerPaymentId: cardResult.providerPaymentId,
        status: cardResult.status,
        statusDetail: cardResult.statusDetail,
        totalCredits: pkg.totalCredits,
        amountBrl: pkg.priceBrl,
        packageName: pkg.name,
        correlationId: req.correlationId,
      });
    } catch (err: any) {
      console.error('❌ Erro no Pagamento por Cartão:', err);
      return res.status(500).json({
        error: {
          code: 'card_payment_failed',
          message: err.message || 'Erro ao processar pagamento por cartão.',
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

      // RULE 2 & 3: Validate HMAC Signature BEFORE writing any data to database
      const isSignatureValid = MercadoPagoService.verifyWebhookSignature({
        xSignature,
        xRequestId,
        dataId,
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
        signatureValidated: true,
        processingStatus: 'received',
        resultCode: 'received',
        correlationId: req.correlationId,
        receivedAt: FieldValue.serverTimestamp(),
      });

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
        const reversalReason = mpPayment.status === 'refunded'
          ? 'refund'
          : 'chargeback';

        const reversal = await CreditWalletService.reverseCreditPurchase({
          userId: paymentData.userId,
          paymentDocumentId,
          providerPaymentId: dataId,
          reason: reversalReason,
          idempotencyKey: `${reversalReason}-${paymentDocumentId}`,
        });

        if (reversal.outstandingCredits > 0) {
          const reconciliationId = crypto
            .createHash('sha256')
            .update(`reversal-debt:${paymentDocumentId}`)
            .digest('hex');

          await adminDb
            .collection('financial_reconciliation_cases')
            .doc(reconciliationId)
            .set({
              userId: paymentData.userId,
              paymentDocumentId,
              providerPaymentId: dataId,
              reason: reversalReason,
              amountBrl: mpPayment.transactionAmount,
              creditsOriginallyGranted: paymentData.totalCredits,
              creditsReversed: reversal.reversedCredits,
              outstandingCredits: reversal.outstandingCredits,
              status: 'open',
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }

        await eventRef.update({
          processingStatus: 'processed',
          resultCode: reversal.outstandingCredits > 0
            ? `reversed_with_debt_${mpPayment.status}`
            : `reversed_${mpPayment.status}`,
        });
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

      // Reconcile with Mercado Pago while the payment can still change state.
      if (
        d.providerPaymentId &&
        MercadoPagoService.isConfigured() &&
        !['refunded', 'charged_back', 'cancelled'].includes(d.status)
      ) {
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
          } else if (
            (mpPayment.status === 'refunded' || mpPayment.status === 'charged_back') &&
            d.credited &&
            !d.refundedCredits
          ) {
            const reversalReason = mpPayment.status === 'refunded'
              ? 'refund'
              : 'chargeback';

            const reversal = await CreditWalletService.reverseCreditPurchase({
              userId: d.userId,
              paymentDocumentId,
              providerPaymentId: d.providerPaymentId,
              reason: reversalReason,
              idempotencyKey: `${reversalReason}-${paymentDocumentId}`,
            });

            d.status = mpPayment.status;
            d.refundedCredits = true;
            d.outstandingCredits = reversal.outstandingCredits;
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

  // Note: /api/generate-site and /api/refine-site are handled by siteBuilderRouter


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
        .aggregate({
          approvedPaymentsCount: AggregateField.count(),
          totalRevenueBrl: AggregateField.sum('amountBrl'),
          totalCreditsSold: AggregateField.sum('totalCredits'),
        })
        .get();

      const approvedData = paymentsApprovedSnap.data();
      const approvedPaymentsCount = Number(approvedData.approvedPaymentsCount || 0);
      const totalRevenueBrl = Number(approvedData.totalRevenueBrl || 0);
      const totalCreditsSold = Number(approvedData.totalCreditsSold || 0);

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
      


let targetUid = '';

try {
  if (userId) {
    const canonicalUser = await adminAuth.getUser(userId);
    targetUid = canonicalUser.uid;
  } else if (userEmail) {
    const canonicalUser =
      await UserAdminService.resolveCanonicalUserByEmail(userEmail);

    targetUid = canonicalUser.uid;
  }
} catch {
  return res.status(404).json({
    error: {
      code: 'user_not_found',
      message: 'Usuario de destino nao foi localizado no Firebase Authentication.',
      correlationId: req.correlationId,
    },
  });
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

    // Serve technical SEO & asset files directly with correct Content-Type headers
    const servePublicFile = (filePath: string, contentType: string) => {
      return (req: Request, res: Response) => {
        const fullPath = path.resolve(process.cwd(), filePath);
        const distPath = path.resolve(process.cwd(), 'dist', path.basename(filePath));
        const targetPath = fs.existsSync(fullPath) ? fullPath : distPath;

        if (fs.existsSync(targetPath)) {
          res.setHeader('Content-Type', contentType);
          return res.status(200).sendFile(targetPath);
        }
        return res.status(404).send('File not found');
      };
    };

    app.get('/sitemap.xml', servePublicFile('public/sitemap.xml', 'application/xml; charset=utf-8'));
    app.get('/sitemap-index.xml', servePublicFile('public/sitemap-index.xml', 'application/xml; charset=utf-8'));
    app.get('/robots.txt', servePublicFile('public/robots.txt', 'text/plain; charset=utf-8'));
    app.get('/.well-known/assetlinks.json', servePublicFile('public/.well-known/assetlinks.json', 'application/json; charset=utf-8'));

    // Catch-all 404 handler for unknown /api routes
    app.all('/api/*', (req: Request, res: Response) => {
      return res.status(404).json({
        error: {
          code: 'api_route_not_found',
          message: `A rota de API '${req.path}' não foi encontrada.`,
          correlationId: (req as AuthenticatedRequest).correlationId,
        },
      });
    });

    // Frontend local. Na Vercel, esta aplicação atende somente as rotas /api.
    if (
  process.env.NODE_ENV !== 'production' &&
  process.env.NODE_ENV !== 'test' &&
  !process.env.VERCEL
) {
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
  } else if (
  process.env.NODE_ENV !== 'test' &&
  !process.env.VERCEL
) {
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
if (
  !process.env.VERCEL &&
  process.env.NODE_ENV !== 'test'
) {
  startLocalServer().catch((error) => {
    console.error('❌ Falha ao iniciar servidor local:', error);
    process.exit(1);
  });
}
