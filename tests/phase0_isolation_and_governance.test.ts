import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { UserAdminService } from '../server/services/userAdminService.js';
import { CapabilityRegistryService } from '../server/services/capabilityRegistryService.js';
import { SelfEvolutionPolicyEngine } from '../server/selfEvolution/selfEvolutionPolicyEngine.js';
import { createApp } from '../server.js';
import request from 'supertest';

describe('FASE 0 & GOVERNANCE — Account Isolation, Health, Capabilities & Security', () => {
  it('0.1 - Storage keys must be partitioned by UID and legacy global keys eliminated in App.tsx', () => {
    const appTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appTsx).toContain("LOCAL_STORAGE_KEY_PREFIX = 'frocia_saved_sites_v1'");
    expect(appTsx).toContain("getPartitionedKey('frocia_active_conv', userUid)");
    expect(appTsx).toContain("localStorage.removeItem('frocia_active_conversation_id')");
    expect(appTsx).toContain("localStorage.removeItem('frocia_saved_sites_v1')");
  });

  it('0.2 - Firestore rules must strictly protect user role, email, plan, and credit fields from client mutation', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain("diff(resource.data).affectedKeys().hasAny");
    expect(rules).toContain("'email'");
    expect(rules).toContain("'role'");
    expect(rules).toContain("'plan'");
    expect(rules).toContain("'creditsAvailable'");
  });

  it('0.2 - UserAdminService provides email duplicate audit without silent data modification', async () => {
    const report = await UserAdminService.auditDuplicateUserEmails();
    expect(report).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(typeof report.totalUsersScanned).toBe('number');
    expect(Array.isArray(report.duplicateGroups)).toBe(true);
  });

  it('0.3 - Self Evolution Policy Engine must keep self-evolution disabled unless explicitly configured in env', () => {
    const isEnabled = SelfEvolutionPolicyEngine.isSelfEvolutionEnabled();
    if (process.env.SELF_EVOLUTION_ENABLED !== 'true') {
      expect(isEnabled).toBe(false);
    }
  });

  it('0.6 - Health probes /live and /ready must respond correctly without leaking secrets', async () => {
    const app = await createApp();

    const liveRes = await request(app).get('/api/live');
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.status).toBe('live');

    const readyRes = await request(app).get('/api/ready');
    expect([200, 503]).toContain(readyRes.status);
    expect(['ready', 'not_ready']).toContain(readyRes.body.status);
     expect(readyRes.body.checks).toBeDefined();
    expect(readyRes.body.secret).toBeUndefined();
    expect(readyRes.body.MERCADO_PAGO_WEBHOOK_SECRET).toBeUndefined();

    const healthRes = await request(app).get('/api/health');

    const allIntegrationsConfigured =
      healthRes.body.firebaseConfigured === true &&
      healthRes.body.geminiConfigured === true &&
      healthRes.body.mercadoPagoConfigured === true;

    expect(healthRes.status).toBe(
      allIntegrationsConfigured ? 200 : 503
    );
    expect(healthRes.body.healthy).toBe(
      allIntegrationsConfigured
    );
    expect(healthRes.body.status).toBe(
      allIntegrationsConfigured ? 'ok' : 'not_ready'
    );
  });

  it('4.1 - Capability Registry exposes authoritative status for all features', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/capabilities');
    expect(res.status).toBe(200);
    expect(res.body.capabilities).toBeDefined();
    expect(Array.isArray(res.body.capabilities)).toBe(true);

    const cardCap = res.body.capabilities.find((c: any) => c.id === 'card_payment');
    expect(cardCap).toBeDefined();
    expect(['available', 'beta']).toContain(cardCap.status);

    const imageCap = res.body.capabilities.find((c: any) => c.id === 'image_generation');
    expect(imageCap).toBeDefined();
    expect(['available', 'beta']).toContain(imageCap.status);
  });
});
