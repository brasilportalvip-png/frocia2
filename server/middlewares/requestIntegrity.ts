import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from '../types.js';
import { recordSecurityEventBestEffort } from '../security/securityEventService.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_OBJECT_DEPTH = 24;
const MAX_OBJECT_NODES = 12_000;

export interface PayloadInspection {
  safe: boolean;
  reason?: 'forbidden_key' | 'payload_too_deep' | 'payload_too_complex';
  path?: string;
}

export function inspectPayloadIntegrity(value: unknown): PayloadInspection {
  let nodes = 0;
  const stack: Array<{ value: unknown; depth: number; path: string }> = [
    { value, depth: 0, path: '$' },
  ];

  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_OBJECT_NODES) {
      return { safe: false, reason: 'payload_too_complex', path: current.path };
    }
    if (current.depth > MAX_OBJECT_DEPTH) {
      return { safe: false, reason: 'payload_too_deep', path: current.path };
    }
    if (!current.value || typeof current.value !== 'object') continue;

    for (const [key, nested] of Object.entries(current.value as Record<string, unknown>)) {
      const path = `${current.path}.${key}`;
      if (FORBIDDEN_KEYS.has(key)) {
        return { safe: false, reason: 'forbidden_key', path };
      }
      stack.push({ value: nested, depth: current.depth + 1, path });
    }
  }
  return { safe: true };
}

function normalizedOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function trustedOrigins(req: AuthenticatedRequest): Set<string> {
  const result = new Set<string>();
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProtocol || req.protocol || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const currentOrigin = normalizedOrigin(`${protocol}://${host}`);
  if (currentOrigin) result.add(currentOrigin);

  const configured = [process.env.APP_URL, ...(process.env.TRUSTED_ORIGINS || '').split(',')];
  for (const value of configured) {
    if (!value?.trim()) continue;
    const origin = normalizedOrigin(value.trim());
    if (origin) result.add(origin);
  }
  return result;
}

function requestHasBody(req: AuthenticatedRequest): boolean {
  const declaredLength = Number(req.headers['content-length'] || 0);
  return declaredLength > 0 || Boolean(req.headers['transfer-encoding']);
}

function sendBlocked(
  req: AuthenticatedRequest,
  res: Response,
  status: number,
  code: string,
  message: string
) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({
    error: {
      code,
      message,
      correlationId: req.correlationId,
    },
  });
}

export function requestIntegrityMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void | Response {
  if (!req.path.startsWith('/api') || !MUTATING_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const origin = typeof req.headers.origin === 'string' ? normalizedOrigin(req.headers.origin) : null;
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  const crossSite = fetchSite === 'cross-site';
  if (crossSite || (origin && !trustedOrigins(req).has(origin))) {
    void recordSecurityEventBestEffort({
      category: 'cross_site_mutation',
      severity: 'high',
      correlationId: req.correlationId || 'missing-correlation-id',
      sourceIp: req.ip,
      userId: req.user?.uid,
      tenantId: req.user?.tenantId,
      route: req.path,
      details: { origin, fetchSite },
    });
    return sendBlocked(
      req,
      res,
      403,
      'cross_site_mutation_blocked',
      'A origem desta operação mutável não é permitida.'
    );
  }

  if (requestHasBody(req) && !req.is(['application/json', 'application/*+json'])) {
    void recordSecurityEventBestEffort({
      category: 'invalid_content_type',
      severity: 'medium',
      correlationId: req.correlationId || 'missing-correlation-id',
      sourceIp: req.ip,
      route: req.path,
      details: { contentType: req.headers['content-type'] || null },
    });
    return sendBlocked(
      req,
      res,
      415,
      'json_content_type_required',
      'Operações da API com corpo exigem Content-Type application/json.'
    );
  }

  const inspection = inspectPayloadIntegrity(req.body);
  if (!inspection.safe) {
    void recordSecurityEventBestEffort({
      category: 'unsafe_payload',
      severity: 'high',
      correlationId: req.correlationId || 'missing-correlation-id',
      sourceIp: req.ip,
      userId: req.user?.uid,
      tenantId: req.user?.tenantId,
      route: req.path,
      details: { reason: inspection.reason, path: inspection.path },
    });
    return sendBlocked(
      req,
      res,
      400,
      'unsafe_request_payload',
      'A estrutura enviada contém uma chave ou profundidade não permitida.'
    );
  }

  next();
}
