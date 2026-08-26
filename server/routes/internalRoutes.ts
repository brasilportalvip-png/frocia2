import { Router } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../types.js';
import { env } from '../config/env.js';
import { CreditWalletService } from '../services/creditWalletService.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { DurableExecutionService } from '../ai/durableExecutionService.js';

export const internalRouter = Router();

/**
 * Middleware verifying internal cron secret exclusively via x-cron-secret header
 * using timing-safe string comparison.
 */
const requireCronSecret = (req: AuthenticatedRequest, res: any, next: any) => {
  const secretHeader = req.headers['x-cron-secret'];
  
  if (typeof secretHeader !== 'string' || !secretHeader) {
    return res.status(401).json({
      error: {
        code: 'unauthorized_cron',
        message: 'Segredo de manutencao interna ausente ou invalido no cabeçalho x-cron-secret.',
        correlationId: req.correlationId,
      },
    });
  }

  const expectedSecret = env.INTERNAL_CRON_SECRET;
  
  const bufA = Buffer.from(secretHeader);
  const bufB = Buffer.from(expectedSecret);

  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return res.status(401).json({
      error: {
        code: 'unauthorized_cron',
        message: 'Segredo de manutencao interna ausente ou invalido no cabeçalho x-cron-secret.',
        correlationId: req.correlationId,
      },
    });
  }

  next();
};

/**
 * Internal route to expire stale credit reservations
 */
internalRouter.post('/wallet/expire-reservations', requireCronSecret, async (req: AuthenticatedRequest, res) => {
  try {
    if (!adminDb) {
      return res.json({ expiredCount: 0, reason: 'firebase_not_configured' });
    }

        const now = new Date();
    const MAX_RESERVATIONS_PER_RUN = 100;

    const snap = await adminDb
      .collection('credit_reservations')
      .where('status', '==', 'reserved')
      .where('expiresAt', '<=', now)
      .orderBy('expiresAt', 'asc')
      .limit(MAX_RESERVATIONS_PER_RUN)
      .get();

    let expiredCount = 0;
    const errors: any[] = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      const expiresAtMs = data.expiresAt
        ? data.expiresAt.toDate
          ? data.expiresAt.toDate().getTime()
          : new Date(data.expiresAt).getTime()
        : 0;

      if (expiresAtMs <= now.getTime()) {
        try {
          await CreditWalletService.expireReservation({
            userId: data.userId,
            reservationId: doc.id,
            systemIdempotencyKey:
              `cron-expire-${doc.id}`,
          });
          expiredCount++;
        } catch (expErr: any) {
          errors.push({ reservationId: doc.id, error: expErr.message });
        }
      }
    }

    return res.json({
      status: 'ok',
      expiredCount,
      errorsCount: errors.length,
      correlationId: req.correlationId,
    });
  } catch (err: any) {
    console.error('Erro ao expirar reservas internas:', err);
    return res.status(500).json({
      error: {
        code: 'expiration_cron_failed',
        message: 'Erro interno ao processar expiracao de reservas.',
        correlationId: req.correlationId,
      },
    });
  }
});

/**
 * Internal route for basic automated reconciliation
 */
internalRouter.post('/payments/reconcile', requireCronSecret, async (req: AuthenticatedRequest, res) => {
  try {
    if (!adminDb) {
      return res.json({ reconciledCount: 0, reason: 'firebase_not_configured' });
    }

    const snap = await adminDb
      .collection('financial_reconciliation_cases')
      .where('status', '==', 'open')
      .limit(50)
      .get();

    let processed = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      // Auto-reconcile open wallet confirmation failure if balance allows
      if (data.reason === 'wallet_confirmation_failed' && data.reservationId && data.userId) {
        try {
          await CreditWalletService.confirmConsumption({
            userId: data.userId,
            reservationId: data.reservationId,
            amountConsumed: data.consumedCredits || 0,
            operation: 'Reconciliacao automatica de consumo',
            idempotencyKey: `rec-${doc.id}`,
          });
          await doc.ref.update({ status: 'resolved_auto', updatedAt: new Date() });
          processed++;
        } catch (e) {
          // ignore or keep open
        }
      }
    }

    return res.json({
      status: 'ok',
      reconciledCasesCount: processed,
      correlationId: req.correlationId,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: {
        code: 'reconciliation_cron_failed',
        message: 'Erro interno ao processar reconciliacao.',
        correlationId: req.correlationId,
      },
    });
  }
});

/**
 * Reclaims expired leases conservatively and dispatches the durable outbox.
 * Mutations with an uncertain provider outcome are never replayed here.
 */
internalRouter.post('/executions/reconcile', requireCronSecret, async (req: AuthenticatedRequest, res) => {
  try {
    if (!adminDb) {
      return res.json({
        reconciled: { externalBlockers: 0, compensationPending: 0 },
        outbox: { delivered: 0, failed: 0 },
        reason: 'firebase_not_configured',
      });
    }

    const service = new DurableExecutionService();
    const reconciled = await service.reconcileStuck();
    const outbox = await service.dispatchOutbox(async (event) => {
      const ref = adminDb.collection('durable_domain_events').doc(event.outboxId);
      try {
        await ref.create({
          ...event,
          deliveredBy: 'internal_outbox_worker',
          persistedAt: new Date(),
        });
      } catch (error: any) {
        if (error?.code !== 6 && error?.code !== 'already-exists') throw error;
      }
    });

    return res.json({
      status: 'ok',
      reconciled,
      outbox,
      correlationId: req.correlationId,
    });
  } catch (error) {
    console.error('Erro na reconciliação de execuções duráveis:', error);
    return res.status(500).json({
      error: {
        code: 'durable_execution_reconciliation_failed',
        message: 'Erro interno ao reconciliar execuções duráveis.',
        correlationId: req.correlationId,
      },
    });
  }
});
