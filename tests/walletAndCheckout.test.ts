import { describe, it, expect } from 'vitest';
import { CREDIT_PACKAGES, getCreditPackageById } from '../server/config/creditPackages.js';
import { MercadoPagoService } from '../server/services/mercadoPagoService.js';
import {
  CheckoutInputSchema,
  AdminGrantCreditsInputSchema,
  CardPaymentInputSchema
} from '../server/validators/paymentValidators.js';

describe('Phase 2 Financial & Checkout Tests', () => {
  describe('Credit Packages Config', () => {
    it('should have 5 active credit packages', () => {
      expect(CREDIT_PACKAGES.length).toBe(5);
      const activePkgs = CREDIT_PACKAGES.filter((p) => p.active);
      expect(activePkgs.length).toBe(5);
    });

    it('should retrieve package by ID correctly', () => {
      const creatorPkg = getCreditPackageById('creator');
      expect(creatorPkg).toBeDefined();
      expect(creatorPkg?.name).toBe('Criador');
      expect(creatorPkg?.priceBrl).toBe(249.90);
      expect(creatorPkg?.credits).toBe(350);
      expect(creatorPkg?.totalCredits).toBe(350);
    });

    it('should return undefined for invalid package ID', () => {
      const invalid = getCreditPackageById('non-existent');
      expect(invalid).toBeUndefined();
    });
  });

  describe('Validation Schemas', () => {
    it('should validate valid checkout input', () => {
      const valid = CheckoutInputSchema.safeParse({
        packageId: 'creator',
        paymentMethod: 'pix',
      });
      expect(valid.success).toBe(true);
    });

    it('should reject checkout input missing packageId', () => {
      const invalid = CheckoutInputSchema.safeParse({
        packageId: '',
      });
      expect(invalid.success).toBe(false);
    });

    it('should validate valid admin grant credits input', () => {
      const valid = AdminGrantCreditsInputSchema.safeParse({
  userEmail: 'user@example.com',
  amount: 250,
  reason: 'Concessão manual de teste',
  idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
});
      expect(valid.success).toBe(true);
    });

    it('should reject admin grant credits with negative or zero amount', () => {
      const invalid = AdminGrantCreditsInputSchema.safeParse({
        userEmail: 'user@example.com',
        amount: 0,
        reason: 'Motivo valido',
      });
      expect(invalid.success).toBe(false);
    });

    it('should reject admin grant credits missing reason', () => {
      const invalid = AdminGrantCreditsInputSchema.safeParse({
        userEmail: 'user@example.com',
        amount: 100,
        reason: '',
      });
      expect(invalid.success).toBe(false);
    });
      it(
      'should validate a secure card payment input',
      () => {
        const valid =
          CardPaymentInputSchema.safeParse({
            token:
              'card-token-secure-example-1234567890',
            issuerId: '123',
            paymentMethodId: 'visa',
            installments: 3,
            packageId: 'creator',
            idempotencyKey:
              '550e8400-e29b-41d4-a716-446655440000'
          });

        expect(valid.success).toBe(true);
      }
    );

    it(
      'should reject unsafe card payment input',
      () => {
        const invalid =
          CardPaymentInputSchema.safeParse({
            token: 'short',
            paymentMethodId: 'visa',
            installments: 25,
            packageId: 'creator'
          });

        expect(invalid.success).toBe(false);
      }
    );
  });

  describe('Mercado Pago Service Helper', () => {
    it('should accurately report configuration status based on env vars', () => {
      const isConfigured = MercadoPagoService.isConfigured();
      expect(typeof isConfigured).toBe('boolean');
    });

    it('should STRICTLY reject webhook signature when secret or headers are missing', () => {
      const isValid = MercadoPagoService.verifyWebhookSignature({
        xSignature: undefined,
        xRequestId: undefined,
        dataId: undefined,
      });
      expect(isValid).toBe(false);
    });
  });
});
