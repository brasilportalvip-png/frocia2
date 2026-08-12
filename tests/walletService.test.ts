import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  hashKey,
  assertWalletInvariants,
  InsufficientCreditsError,
  InvalidReservationError,
  InvalidAmountError,
  IdempotencyConflictError,
  CreditWalletService,
} from '../server/services/creditWalletService.js';
import { adminDb } from '../server/lib/firebaseAdmin.js';

describe('Credit Wallet Service Unit & Identity Tests', () => {
  it('should compute deterministic SHA-256 hash with unique prefixes for each operation type', () => {
    const key = 'gen-test-session-123';
    const userId = 'user-abc';
    const op = 'Generate Site';

    const resId = hashKey('credit-reservation', `${userId}:${op}:${key}`);
    const txReserveId = hashKey('wallet:reservation', key);
    const txConsumeId = hashKey('wallet:consumption', key);
    const txReleaseId = hashKey('wallet:release', key);
    const txExpireId = hashKey('wallet:expire', `${resId}:sys-key`);



const txPurchaseId =
  hashKey('wallet:purchase', key);

const txReversalId =
  hashKey(
    'wallet:purchase-reversal',
    key
  );

const txGrantId =
  hashKey('wallet:admin-grant', key);

// Assert that all generated IDs are distinct SHA-256 64-char hex strings
const allIds = [
  resId,
  txReserveId,
  txConsumeId,
  txReleaseId,
  txExpireId,
  txPurchaseId,
  txReversalId,
  txGrantId
];

expect(allIds.length).toBe(8);



    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(8);

    allIds.forEach((id) => {
      expect(id).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  it('should validate wallet invariants correctly', () => {
    expect(() =>
      assertWalletInvariants({
        creditsAvailable: 100,
        creditsReserved: 50,
        creditsPurchased: 150,
        creditsConsumed: 0,
        creditsRefunded: 0,
      })
    ).not.toThrow();

    expect(() =>
      assertWalletInvariants({
        creditsAvailable: -10,
        creditsReserved: 50,
        creditsPurchased: 150,
        creditsConsumed: 0,
        creditsRefunded: 0,
      })
    ).toThrow(/invariantes/i);

    expect(() =>
      assertWalletInvariants({
        creditsAvailable: 100,
        creditsReserved: 10.5,
        creditsPurchased: 150,
        creditsConsumed: 0,
        creditsRefunded: 0,
      })
    ).toThrow(/invariantes/i);
  });

  it('should throw InsufficientCreditsError with clear message', () => {
    const err = new InsufficientCreditsError('Saldo insuficiente.');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InsufficientCreditsError');
    expect(err.message).toBe('Saldo insuficiente.');
  });

  it('should throw InvalidReservationError with clear message', () => {
    const err = new InvalidReservationError('Reserva invalida.');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InvalidReservationError');
    expect(err.message).toBe('Reserva invalida.');
  });

  it('should throw InvalidAmountError with clear message', () => {
    const err = new InvalidAmountError('Quantidade invalida.');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InvalidAmountError');
  });

  it('should throw IdempotencyConflictError with clear message', () => {
    const err = new IdempotencyConflictError('Conflito de idempotencia.');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('IdempotencyConflictError');
  });
});

describe('Credit Wallet Transactional Simulation Tests', () => {
  // In-memory store simulating Firestore documents & runTransaction
  let store: Map<string, any>;

  beforeEach(() => {
    store = new Map<string, any>();

    // Mock adminDb.runTransaction
    vi.spyOn(adminDb, 'runTransaction').mockImplementation(async (updateFunction: any) => {
      const transactionMock = {
        get: async (ref: any) => {
          const path = ref.path;
          const data = store.get(path);
          return {
            exists: Boolean(data),
            data: () => data,
            id: path.split('/').pop(),
          };
        },
        set: (ref: any, data: any) => {
          store.set(ref.path, { ...data });
        },
        update: (ref: any, data: any) => {
          const current = store.get(ref.path) || {};
          store.set(ref.path, { ...current, ...data });
        },
      };

      return updateFunction(transactionMock);
    });
  });

  it('should complete full cycle: reserve -> confirm consumption integral', async () => {
    const userId = 'user-test-1';
    store.set(`users/${userId}`, {
      creditsAvailable: 1000,
      creditsReserved: 0,
      creditsConsumed: 0,
      creditsPurchased: 1000,
      creditsRefunded: 0,
    });

    const key = 'idem-gen-100';

    // 1. Reserve 200 credits
    const reserveRes = await CreditWalletService.reserveCredits({
      userId,
      amount: 200,
      operation: 'Generacao de Site',
      idempotencyKey: key,
    });

    expect(reserveRes.success).toBe(true);
    expect(reserveRes.reservationId).toBeDefined();
    expect(reserveRes.availableAfter).toBe(800);
    expect(reserveRes.reservedAfter).toBe(200);

    const userStateAfterReserve = store.get(`users/${userId}`);
    expect(userStateAfterReserve.creditsAvailable).toBe(800);
    expect(userStateAfterReserve.creditsReserved).toBe(200);

    const resDoc = store.get(`credit_reservations/${reserveRes.reservationId}`);
    expect(resDoc.status).toBe('reserved');
    expect(resDoc.amountReserved).toBe(200);

    // 2. Confirm integral consumption (200 credits)
    const confirmRes = await CreditWalletService.confirmConsumption({
      userId,
      reservationId: reserveRes.reservationId,
      amountConsumed: 200,
      idempotencyKey: key,
    });

    expect(confirmRes.success).toBe(true);
    expect(confirmRes.availableAfter).toBe(800);

    const userStateAfterConfirm = store.get(`users/${userId}`);
    expect(userStateAfterConfirm.creditsAvailable).toBe(800);
    expect(userStateAfterConfirm.creditsReserved).toBe(0);
    expect(userStateAfterConfirm.creditsConsumed).toBe(200);

    const resDocAfterConfirm = store.get(`credit_reservations/${reserveRes.reservationId}`);
    expect(resDocAfterConfirm.status).toBe('confirmed');
    expect(resDocAfterConfirm.amountConsumed).toBe(200);
  });

  it('should refund unconsumed credits on partial consumption', async () => {
    const userId = 'user-test-2';
    store.set(`users/${userId}`, {
      creditsAvailable: 1000,
      creditsReserved: 0,
      creditsConsumed: 0,
      creditsPurchased: 1000,
      creditsRefunded: 0,
    });

    const key = 'idem-gen-partial';

    // Reserve 200
    const reserveRes = await CreditWalletService.reserveCredits({
      userId,
      amount: 200,
      operation: 'Generacao Parcial',
      idempotencyKey: key,
    });

    expect(reserveRes.availableAfter).toBe(800);
    expect(reserveRes.reservedAfter).toBe(200);

    // Confirm only 120 consumed (80 unconsumed should return to available)
    const confirmRes = await CreditWalletService.confirmConsumption({
      userId,
      reservationId: reserveRes.reservationId,
      amountConsumed: 120,
      idempotencyKey: key,
    });

    expect(confirmRes.availableAfter).toBe(880);

    const userState = store.get(`users/${userId}`);
    expect(userState.creditsAvailable).toBe(880);
    expect(userState.creditsReserved).toBe(0);
    expect(userState.creditsConsumed).toBe(120);
  });

  it('should handle release on AI failure correctly', async () => {
    const userId = 'user-test-3';
    store.set(`users/${userId}`, {
      creditsAvailable: 500,
      creditsReserved: 0,
      creditsConsumed: 0,
      creditsPurchased: 500,
      creditsRefunded: 0,
    });

    const key = 'idem-gen-fail';

    // Reserve 200
    const reserveRes = await CreditWalletService.reserveCredits({
      userId,
      amount: 200,
      operation: 'Generacao com falha',
      idempotencyKey: key,
    });

    expect(reserveRes.availableAfter).toBe(300);

    // Release reservation
    const releaseRes = await CreditWalletService.releaseReservation({
      userId,
      reservationId: reserveRes.reservationId,
      reason: 'AI Execution Error',
      idempotencyKey: key,
    });

    expect(releaseRes.availableAfter).toBe(500);

    const userState = store.get(`users/${userId}`);
    expect(userState.creditsAvailable).toBe(500);
    expect(userState.creditsReserved).toBe(0);

    const resDoc = store.get(`credit_reservations/${reserveRes.reservationId}`);
    expect(resDoc.status).toBe('released');
  });

  it('should block confirming consumption greater than reserved amount', async () => {
    const userId = 'user-test-4';
    store.set(`users/${userId}`, {
      creditsAvailable: 1000,
      creditsReserved: 0,
      creditsConsumed: 0,
      creditsPurchased: 1000,
      creditsRefunded: 0,
    });

    const key = 'idem-exceed';

    const reserveRes = await CreditWalletService.reserveCredits({
      userId,
      amount: 100,
      operation: 'Reserva Pequena',
      idempotencyKey: key,
    });

    // Attempt to confirm 150 (exceeds 100)
    await expect(
      CreditWalletService.confirmConsumption({
        userId,
        reservationId: reserveRes.reservationId,
        amountConsumed: 150,
        idempotencyKey: key,
      })
    ).rejects.toThrow(InvalidReservationError);
  });

  it('should prevent confirming reservation belonging to another user', async () => {
    const userId1 = 'user-test-5a';
    const userId2 = 'user-test-5b';
    store.set(`users/${userId1}`, { creditsAvailable: 500, creditsReserved: 0 });
    store.set(`users/${userId2}`, { creditsAvailable: 500, creditsReserved: 0 });

    const key = 'idem-owner-check';

    const reserveRes = await CreditWalletService.reserveCredits({
      userId: userId1,
      amount: 100,
      operation: 'Reserva User 1',
      idempotencyKey: key,
    });

    // User 2 attempts to confirm User 1's reservation
    await expect(
      CreditWalletService.confirmConsumption({
        userId: userId2,
        reservationId: reserveRes.reservationId,
        amountConsumed: 100,
        idempotencyKey: key,
      })
    ).rejects.toThrow(InvalidReservationError);
  });

  it('should handle duplicate confirmation idempotently without double deduction', async () => {
    const userId = 'user-test-6';
    store.set(`users/${userId}`, {
      creditsAvailable: 1000,
      creditsReserved: 0,
      creditsConsumed: 0,
      creditsPurchased: 1000,
      creditsRefunded: 0,
    });

    const key = 'idem-dup-confirm';

    const reserveRes = await CreditWalletService.reserveCredits({
      userId,
      amount: 200,
      operation: 'Reserva Dup Test',
      idempotencyKey: key,
    });

    // First confirmation
    const res1 = await CreditWalletService.confirmConsumption({
      userId,
      reservationId: reserveRes.reservationId,
      amountConsumed: 200,
      idempotencyKey: key,
    });

    expect(res1.availableAfter).toBe(800);

    // Second confirmation with same idempotency key
    const res2 = await CreditWalletService.confirmConsumption({
      userId,
      reservationId: reserveRes.reservationId,
      amountConsumed: 200,
      idempotencyKey: key,
    });

    expect(res2.availableAfter).toBe(800);

    const userState = store.get(`users/${userId}`);
    expect(userState.creditsConsumed).toBe(200); // Consumed only once!
  });

  it('should handle reservation expiration via expireReservation', async () => {
    const userId = 'user-test-7';
    store.set(`users/${userId}`, {
      creditsAvailable: 500,
      creditsReserved: 0,
      creditsConsumed: 0,
      creditsPurchased: 500,
      creditsRefunded: 0,
    });

    const key = 'idem-expire-test';

    const reserveRes = await CreditWalletService.reserveCredits({
      userId,
      amount: 150,
      operation: 'Reserva a Expirar',
      idempotencyKey: key,
    });

    expect(reserveRes.availableAfter).toBe(350);

    // Expire reservation
    const expireRes = await CreditWalletService.expireReservation({
      userId,
      reservationId: reserveRes.reservationId,
      systemIdempotencyKey: 'sys-cron-expire-1',
    });

    expect(expireRes.availableAfter).toBe(500);

    const userState = store.get(`users/${userId}`);
    expect(userState.creditsAvailable).toBe(500);
    expect(userState.creditsReserved).toBe(0);

    const resDoc = store.get(`credit_reservations/${reserveRes.reservationId}`);
    expect(resDoc.status).toBe('expired');
  });

  it('should process credit purchase idempotently (webhook scenario)', async () => {
    const userId = 'user-test-8';
    const paymentId = 'pay-doc-123';

    store.set(`users/${userId}`, {
      creditsAvailable: 100,
      creditsReserved: 0,
      creditsConsumed: 0,
      creditsPurchased: 100,
      creditsRefunded: 0,
    });

    store.set(`payments/${paymentId}`, {
      userId,
      baseCredits: 300,
      bonusCredits: 50,
      amountBrl: 119,
      credited: false,
    });

    const idempotencyKey = `credit-${paymentId}`;

    // First credit purchase (webhook trigger 1)
    const p1 = await CreditWalletService.creditPurchase({
      userId,
      paymentDocumentId: paymentId,
      providerPaymentId: 'mp-pay-999',
      baseCredits: 300,
      bonusCredits: 50,
      amountBrl: 119,
      idempotencyKey,
    });

    expect(p1.availableAfter).toBe(450);

    const userState1 = store.get(`users/${userId}`);
    expect(userState1.creditsAvailable).toBe(450);
    expect(userState1.creditsPurchased).toBe(450);

    const payDoc1 = store.get(`payments/${paymentId}`);
    expect(payDoc1.credited).toBe(true);

    // Second credit purchase (duplicate webhook trigger 2)
    const p2 = await CreditWalletService.creditPurchase({
      userId,
      paymentDocumentId: paymentId,
      providerPaymentId: 'mp-pay-999',
      baseCredits: 300,
      bonusCredits: 50,
      amountBrl: 119,
      idempotencyKey,
    });

    expect(p2.availableAfter).toBe(450);

    const userState2 =
  store.get(`users/${userId}`);

expect(
  userState2.creditsAvailable
).toBe(450); // No double credit!
  });

  it(
    'should reverse a refunded purchase idempotently',
    async () => {
      const userId =
        'user-refund-complete';

      const paymentId =
        'payment-refund-complete';

      store.set(`users/${userId}`, {
        creditsAvailable: 450,
        creditsReserved: 0,
        creditsConsumed: 0,
        creditsPurchased: 450,
        creditsRefunded: 0,
        creditDebt: 0,
        walletRestricted: false
      });

      store.set(
        `payments/${paymentId}`,
        {
          userId,
          providerPaymentId:
            'mp-refund-001',
          baseCredits: 300,
          bonusCredits: 50,
          totalCredits: 350,
          amountBrl: 119,
          status: 'approved',
          credited: true,
          refundedCredits: false
        }
      );

      const params = {
        userId,
        paymentDocumentId:
          paymentId,
        providerPaymentId:
          'mp-refund-001',
        reason: 'refund' as const,
        idempotencyKey:
          `refund-${paymentId}`
      };

      const first =
        await CreditWalletService.reverseCreditPurchase(
          params
        );

      expect(
        first.availableAfter
      ).toBe(100);

      expect(
        first.reversedCredits
      ).toBe(350);

      expect(
        first.outstandingCredits
      ).toBe(0);

      expect(
        first.walletRestricted
      ).toBe(false);

      const firstUserState =
        store.get(`users/${userId}`);

      expect(
        firstUserState.creditsAvailable
      ).toBe(100);

      expect(
        firstUserState.creditsRefunded
      ).toBe(350);

      expect(
        firstUserState.creditDebt
      ).toBe(0);

      const firstPaymentState =
        store.get(
          `payments/${paymentId}`
        );

      expect(
        firstPaymentState.refundedCredits
      ).toBe(true);

      expect(
        firstPaymentState.status
      ).toBe('refunded');

      const second =
        await CreditWalletService.reverseCreditPurchase(
          params
        );

      expect(
        second.availableAfter
      ).toBe(100);

      expect(
        store.get(`users/${userId}`)
          .creditsAvailable
      ).toBe(100);

      expect(
        store.get(`users/${userId}`)
          .creditsRefunded
      ).toBe(350);
    }
  );

  it(
    'should record debt and restrict wallet after chargeback of spent credits',
    async () => {
      const userId =
        'user-chargeback-debt';

      const paymentId =
        'payment-chargeback-debt';

      store.set(`users/${userId}`, {
        creditsAvailable: 100,
        creditsReserved: 0,
        creditsConsumed: 250,
        creditsPurchased: 350,
        creditsRefunded: 0,
        creditDebt: 0,
        walletRestricted: false
      });

      store.set(
        `payments/${paymentId}`,
        {
          userId,
          providerPaymentId:
            'mp-chargeback-001',
          baseCredits: 300,
          bonusCredits: 50,
          totalCredits: 350,
          amountBrl: 119,
          status: 'approved',
          credited: true,
          refundedCredits: false
        }
      );

      const reversal =
        await CreditWalletService.reverseCreditPurchase(
          {
            userId,
            paymentDocumentId:
              paymentId,
            providerPaymentId:
              'mp-chargeback-001',
            reason:
              'chargeback',
            idempotencyKey:
              `chargeback-${paymentId}`
          }
        );

      expect(
        reversal.availableAfter
      ).toBe(0);

      expect(
        reversal.reversedCredits
      ).toBe(100);

      expect(
        reversal.outstandingCredits
      ).toBe(250);

      expect(
        reversal.walletRestricted
      ).toBe(true);

      const userState =
        store.get(`users/${userId}`);

      expect(
        userState.creditsAvailable
      ).toBe(0);

      expect(
        userState.creditDebt
      ).toBe(250);

      expect(
        userState.walletRestricted
      ).toBe(true);

      await expect(
        CreditWalletService.reserveCredits(
          {
            userId,
            amount: 1,
            operation:
              'Tentativa após chargeback',
            idempotencyKey:
              'blocked-after-chargeback'
          }
        )
      ).rejects.toThrow(
        InsufficientCreditsError
      );
    }
  );
});

