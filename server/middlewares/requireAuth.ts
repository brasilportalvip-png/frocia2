import { Response, NextFunction } from 'express';
import { adminAuth, adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { AuthenticatedRequest } from '../types.js';
import { recordSecurityEventBestEffort } from '../security/securityEventService.js';

export function normalizeTenantId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim();
  return /^[A-Za-z0-9:_-]{1,120}$/.test(normalized)
    ? normalized
    : undefined;
}

export function normalizeAuthenticatedName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value
    .normalize('NFKC')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return normalized.length >= 2
    ? normalized
    : undefined;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    void recordSecurityEventBestEffort({
      category: 'authentication_failure',
      severity: 'low',
      correlationId: req.correlationId || 'missing-correlation-id',
      sourceIp: req.ip,
      route: req.path,
      details: { reason: 'authorization_header_missing' },
    });
    return res.status(401).json({ error: 'Token de autenticação não fornecido ou formato inválido.' });
  }

  const token = authHeader.split('Bearer ')[1]?.trim();

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  if (!adminAuth) {
    return res.status(503).json({ error: 'Servidor de autenticação Firebase Admin não configurado.' });
  }

  try {
    const checkRevoked = isFirebaseAdminConfigured();
    const decodedToken = await adminAuth.verifyIdToken(token, checkRevoked);

    const uid = decodedToken.uid;
    const email = decodedToken.email || '';
    let role: 'admin' | 'user' = 'user';
    let profileName: string | undefined;
    const tokenTenantId =
      normalizeTenantId(decodedToken.tenantId) ||
      normalizeTenantId(decodedToken.organizationId) ||
      normalizeTenantId(decodedToken.companyId);

    if (decodedToken.role === 'admin' || decodedToken.admin === true) {
      role = 'admin';
    }

    if (isFirebaseAdminConfigured() && adminDb) {
      try {
        const userDoc = await adminDb.collection('users').doc(uid).get();

        if (userDoc.exists) {
          const userData = userDoc.data();

          if (userData?.role === 'admin') {
            role = 'admin';
          }

          profileName =
            normalizeAuthenticatedName(userData?.displayName) ||
            normalizeAuthenticatedName(userData?.name);
        }
      } catch (profileError) {
        console.warn('authenticated_profile_lookup_failed', {
          correlationId: req.correlationId,
          userId: uid,
          error: profileError instanceof Error ? profileError.message : String(profileError),
        });
      }
    }

    const tokenName = normalizeAuthenticatedName(decodedToken.name);
    const emailFallback = normalizeAuthenticatedName(
      email ? email.split('@')[0] : undefined
    );

    req.user = {
      uid,
      email,
      // Company scope is accepted only from a signed Firebase custom claim.
      // A profile document controlled by the user must never grant tenancy.
      tenantId: tokenTenantId || `user:${uid}`,
      name: profileName || tokenName || emailFallback || 'Usuário',
      picture: decodedToken.picture || '',
      emailVerified: decodedToken.email_verified === true,
      role,
    };

    next();
  } catch (error: any) {
    void recordSecurityEventBestEffort({
      category: 'authentication_failure',
      severity: error?.code === 'auth/id-token-revoked' ? 'high' : 'medium',
      correlationId: req.correlationId || 'missing-correlation-id',
      sourceIp: req.ip,
      route: req.path,
      details: { reason: error?.code || error?.name || 'token_verification_failed' },
    });
    return res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
  }
}
