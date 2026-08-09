import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import {
  FEATURE_FLAG_DEFINITIONS,
  FeatureFlagKey,
  FeatureFlagService
} from '../services/featureFlagService.js';
import { AuthenticatedRequest } from '../types.js';

export const featureFlagRouter = Router();

function isFeatureFlagKey(
  value: string
): value is FeatureFlagKey {
  return Object.prototype.hasOwnProperty.call(
    FEATURE_FLAG_DEFINITIONS,
    value
  );
}

function isValidReason(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= 10 &&
    value.trim().length <= 500
  );
}

function actorUid(req: AuthenticatedRequest): string {
  return req.user?.uid?.trim() || '';
}

// GET /api/admin/feature-flags
featureFlagRouter.get(
  '/',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const snapshot =
        await FeatureFlagService.getSnapshot();

      return res.json({
        ...snapshot,
        correlationId: req.correlationId
      });
    } catch {
      return res.status(500).json({
        error: {
          code: 'feature_flags_list_failed',
          message:
            'Não foi possível carregar as configurações de recursos.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// PATCH /api/admin/feature-flags/:key
featureFlagRouter.patch(
  '/:key',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const key = req.params.key;
      const { enabled } = req.body ?? {};

      if (!isFeatureFlagKey(key)) {
        return res.status(404).json({
          error: {
            code: 'feature_flag_not_found',
            message: 'O recurso informado não existe.',
            correlationId: req.correlationId
          }
        });
      }

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          error: {
            code: 'invalid_feature_flag_value',
            message:
              'O campo enabled deve ser verdadeiro ou falso.',
            correlationId: req.correlationId
          }
        });
      }

      const updatedBy = actorUid(req);

      if (!updatedBy) {
        return res.status(401).json({
          error: {
            code: 'feature_flag_actor_required',
            message:
              'Não foi possível identificar o administrador.',
            correlationId: req.correlationId
          }
        });
      }

      const snapshot =
        await FeatureFlagService.updateFlag({
          key,
          enabled,
          updatedBy
        });

      return res.json({
        ...snapshot,
        correlationId: req.correlationId
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'feature_not_available'
      ) {
        return res.status(409).json({
          error: {
            code: 'feature_not_available',
            message:
              'Este recurso ainda não possui um provedor homologado e não pode ser ativado.',
            correlationId: req.correlationId
          }
        });
      }

      if (
        error instanceof Error &&
        error.message === 'emergency_mode_active'
      ) {
        return res.status(409).json({
          error: {
            code: 'emergency_mode_active',
            message:
              'Desative o modo de emergência antes de reativar recursos protegidos.',
            correlationId: req.correlationId
          }
        });
      }

      return res.status(500).json({
        error: {
          code: 'feature_flag_update_failed',
          message:
            'Não foi possível atualizar o recurso.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// POST /api/admin/feature-flags/emergency/activate
featureFlagRouter.post(
  '/emergency/activate',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { reason } = req.body ?? {};

      if (!isValidReason(reason)) {
        return res.status(400).json({
          error: {
            code: 'invalid_emergency_reason',
            message:
              'Informe um motivo entre 10 e 500 caracteres.',
            correlationId: req.correlationId
          }
        });
      }

      const activatedBy = actorUid(req);

      if (!activatedBy) {
        return res.status(401).json({
          error: {
            code: 'feature_flag_actor_required',
            message:
              'Não foi possível identificar o administrador.',
            correlationId: req.correlationId
          }
        });
      }

      const snapshot =
        await FeatureFlagService.activateEmergency({
          reason: reason.trim(),
          activatedBy
        });

      return res.status(201).json({
        ...snapshot,
        correlationId: req.correlationId
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          'emergency_mode_already_active'
      ) {
        return res.status(409).json({
          error: {
            code: 'emergency_mode_already_active',
            message:
              'O modo de emergência já está ativo.',
            correlationId: req.correlationId
          }
        });
      }

      return res.status(500).json({
        error: {
          code: 'emergency_activation_failed',
          message:
            'Não foi possível ativar o modo de emergência.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// POST /api/admin/feature-flags/emergency/deactivate
featureFlagRouter.post(
  '/emergency/deactivate',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { reason } = req.body ?? {};

      if (!isValidReason(reason)) {
        return res.status(400).json({
          error: {
            code: 'invalid_emergency_reason',
            message:
              'Informe um motivo entre 10 e 500 caracteres.',
            correlationId: req.correlationId
          }
        });
      }

      const deactivatedBy = actorUid(req);

      if (!deactivatedBy) {
        return res.status(401).json({
          error: {
            code: 'feature_flag_actor_required',
            message:
              'Não foi possível identificar o administrador.',
            correlationId: req.correlationId
          }
        });
      }

      const snapshot =
        await FeatureFlagService.deactivateEmergency({
          reason: reason.trim(),
          deactivatedBy
        });

      return res.json({
        ...snapshot,
        correlationId: req.correlationId
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'emergency_mode_not_active'
      ) {
        return res.status(409).json({
          error: {
            code: 'emergency_mode_not_active',
            message:
              'O modo de emergência já está desativado.',
            correlationId: req.correlationId
          }
        });
      }

      return res.status(500).json({
        error: {
          code: 'emergency_deactivation_failed',
          message:
            'Não foi possível desativar o modo de emergência.',
          correlationId: req.correlationId
        }
      });
    }
  }
);