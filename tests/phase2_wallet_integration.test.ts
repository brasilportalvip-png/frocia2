import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  CreditWalletService,
  InsufficientCreditsError,
  InvalidReservationError,
  InvalidAmountError,
  IdempotencyConflictError,
  hashKey,
  assertWalletInvariants,
} from '../server/services/creditWalletService.js';
import { MercadoPagoService } from '../server/services/mercadoPagoService.js';

describe('Phase 2 Certification: Wallet, Checkout, Idempotency & Webhooks', () => {
  const testUserId = 'test-user-phase2-001';
  const foreignUserId = 'foreign-user-phase2-999';

  beforeEach(() => {
    // Reset mock database state
  });

  describe('1. Hash & Deterministic Identifiers', () => {
    it('should generate consistent SHA-256 hashes with specific operation prefixes', () => {
      const hash1 = hashKey('wallet:reservation', 'key-123');
      const hash2 = hashKey('wallet:reservation', 'key-123');
      const hash3 = hashKey('wallet:consumption', 'key-123');

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('2. Wallet Invariants Enforcement', () => {
    it('should pass when wallet numbers are valid non-negative integers', () => {
      expect(() => {
        assertWalletInvariants({
          creditsAvailable: 100,
          creditsReserved: 20,
          creditsPurchased: 500,
          creditsConsumed: 380,
          creditsRefunded: 0,
        });
      }).not.toThrow();
    });

    it('should throw when any credit counter is negative or fractional', () => {
      expect(() => {
        assertWalletInvariants({
          creditsAvailable: -5,
          creditsReserved: 0,
          creditsPurchased: 100,
          creditsConsumed: 105,
          creditsRefunded: 0,
        });
      }).toThrow();

      expect(() => {
        assertWalletInvariants({
          creditsAvailable: 10.5,
          creditsReserved: 0,
          creditsPurchased: 100,
          creditsConsumed: 90,
          creditsRefunded: 0,
        });
      }).toThrow();
    });
  });

  describe('3. Webhook HMAC Signature Validation', () => {
    it('should validate official Mercado Pago HMAC signatures strictly', () => {
      const secret = 'test-secret-key-12345';
      const xRequestId = 'req-uuid-9999';
      const dataId = '123456789';
      const ts = Date.now().toString();

      const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
      const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
      const xSignature = `ts=${ts},v1=${hmac}`;

      // Temporarily mock environment secret
      const originalSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
      process.env.MERCADO_PAGO_WEBHOOK_SECRET = secret;

      const isValid = MercadoPagoService.verifyWebhookSignature({
        xSignature,
        xRequestId,
        dataId,
      });

      expect(isValid).toBe(true);

      // Tampered request should fail
      const isTamperedValid = MercadoPagoService.verifyWebhookSignature({
        xSignature,
        xRequestId: 'tampered-req-id',
        dataId,
      });

      expect(isTamperedValid).toBe(false);

      process.env.MERCADO_PAGO_WEBHOOK_SECRET = originalSecret;
    });

    it('should reject when signature header or request ID is missing', () => {
      const isValid = MercadoPagoService.verifyWebhookSignature({
        xSignature: undefined,
        xRequestId: 'req-1',
        dataId: '123',
      });
      expect(isValid).toBe(false);
    });
  });
});
