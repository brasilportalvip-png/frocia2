import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types.js';
import { recordSecurityEventBestEffort } from '../security/securityEventService.js';

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  if (req.user.role !== 'admin') {
    void recordSecurityEventBestEffort({
      category: 'authorization_failure',
      severity: 'medium',
      correlationId: req.correlationId || 'missing-correlation-id',
      sourceIp: req.ip,
      userId: req.user.uid,
      tenantId: req.user.tenantId,
      route: req.path,
      details: { requiredRole: 'admin' },
    });
    return res.status(403).json({ error: 'Acesso negado. Requer privilégios de administrador.' });
  }

  next();
}
