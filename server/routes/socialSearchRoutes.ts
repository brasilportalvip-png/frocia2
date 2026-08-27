import { Router } from 'express';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import {
  SOCIAL_PLATFORMS,
  SocialPlatform,
  SocialSearchService,
} from '../ai/socialSearchService.js';
import {
  SocialSearchPolicyService,
  SocialSearchRateLimitError,
} from '../ai/socialSearchPolicyService.js';

export const socialSearchRouter = Router();

const socialSearchLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  keyPrefix: 'social-search',
});

function parsePlatforms(value: unknown): SocialPlatform[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('platforms_invalid');
  }

  const platforms = Array.from(
    new Set(
      value.filter(
        (platform): platform is SocialPlatform =>
          typeof platform === 'string' &&
          SOCIAL_PLATFORMS.includes(
            platform as SocialPlatform
          )
      )
    )
  );
  if (platforms.length !== value.length) {
    throw new Error('platforms_invalid');
  }
  return platforms;
}

socialSearchRouter.get(
  '/capabilities',
  requireAuth,
  (req: AuthenticatedRequest, res) => {
    return res.json({
      checkedAt: new Date().toISOString(),
      capabilities: SocialSearchService.capabilities(),
      correlationId: req.correlationId,
    });
  }
);

socialSearchRouter.post(
  '/',
  requireAuth,
  socialSearchLimiter,
  async (req: AuthenticatedRequest, res) => {
    try {
      const body =
        req.body && typeof req.body === 'object'
          ? (req.body as Record<string, unknown>)
          : {};
      const query =
        typeof body.query === 'string'
          ? body.query.trim()
          : '';
      const account =
        typeof body.account === 'string'
          ? body.account.trim()
          : null;
      const limit =
        typeof body.limit === 'number'
          ? body.limit
          : 5;
      const startDate =
        typeof body.startDate === 'string'
          ? body.startDate
          : undefined;
      const endDate =
        typeof body.endDate === 'string'
          ? body.endDate
          : undefined;

      if (
        query.length < 2 ||
        query.length > 300 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 10 ||
        (account && account.length > 100)
      ) {
        return res.status(400).json({
          error: {
            code: 'invalid_social_search',
            message:
              'Consulta, conta ou limite da pesquisa social inválidos.',
            correlationId: req.correlationId,
          },
        });
      }

      await SocialSearchPolicyService.assertAllowed({
        userId: req.user!.uid,
        tenantId: req.user!.tenantId,
      });

      const report = await SocialSearchService.search({
        query,
        platforms: parsePlatforms(body.platforms),
        account,
        limit,
        startDate,
        endDate,
      });

      return res.json({
        ...report,
        correlationId: req.correlationId,
      });
    } catch (error) {
      if (error instanceof SocialSearchRateLimitError) {
        return res.status(429).json({
          error: {
            code: 'social_search_rate_limited',
            message: error.message,
            resetAt: error.resetAt,
            correlationId: req.correlationId,
          },
        });
      }

      const invalid =
        error instanceof Error &&
        (error.message === 'platforms_invalid' ||
          error.message.includes('deve conter') ||
          error.message.includes('TikTok'));
      return res.status(invalid ? 400 : 502).json({
        error: {
          code: invalid
            ? 'invalid_social_search'
            : 'social_search_failed',
          message: invalid
            ? error instanceof Error
              ? error.message
              : 'Pesquisa social inválida.'
            : 'A pesquisa social não pôde ser concluída pelas APIs oficiais.',
          correlationId: req.correlationId,
        },
      });
    }
  }
);
