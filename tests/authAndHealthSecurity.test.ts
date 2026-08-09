import { describe, it, expect, vi } from 'vitest';
import { requireAuth } from '../server/middlewares/requireAuth.js';
import { STARTER_TEMPLATES } from '../src/data/templates.js';
import { adminAuth } from '../server/lib/firebaseAdmin.js';

describe('P0 Security & Contract Verification Tests', () => {
  it('should reject requests with missing authorization header', async () => {
    const req: any = { headers: {} };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('não fornecido') })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject unverified or forged JWT tokens without valid Firebase signature', async () => {
    // Forged token payload with admin: true
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'attacker123', admin: true, role: 'admin', email: 'attacker@evil.com' })
    ).toString('base64url');
    const forgedToken = `${header}.${payload}.fake_signature`;

    const req: any = { headers: { authorization: `Bearer ${forgedToken}` } };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    // Mock adminAuth.verifyIdToken to throw error for invalid token
    vi.spyOn(adminAuth, 'verifyIdToken').mockRejectedValueOnce(new Error('Invalid token signature'));

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('inválido ou expirado') })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should verify STARTER_TEMPLATES contains restored templates', () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThan(0);
    expect(STARTER_TEMPLATES[0]).toHaveProperty('id');
    expect(STARTER_TEMPLATES[0]).toHaveProperty('sampleHtml');
    expect(STARTER_TEMPLATES[0].sampleHtml).toContain('<!DOCTYPE html>');
  });
});
