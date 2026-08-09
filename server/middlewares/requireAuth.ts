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

    if (isFirebaseAdminConfigured()) {
      const decodedToken = await adminAuth.verifyIdToken(token);
      uid = decodedToken.uid;
      email = decodedToken.email || '';
      
      if (decodedToken.role === 'admin' || decodedToken.admin === true) {
        role = 'admin';
      } else {
        // Fetch role from Firestore user profile document
        try {
          const userDoc = await adminDb.collection('users').doc(uid).get();
          if (userDoc.exists && userDoc.data()?.role === 'admin') {
            role = 'admin';
          }
        } catch (dbErr) {
          console.warn('Erro ao verificar papel do usuário no Firestore:', dbErr);
        }
      }
    } else {
      // In development mode if admin credentials are missing, reject or parse token safely
      return res.status(401).json({ error: 'Servidor de autenticação Firebase Admin não configurado.' });
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
