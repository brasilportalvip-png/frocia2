import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { AuthenticatedRequest } from '../types.js';
import {
  ExternalImportError,
  ExternalImportService
} from '../services/externalImportService.js';
import { importGithubSite } from '../services/githubSiteImportService.js';
import { editGithubProject, sanitizeOverrides } from '../services/projectAiEditService.js';
import { CreditWalletService, InsufficientCreditsError } from '../services/creditWalletService.js';
import { FeatureFlagService, FeatureFlagDisabledError } from '../services/featureFlagService.js';
import { GeminiFailoverService } from '../ai/geminiFailoverService.js';
import { env } from '../config/env.js';
import { REFINE_SITE_CREDIT_COST } from './siteBuilderRoutes.js';

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

const githubSiteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 4,
  keyPrefix: 'external-import-github-site'
});

/**
 * POST /api/imports/github-site
 * Baixa o repositório público inteiro e devolve um site HTML pronto para o
 * editor, com relatório do que foi (e do que não foi) trazido.
 */
externalImportRouter.post(
  '/github-site',
  requireAuth,
  githubSiteLimiter,
  async (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({ url: z.string().trim().min(8).max(2048) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'invalid_import_request', message: 'Informe o endereço do repositório.', correlationId: req.correlationId }
      });
    }
    try {
      const site = await importGithubSite(parsed.data.url);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ site });
    } catch (error) {
      if (error instanceof ExternalImportError) {
        return res.status(error.status).json({
          error: { code: error.code, message: error.message, correlationId: req.correlationId }
        });
      }
      console.error('Falha inesperada ao importar site do GitHub:', { correlationId: req.correlationId, userId: req.user?.uid, error });
      return res.status(500).json({
        error: { code: 'github_site_import_failed', message: 'Não foi possível abrir o site do GitHub agora.', correlationId: req.correlationId }
      });
    }
  }
);

const editLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 6,
  keyPrefix: 'external-import-project-edit'
});

/**
 * POST /api/imports/github-site/edit
 * A IA altera o código-fonte do projeto importado, o servidor recompila e devolve a nova prévia.
 * Mesmo custo do refinamento de sites; se a alteração não compilar, nada é aplicado e o valor é devolvido.
 */
externalImportRouter.post(
  '/github-site/edit',
  requireAuth,
  editLimiter,
  async (req: AuthenticatedRequest, res) => {
    const correlationId = req.correlationId;
    const parsed = z
      .object({
        url: z.string().trim().min(8).max(2048),
        instruction: z.string().trim().min(3).max(4000),
        overrides: z.record(z.string(), z.string()).optional(),
        idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,200}$/).optional()
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'invalid_project_edit_request', message: 'Informe o projeto e o que deve ser alterado.', correlationId }
      });
    }

    try {
      await FeatureFlagService.assertEnabled('ai_chat');
    } catch (flagError) {
      const disabled = flagError instanceof FeatureFlagDisabledError;
      return res.status(503).json({
        error: {
          code: disabled ? 'feature_temporarily_disabled' : 'feature_flag_check_failed',
          message: disabled ? 'A edição por IA está temporariamente desativada.' : 'Não foi possível validar a disponibilidade do recurso.',
          correlationId
        }
      });
    }

    const uid = req.user!.uid;
    const idempotencyKey = parsed.data.idempotencyKey || `edit-project-${uid}-${Date.now()}`;
    let reservationId: string;
    try {
      const reserved = await CreditWalletService.reserveCredits({
        userId: uid,
        amount: REFINE_SITE_CREDIT_COST,
        operation: 'Edição de projeto importado',
        idempotencyKey
      });
      reservationId = reserved.reservationId;
    } catch (reserveError) {
      const insufficient = reserveError instanceof InsufficientCreditsError;
      return res.status(insufficient ? 402 : 500).json({
        error: {
          code: insufficient ? 'insufficient_credits' : 'credit_reservation_failed',
          message: reserveError instanceof Error ? reserveError.message : 'Erro ao reservar créditos.',
          correlationId
        }
      });
    }

    try {
      const result = await editGithubProject(
        { url: parsed.data.url, instruction: parsed.data.instruction, overrides: sanitizeOverrides(parsed.data.overrides) },
        async ({ system, user }) => {
          const generation = await GeminiFailoverService.generate({
            model: env.GEMINI_CODE_MODEL || env.GEMINI_DEFAULT_MODEL,
            systemInstruction: system,
            userMessage: user,
            attachments: [],
            responseFormat: 'json',
            temperature: 0.3
          });
          return generation.response.text || '';
        }
      );
      await CreditWalletService.confirmConsumption({
        userId: uid,
        reservationId,
        amountConsumed: REFINE_SITE_CREDIT_COST,
        operation: 'Edição de projeto importado',
        idempotencyKey: `cnf-${idempotencyKey}`
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ site: result, consumedCredits: REFINE_SITE_CREDIT_COST, correlationId });
    } catch (error) {
      await CreditWalletService.releaseReservation({
        userId: uid,
        reservationId,
        operation: `Estorno por falha na edição do projeto: ${error instanceof Error ? error.message : 'erro'}`,
        idempotencyKey: `rel-${idempotencyKey}`
      });
      if (error instanceof ExternalImportError) {
        return res.status(error.status).json({ error: { code: error.code, message: error.message, correlationId } });
      }
      console.error('Falha ao editar projeto importado:', { correlationId, userId: uid, error });
      return res.status(500).json({
        error: {
          code: 'project_edit_failed',
          message: error instanceof Error ? error.message : 'Não foi possível alterar o projeto agora.',
          correlationId
        }
      });
    }
  }
);
