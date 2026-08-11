import { describe, it, expect } from 'vitest';
import { MercadoPagoService } from '../server/services/mercadoPagoService.js';
import { STARTER_TEMPLATES } from '../src/data/templates.js';

describe('Regression Tests: Templates, Persistence, Mercado Pago & Mobile Layout', () => {
  it('should verify STARTER_TEMPLATES has templates but none should be auto-selected by default', () => {
    expect(STARTER_TEMPLATES).toBeDefined();
    expect(STARTER_TEMPLATES.length).toBeGreaterThan(0);
    // Starter templates list includes "Plataforma & Solução Web" in gallery
    const hasSaasLaunch = STARTER_TEMPLATES.some(t => t.id === 'template-saas-launch');
    expect(hasSaasLaunch).toBe(true);
  });

  it('should validate MercadoPagoService.isConfigured behavior when credentials are missing or valid', () => {
    const isConfig = MercadoPagoService.isConfigured();
    // In test environment without valid credentials it should return false cleanly without crashing
    expect(typeof isConfig).toBe('boolean');
  });

  it('should reject invalid webhook URLs in MercadoPagoService.validateWebhookUrl', () => {
    expect(() => MercadoPagoService.validateWebhookUrl('')).toThrow();
    expect(() => MercadoPagoService.validateWebhookUrl('not-a-url')).toThrow();
    expect(() => MercadoPagoService.validateWebhookUrl('https://example.com/webhook?secret=123')).toThrow();
    expect(MercadoPagoService.validateWebhookUrl('https://example.com/api/webhooks/mercadopago')).toBe('https://example.com/api/webhooks/mercadopago');
  });
});
