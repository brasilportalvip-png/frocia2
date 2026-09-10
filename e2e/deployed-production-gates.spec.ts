import { expect, test } from '@playwright/test';

test.describe('Gates do ambiente implantado', () => {
  test.skip(
    !process.env.E2E_BASE_URL,
    'Defina E2E_BASE_URL para executar o smoke test contra staging ou produção.'
  );

  test('deployment público está vivo e integralmente pronto', async ({ request }) => {
    const live = await request.get('/api/live');
    expect(live.status()).toBe(200);
    await expect(live.json()).resolves.toMatchObject({ status: 'live' });

    const ready = await request.get('/api/ready');
    expect(ready.status()).toBe(200);
    const payload = await ready.json();
    expect(payload.status).toBe('ready');
    expect(payload.checks).toMatchObject({
      firebaseAdminConfigured: true,
      firestoreReachable: true,
      geminiConfigured: true,
      mercadoPagoConfigured: true,
      internalMaintenanceConfigured: true,
      automaticBackupConfigured: true,
      migrationsCurrent: true,
    });
  });

  test('deployment aplica cabeçalhos de segurança', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['content-security-policy']).toContain("default-src 'self'");
  });
});
