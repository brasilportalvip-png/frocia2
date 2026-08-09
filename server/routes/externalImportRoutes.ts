import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { AuthenticatedRequest } from '../types.js';
import {
  ExternalImportError,
  ExternalImportService
} from '../services/externalImportService.js';

export const externalImportRouter = Router();

const importLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keyPrefix: 'external-import'
});

const ExternalImportInputSchema = z
  .object({
    type: z.enum(['url', 'github']),
    url: z
      .string()
      .trim()
      .min(8, 'Informe uma URL completa.')
      .max(2048, 'A URL excede o limite permitido.')
  })
  .strict();

/**
 * POST /api/imports/external
 * Importa conteúdo textual de uma página pública ou metadados de um
 * repositório público do GitHub. A autenticação acontece antes do rate limit
 * para que a cota seja aplicada ao UID real do usuário.
 */
externalImportRouter.post(
  '/external',
  requireAuth,
  importLimiter,
  async (req: AuthenticatedRequest, res) => {
    const parsed = ExternalImportInputSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'invalid_import_request',
          message:
            parsed.error.issues[0]?.message ||
            'Os dados enviados para importação são inválidos.',
          correlationId: req.correlationId
        }
      });
    }

    try {
      const imported = await ExternalImportService.import(parsed.data);
      res.setHeader('Cache-Control', 'no-store');

      return res.status(200).json({ imported });
    } catch (error) {
      if (error instanceof ExternalImportError) {
        return res.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
            correlationId: req.correlationId
          }
        });
      }

      console.error('Falha inesperada na importação externa:', {
        correlationId: req.correlationId,
        userId: req.user?.uid,
        error
      });

      return res.status(500).json({
        error: {
          code: 'external_import_failed',
          message: 'Não foi possível concluir a importação externa.',
          correlationId: req.correlationId
        }
      });
    }
  }
);