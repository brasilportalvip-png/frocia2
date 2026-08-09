import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MercadoPagoService } from '../server/services/mercadoPagoService.js';
import crypto from 'crypto';

describe('Webhook Signature Security Tests', () => {
  const originalSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const testSecret = 'test_webhook_secret_1234567890';

  beforeEach(() => {
    process.env.MERCADO_PAGO_WEBHOOK_SECRET = testSecret;
  });

  afterEach(() => {
    process.env.MERCADO_PAGO_WEBHOOK_SECRET = originalSecret;
  });

  it('should return false if secret is missing', () => {
    delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    const result = MercadoPagoService.verifyWebhookSignature({
      xSignature: 'ts=1700000000,v1=somehash',
      xRequestId: 'req-123',
      dataId: '123456',
    });
    expect(result).toBe(false);
  });

  it('should return false if headers are missing', () => {
    const result = MercadoPagoService.verifyWebhookSignature({
      xSignature: undefined,
      xRequestId: 'req-123',
      dataId: '123456',
    });
    expect(result).toBe(false);
  });

  it('should return false on forged or invalid HMAC signature', () => {
    const result = MercadoPagoService.verifyWebhookSignature({
      xSignature: 'ts=1700000000,v1=badhash0000000000000000000000000000000000000000000000000000000',
      xRequestId: 'req-123',
      dataId: '123456',
    });
    expect(result).toBe(false);
  });

  it('should return true on valid HMAC signature matching ts, dataId, xRequestId and secret', () => {
    const ts = '1700000000';
    const dataId = '987654321';
    const xRequestId = 'req-uuid-abc';

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const computedHash = crypto
      .createHmac('sha256', testSecret)
      .update(manifest)
      .digest('hex');

    const xSignature = `ts=${ts},v1=${computedHash}`;

    const isValid = MercadoPagoService.verifyWebhookSignature({
      xSignature,
      xRequestId,
      dataId,
    });

    expect(isValid).toBe(true);
  });

  it('should validate webhook URL format and enforce HTTPS in production', () => {
    expect(() => MercadoPagoService.validateWebhookUrl('')).toThrow();
    expect(() => MercadoPagoService.validateWebhookUrl('invalid-url')).toThrow();
    expect(() => MercadoPagoService.validateWebhookUrl('https://example.com/webhook?secret=123')).toThrow();

    const validUrl = MercadoPagoService.validateWebhookUrl('https://froc.ia/api/payments/webhook');
    expect(validUrl).toBe('https://froc.ia/api/payments/webhook');
  });
});
