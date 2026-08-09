import { Router } from 'express';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import {
  PortableRecoveryService,
  PORTABLE_BACKUP_COLLECTIONS
} from '../services/portableRecoveryService.js';
import { AuthenticatedRequest } from '../types.js';

export const portableRecoveryRouter = Router();

const RESTORE_CONFIRMATION = 'RESTAURAR FROC.IA';
const HISTORY_LIMIT = 25;

const recoveryReadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'portable-recovery-read'
});

const recoveryMutationLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyPrefix: 'portable-recovery-mutation'
});

function projectId(): string {
  return String(process.env.FIREBASE_PROJECT_ID || '').trim();
}

function actorUid(req: AuthenticatedRequest): string {
  return String(req.user?.uid || '').trim();
}

function timestampToIso(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date })
      .toDate()
      .toISOString();
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    value instanceof Date
  ) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function configurationUnavailable(
  req: AuthenticatedRequest,
  res: any
) {
  return res.status(503).json({
    error: {
      code: 'portable_recovery_unavailable',
      message:
        'O Firebase Admin não está configurado para o backup portátil.',
      correlationId: req.correlationId
    }
  });
}

function errorResponse(
  req: AuthenticatedRequest,
  res: any,
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string
) {
  const rawMessage =
    error instanceof Error ? error.message : '';

  if (rawMessage === 'portable_backup_document_limit_exceeded') {
    return res.status(413).json({
      error: {
        code: rawMessage,
        message:
          'O banco excede o limite do backup portátil. Será necessária uma estratégia de backup em nuvem.',
        correlationId: req.correlationId
      }
    });
  }

  if (rawMessage === 'portable_backup_size_limit_exceeded') {
    return res.status(413).json({
      error: {
        code: rawMessage,
        message:
          'O arquivo excede o limite seguro do backup portátil.',
        correlationId: req.correlationId
      }
    });
  }

  if (rawMessage.startsWith('portable_backup_invalid:')) {
    return res.status(400).json({
      error: {
        code: 'portable_backup_invalid',
        message:
          rawMessage.split(':').slice(1).join(':') ||
          'O arquivo de backup é inválido.',
        correlationId: req.correlationId
      }
    });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({
    error: {
      code: fallbackCode,
      message: fallbackMessage,
      correlationId: req.correlationId
    }
  });
}

portableRecoveryRouter.get(
  '/status',
  requireAuth,
  requireAdmin,
  recoveryReadLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) {
      return configurationUnavailable(req, res);
    }

    try {
      const snapshot = await adminDb
        .collection('disaster_recovery_audit')
        .orderBy('createdAt', 'desc')
        .limit(HISTORY_LIMIT)
        .get();

      const history = snapshot.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          action: String(data.action || 'unknown'),
          actorUid: String(data.actorUid || ''),
          backupId:
            typeof data.backupId === 'string'
              ? data.backupId
              : null,
          documentCount: Number(data.documentCount || 0),
          collectionCount: Number(data.collectionCount || 0),
          dryRun: data.dryRun === true,
          success: data.success === true,
          details:
            typeof data.details === 'string'
              ? data.details
              : null,
          createdAt: timestampToIso(data.createdAt)
        };
      });

      const lastBackup = history.find(
        (item) =>
          item.action === 'backup_created' && item.success
      );
      const lastValidation = history.find(
        (item) =>
          item.action === 'backup_validated' && item.success
      );
      const lastRestore = history.find(
        (item) =>
          item.action === 'restore_completed' && item.success
      );

      return res.json({
        mode: 'portable_manual',
        configured: true,
        projectId: projectId(),
        databaseId: '(default)',
        automaticBackup: false,
        cloudStorageBackup: false,
        firebaseAuthIncluded: false,
        firebaseStorageIncluded: false,
        protectedCollections: PORTABLE_BACKUP_COLLECTIONS,
        restoreConfirmation: RESTORE_CONFIRMATION,
        lastBackup: lastBackup ?? null,
        lastValidation: lastValidation ?? null,
        lastRestore: lastRestore ?? null,
        history,
        limitations: [
          'O arquivo deve ser guardado pelo administrador fora da plataforma.',
          'Contas e senhas do Firebase Authentication não fazem parte do arquivo.',
          'Arquivos binários do Firebase Storage não fazem parte do arquivo.',
          'A restauração sobrescreve IDs existentes e não apaga documentos posteriores.'
        ],
        correlationId: req.correlationId
      });
    } catch (error) {
      return errorResponse(
        req,
        res,
        error,
        'portable_recovery_status_failed',
        'Não foi possível consultar o histórico de recuperação.'
      );
    }
  }
);

portableRecoveryRouter.post(
  '/backup',
  requireAuth,
  requireAdmin,
  recoveryMutationLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) {
      return configurationUnavailable(req, res);
    }

    try {
      const backup = await PortableRecoveryService.createBackup({
        actorUid: actorUid(req),
        projectId: projectId()
      });

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${backup.manifest.backupId}.json"`
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.json(backup);
    } catch (error) {
      return errorResponse(
        req,
        res,
        error,
        'portable_backup_failed',
        'Não foi possível gerar o backup portátil.'
      );
    }
  }
);

portableRecoveryRouter.post(
  '/validate',
  requireAuth,
  requireAdmin,
  recoveryMutationLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) {
      return configurationUnavailable(req, res);
    }

    try {
      const result = await PortableRecoveryService.restoreBackup({
        backup: req.body?.backup,
        actorUid: actorUid(req),
        projectId: projectId(),
        dryRun: true
      });

      return res.json({
        valid: true,
        result,
        correlationId: req.correlationId
      });
    } catch (error) {
      return errorResponse(
        req,
        res,
        error,
        'portable_backup_validation_failed',
        'Não foi possível validar o backup portátil.'
      );
    }
  }
);

portableRecoveryRouter.post(
  '/restore',
  requireAuth,
  requireAdmin,
  recoveryMutationLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) {
      return configurationUnavailable(req, res);
    }

    const confirmation = String(
      req.body?.confirmation || ''
    ).trim();

    if (confirmation !== RESTORE_CONFIRMATION) {
      return res.status(400).json({
        error: {
          code: 'restore_confirmation_invalid',
          message: `Digite exatamente “${RESTORE_CONFIRMATION}” para autorizar a restauração.`,
          correlationId: req.correlationId
        }
      });
    }

    try {
      const result = await PortableRecoveryService.restoreBackup({
        backup: req.body?.backup,
        actorUid: actorUid(req),
        projectId: projectId(),
        dryRun: false
      });

      return res.json({
        restored: true,
        result,
        correlationId: req.correlationId
      });
    } catch (error) {
      return errorResponse(
        req,
        res,
        error,
        'portable_restore_failed',
        'A restauração não pôde ser concluída.'
      );
    }
  }
);