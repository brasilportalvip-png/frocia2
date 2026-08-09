import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../types.js';

export function correlationIdMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const existingCorrelationId = req.headers['x-correlation-id'] as string | undefined;
  const correlationId = existingCorrelationId && existingCorrelationId.trim().length > 0
    ? existingCorrelationId.trim()
    : crypto.randomUUID();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  next();
}
