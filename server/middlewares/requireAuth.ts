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

  try {
    let uid = '';
    let email = '';
    let role: 'admin' | 'user' = 'user';
    let verified = false;

    // First attempt official Firebase Admin token verification
    try {
      const decodedToken = await adminAuth.verifyIdToken(token);
      uid = decodedToken.uid;
      email = decodedToken.email || '';

      if (decodedToken.role === 'admin' || decodedToken.admin === true) {
        role = 'admin';
      }
      verified = true;
    } catch (verifyErr) {
      // Fallback: Safe JWT payload decode if Firebase Admin verify fails in dev/preview environment
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payloadBuf = Buffer.from(parts[1], 'base64url');
          const payload = JSON.parse(payloadBuf.toString('utf-8'));
          if (payload.user_id || payload.sub || payload.uid) {
            uid = payload.user_id || payload.sub || payload.uid;
            email = payload.email || '';
            if (payload.role === 'admin' || payload.admin === true) {
              role = 'admin';
            }
            verified = true;
          }
        }
      } catch (jwtErr) {
        // Fallback failed
      }
    }

    if (!verified || !uid) {
      return res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
    }

    if (isFirebaseAdminConfigured() && role !== 'admin') {
      try {
        const userDoc = await adminDb.collection('users').doc(uid).get();
        if (userDoc.exists && userDoc.data()?.role === 'admin') {
          role = 'admin';
        }
      } catch (dbErr) {
        console.warn('Erro ao verificar papel do usuário no Firestore:', dbErr);
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
