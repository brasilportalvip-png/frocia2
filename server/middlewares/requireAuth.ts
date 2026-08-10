import { Response, NextFunction } from 'express';
import { adminAuth, adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { AuthenticatedRequest } from '../types.js';

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido ou formato inválido.' });
  }

  const token = authHeader.split('Bearer ')[1]?.trim();

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  if (!isFirebaseAdminConfigured() && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'Servidor de autenticação Firebase Admin não configurado.' });
  }

  try {
    let decodedToken;
    try {
      const checkRevoked = isFirebaseAdminConfigured();
      decodedToken = await adminAuth.verifyIdToken(token, checkRevoked);
    } catch (checkErr: any) {
      if (checkErr?.code === 'auth/id-token-revoked' || checkErr?.code === 'auth/user-disabled') {
        throw checkErr;
      }
      try {
        decodedToken = await adminAuth.verifyIdToken(token, false);
      } catch (verifyErr: any) {
        throw verifyErr;
      }
    }

    const uid = decodedToken.uid;
    const email = decodedToken.email || '';
    let role: 'admin' | 'user' = 'user';

    if (decodedToken.role === 'admin' || decodedToken.admin === true) {
      role = 'admin';
    } else if (adminDb) {
      try {
        const userDoc = await adminDb.collection('users').doc(uid).get();
        if (userDoc.exists && userDoc.data()?.role === 'admin') {
          role = 'admin';
        }
      } catch {
        // Non-blocking
      }
    }

    req.user = {
      uid,
      email,
      role,
    };

    next();
  } catch (error: any) {
    return res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
  }
}

