import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from '../types.js';
import { recordOperationalEventBestEffort } from '../observability/operationalTelemetryRuntime.js';

function normalizedResource(req: AuthenticatedRequest): string {
  const value = req.path || req.originalUrl || '/api';
  return value
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\b[0-9a-f]{24,64}\b/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .slice(0, 240);
}

export function operationalTelemetryMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.path.startsWith('/api')) {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const status = res.statusCode >= 400 ? 'error' : 'success';
    void recordOperationalEventBestEffort({
      category: 'http',
      operation: `${req.method.toUpperCase()} ${normalizedResource(req)}`,
      resource: normalizedResource(req),
      status,
      correlationId: req.correlationId || 'missing-correlation-id',
      tenantId: req.user?.tenantId || null,
      userId: req.user?.uid || null,
      durationMs,
      errorCode: status === 'error' ? `http_${res.statusCode}` : null,
      occurredAt: new Date().toISOString(),
    });
  });

  next();
}
