import { Router } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../types.js';
import { env } from '../config/env.js';
import { CreditWalletService } from '../services/creditWalletService.js';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { DurableExecutionService } from '../ai/durableExecutionService.js';
import { AutomaticBackupService } from '../services/automaticBackupService.js';
import { MigrationService } from '../migrations/migrationService.js';

export const internalRouter = Router();

/**
 * Middleware verifying internal cron secret exclusively via x-cron-secret header
 * using timing-safe string comparison.
 */
const requireCronSecret = (req: AuthenticatedRequest, res: any, next: any) => {
  const secretHeader = req.headers['x-cron-secret'];
  const authorization = req.headers.authorization;
  const bearer =
    typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
  const provided =
    typeof secretHeader === 'string' && secretHeader.length > 0
      ? secretHeader
      : bearer;

  if (!provided) {
    return res.status(401).json({
      error: {
        code: 'unauthorized_cron',
        message: 'Segredo de manutencao interna ausente ou invalido no cabeçalho x-cron-secret.',
        correlationId: req.correlationId,
      },
    });
  }

  const expectedSecrets = [env.CRON_SECRET, env.INTERNAL_CRON_SECRET]
    .filter((candidate): candidate is string => Boolean(candidate));
  const providedBuffer = Buffer.from(provided);
  const valid = expectedSecrets.some((expectedSecret) => {
    const expectedBuffer = Buffer.from(expectedSecret);
    return (
      providedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    );
  });

  if (!valid) {
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
 * Vercel invokes this route daily and sends CRON_SECRET as Authorization
 * Bearer. The same handler accepts x-cron-secret for an operator-initiated run.
 */
internalRouter.get('/backups/run', requireCronSecret, async (req: AuthenticatedRequest, res) => {
  if (!AutomaticBackupService.isConfigured()) {
    return res.status(503).json({
      error: {
        code: 'automatic_backup_not_configured',
        message:
          'Configure FIREBASE_STORAGE_BUCKET e BACKUP_ENCRYPTION_KEY para ativar backups automáticos.',
        correlationId: req.correlationId,
      },
    });
  }

  try {
    const result = await AutomaticBackupService.run('vercel-cron');
    return res.json({
      status: 'verified',
      result,
      correlationId: req.correlationId,
    });
  } catch (error) {
    console.error('Falha no backup automático criptografado:', error);
    return res.status(500).json({
      error: {
        code: 'automatic_backup_failed',
        message: 'O backup automático não foi concluído ou verificado.',
        correlationId: req.correlationId,
      },
    });
  }
});

/**
 * Downloads the newest encrypted backup, verifies both checksums, decrypts it
 * and runs the full restore validator without writing restored documents.
 */
internalRouter.post(
  '/backups/drill',
  requireCronSecret,
  async (req: AuthenticatedRequest, res) => {
    if (!AutomaticBackupService.isConfigured()) {
      return res.status(503).json({
        error: {
          code: 'automatic_backup_not_configured',
          message:
            'Configure o backup automático antes de executar o exercício de recuperação.',
          correlationId: req.correlationId,
        },
      });
    }

    try {
      const result = await AutomaticBackupService.drillLatest(
        'release-operator'
      );
      return res.json({
        status: 'verified',
        result,
        correlationId: req.correlationId,
      });
    } catch (error) {
      console.error('Falha no exercício seguro de recuperação:', error);
      return res.status(500).json({
        error: {
          code: 'automatic_backup_drill_failed',
          message:
            'O backup mais recente não passou pelo exercício seguro de recuperação.',
          correlationId: req.correlationId,
        },
      });
    }
  }
);

internalRouter.get('/migrations/status', requireCronSecret, async (req: AuthenticatedRequest, res) => {
  if (!isFirebaseAdminConfigured()) {
    return res.status(503).json({
      error: {
        code: 'migration_database_unavailable',
        message: 'Firebase Admin não está configurado para validar migrations.',
        correlationId: req.correlationId,
      },
    });
  }
  try {
    return res.json({
      status: await MigrationService.status(),
      correlationId: req.correlationId,
    });
  } catch (error) {
    console.error('Falha ao consultar migrations:', error);
    return res.status(500).json({
      error: {
        code: 'migration_status_failed',
        message: 'Não foi possível validar o estado das migrations.',
        correlationId: req.correlationId,
      },
    });
  }
});

internalRouter.post('/migrations/apply', requireCronSecret, async (req: AuthenticatedRequest, res) => {
  if (!isFirebaseAdminConfigured()) {
    return res.status(503).json({
      error: {
        code: 'migration_database_unavailable',
        message: 'Firebase Admin não está configurado para aplicar migrations.',
        correlationId: req.correlationId,
      },
    });
  }
  try {
    const result = await MigrationService.applyPending('release-operator');
    return res.json({
      status: 'completed',
      result,
      correlationId: req.correlationId,
    });
  } catch (error) {
    console.error('Falha ao aplicar migrations:', error);
    return res.status(409).json({
      error: {
        code: 'migration_apply_failed',
        message: 'A migration não foi aplicada; consulte o ledger antes de repetir.',
        correlationId: req.correlationId,
      },
    });
  }
});

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
