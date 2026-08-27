import crypto from 'crypto';
import { Response, NextFunction } from 'express';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { AuthenticatedRequest } from '../types.js';
import { recordSecurityEventBestEffort } from '../security/securityEventService.js';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

interface RateLimitResult extends RateLimitRecord {
  allowed: boolean;
}

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
}

const rateLimitMap = new Map<string, RateLimitRecord>();

const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 10 * 60 * 1000);

cleanupTimer.unref();

function consumeLocalLimit(
  key: string,
  windowMs: number,
  max: number
): RateLimitResult {
  const now = Date.now();
  const current = rateLimitMap.get(key);

  const record =
    !current || now >= current.resetTime
      ? {
          count: 1,
          resetTime: now + windowMs,
        }
      : {
          count: current.count + 1,
          resetTime: current.resetTime,
        };

  rateLimitMap.set(key, record);

  return {
    ...record,
    allowed: record.count <= max,
  };
}

async function consumeDistributedLimit(
  key: string,
  windowMs: number,
  max: number
): Promise<RateLimitResult> {
  const documentId = crypto
    .createHash('sha256')
    .update(key)
    .digest('hex');

  const ref = adminDb
    .collection('rate_limits')
    .doc(documentId);

  return adminDb.runTransaction(async (transaction) => {
    const now = Date.now();
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists
      ? snapshot.data()
      : undefined;

    const previousResetTime = Number(
      data?.resetTime || 0
    );

    const resetTime =
      previousResetTime > now
        ? previousResetTime
        : now + windowMs;

    const count =
      previousResetTime > now
        ? Number(data?.count || 0) + 1
        : 1;

    transaction.set(ref, {
      count,
      resetTime,
      updatedAt: new Date(),
    });

    return {
      count,
      resetTime,
      allowed: count <= max,
    };
  });
}

function setRateLimitHeaders(
  res: Response,
  max: number,
  result: RateLimitResult
) {
  res.setHeader('RateLimit-Limit', max);

  res.setHeader(
    'RateLimit-Remaining',
    Math.max(0, max - result.count)
  );

  res.setHeader(
    'RateLimit-Reset',
    Math.ceil(result.resetTime / 1000)
  );
}

export function createRateLimiter(
  opts: RateLimiterOptions
) {
  const {
    windowMs,
    max,
    keyPrefix,
  } = opts;

  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const identifier =
      req.user?.uid ||
      req.ip ||
      'anonymous';

    const key = `${keyPrefix}:${identifier}`;

    try {
      const useDistributedStore =
        process.env.NODE_ENV === 'production' &&
        isFirebaseAdminConfigured();

      const result = useDistributedStore
        ? await consumeDistributedLimit(
            key,
            windowMs,
            max
          )
        : consumeLocalLimit(
            key,
            windowMs,
            max
          );

      setRateLimitHeaders(
        res,
        max,
        result
      );

      if (!result.allowed) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(
            (result.resetTime - Date.now()) / 1000
          )
        );

        res.setHeader(
          'Retry-After',
          retryAfterSeconds
        );

        void recordSecurityEventBestEffort({
          category: 'rate_limit',
          severity: 'medium',
          correlationId: req.correlationId || 'missing-correlation-id',
          sourceIp: req.ip,
          userId: req.user?.uid,
          tenantId: req.user?.tenantId,
          route: req.path,
          details: { keyPrefix, windowMs, max },
        });

        return res.status(429).json({
          error: {
            code: 'rate_limit_exceeded',
            message:
              'Muitas requisições enviadas em um curto período. Por favor, aguarde antes de tentar novamente.',
            correlationId:
              req.correlationId,
          },
        });
      }

      return next();
    } catch (error) {
      console.error(
        'Falha ao aplicar rate limit distribuído:',
        error
      );

      return res.status(503).json({
        error: {
          code: 'rate_limiter_unavailable',
          message:
            'Serviço temporariamente indisponível. Tente novamente em instantes.',
          correlationId:
            req.correlationId,
        },
      });
    }
  };
}
