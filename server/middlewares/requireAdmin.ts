import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types.js';

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Requer privilégios de administrador.' });
  }

  next();
}
