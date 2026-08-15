import { adminDb } from '../lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import crypto from 'crypto';

export class WalletUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletUnavailableError';
  }
}

export class InsufficientCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientCreditsError';
  }
}

export class InvalidReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReservationError';
  }
}

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAmountError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export interface WalletBalance {
  available: number;
  reserved: number;
  purchased: number;
  consumed: number;
  refunded: number;
  updatedAt: string;
}

export interface ReserveCreditsParams {
  userId: string;
  amount: number;
  operation: string;
  idempotencyKey: string;
}

export interface ReserveCreditsResult {
  success: true;
  reservationId: string;
  availableAfter: number;
  reservedAfter: number;
}

export interface ConfirmConsumptionParams {
  userId: string;
  reservationId: string;
  amountConsumed: number;
  operation?: string;
  idempotencyKey: string;
}

export interface ConfirmConsumptionResult {
  success: true;
  availableAfter: number;
}

export interface ReleaseReservationParams {
  userId: string;
  reservationId: string;
  operation?: string;
  reason?: string;
  idempotencyKey: string;
}

export interface ReleaseReservationResult {
  success: true;
  availableAfter: number;
}

export interface ExpireReservationParams {
  userId: string;
  reservationId: string;
  systemIdempotencyKey: string;
}

export interface ExpireReservationResult {
  success: true;
  availableAfter: number;
}

export interface CreditPurchaseParams {
  userId: string;
  paymentDocumentId: string;
  providerPaymentId: string | null;
  baseCredits: number;
  bonusCredits: number;
  amountBrl: number;
  idempotencyKey: string;
}

export interface GrantCreditsByAdminParams {
  adminUid: string;
  targetUserId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
}

export interface ProvisionUserParams {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role?: 'admin' | 'user';
}

export function hashKey(prefix: string, key: string): string {
  return crypto.createHash('sha256').update(`${prefix}:${key}`).digest('hex');
}

export function assertWalletInvariants(wallet: {
  creditsAvailable: number;
  creditsReserved: number;
  creditsPurchased: number;
  creditsConsumed: number;
  creditsRefunded: number;
}): void {
  if (
    !Number.isInteger(wallet.creditsAvailable) ||
    !Number.isInteger(wallet.creditsReserved) ||
    !Number.isInteger(wallet.creditsPurchased) ||
    !Number.isInteger(wallet.creditsConsumed) ||
    !Number.isInteger(wallet.creditsRefunded) ||
    wallet.creditsAvailable < 0 ||
    wallet.creditsReserved < 0 ||
    wallet.creditsPurchased < 0 ||
    wallet.creditsConsumed < 0 ||
    wallet.creditsRefunded < 0
  ) {
    throw new Error('Violação das invariantes da carteira: valores de créditos inconsistentes ou negativos.');
  }
}

export class CreditWalletService {
  /**
   * Reads current user wallet balance from Firestore users/{userId}.
   */
  static async getBalance(userId: string): Promise<WalletBalance> {
    if (!adminDb) {
      throw new WalletUnavailableError('Banco de dados indisponível (adminDb não inicializado).');
    }

    try {
      const userRef = adminDb.collection('users').doc(userId);
      const snap = await userRef.get();

      if (!snap.exists) {
        return {
          available: 0,
          reserved: 0,
          purchased: 0,
          consumed: 0,
          refunded: 0,
          updatedAt: new Date().toISOString(),
        };
      }

      const data = snap.data() || {};
      return {
        available: Number(data.creditsAvailable ?? data.creditsRemaining ?? 0),
        reserved: Number(data.creditsReserved ?? 0),
        purchased: Number(data.creditsPurchased ?? 0),
        consumed: Number(data.creditsConsumed ?? 0),
        refunded: Number(data.creditsRefunded ?? 0),
        updatedAt: data.updatedAt
          ? data.updatedAt.toDate
            ? data.updatedAt.toDate().toISOString()
            : new Date(data.updatedAt).toISOString()
          : new Date().toISOString(),
      };
    } catch (error) {
      console.error('❌ Firestore read failed in CreditWalletService.getBalance:', error);
      throw new WalletUnavailableError('Serviço de carteira e saldo temporariamente indisponível.');
    }
  }

  /**
   * Reserves credits for an upcoming operation with deterministic doc ID & reservation tracking.
   */
  static async reserveCredits(params: ReserveCreditsParams): Promise<ReserveCreditsResult> {
    const { userId, amount, operation, idempotencyKey } = params;

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new InvalidAmountError('A quantidade de creditos para reserva deve ser um inteiro positivo.');
    }

    const reservationId = hashKey('credit-reservation', `${userId}:${operation}:${idempotencyKey}`);
    const txDocId = hashKey('wallet:reservation', idempotencyKey);
    const payloadHash = hashKey('payload:reservation', JSON.stringify({ userId, amount, operation, idempotencyKey }));

    return adminDb.runTransaction(async (transaction) => {
      const txRef = adminDb.collection('credit_transactions').doc(txDocId);
      const txSnap = await transaction.get(txRef);

      if (txSnap.exists) {
        const existing = txSnap.data() || {};
        if (
          existing.userId !== userId ||
          existing.amount !== amount ||
          (existing.payloadHash && existing.payloadHash !== payloadHash)
        ) {
          throw new IdempotencyConflictError('Chave de idempotencia reutilizada com parametros conflitantes.');
        }
        return {
          success: true,
          reservationId,
          availableAfter: Number(existing.balanceAfter),
          reservedAfter: Number(existing.reservedAfter),
        };
      }

      const userRef = adminDb.collection('users').doc(userId);
      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) {
        throw new Error('Usuario nao encontrado na base de dados.');
      }

      const data = userSnap.data() || {};
      const availableBefore = Number(data.creditsAvailable ?? data.creditsRemaining ?? 0);
      const reservedBefore = Number(data.creditsReserved ?? 0);
      const purchasedBefore = Number(data.creditsPurchased ?? 0);
      const consumedBefore = Number(data.creditsConsumed ?? 0);
      const refundedBefore = Number(data.creditsRefunded ?? 0);

      // Strict balance check (NO Math.max)
      if (availableBefore < amount) {
        throw new InsufficientCreditsError(
          `Saldo insuficiente de creditos. Saldo disponivel: ${availableBefore}, necessario: ${amount}.`
        );
      }

      const availableAfter = availableBefore - amount;
      const reservedAfter = reservedBefore + amount;

      assertWalletInvariants({
        creditsAvailable: availableAfter,
        creditsReserved: reservedAfter,
        creditsPurchased: purchasedBefore,
        creditsConsumed: consumedBefore,
        creditsRefunded: refundedBefore,
      });

      // 1. Update user wallet
      transaction.update(userRef, {
        creditsAvailable: availableAfter,
        creditsRemaining: availableAfter,
        creditsReserved: reservedAfter,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 2. Create reservation document
      const resRef = adminDb.collection('credit_reservations').doc(reservationId);
      transaction.set(resRef, {
        id: reservationId,
        userId,
        operation,
        amountReserved: amount,
        amountConsumed: null,
        amountReleased: null,
        status: 'reserved',
        idempotencyKey,
        reservationTransactionId: txDocId,
        payloadHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min expiration
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 3. Create statement transaction log
      transaction.set(txRef, {
        userId,
        paymentDocumentId: null,
        providerPaymentId: null,
        type: 'reservation',
        amount,
        balanceBefore: availableBefore,
        balanceAfter: availableAfter,
        reservedBefore,
        reservedAfter,
        operation,
        reservationId,
        payloadHash,
        status: 'confirmed',
        idempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { success: true, reservationId, availableAfter, reservedAfter };
    });
  }

  /**
   * Confirms consumption of reserved credits with deterministic doc ID.
   */
  static async confirmConsumption(params: ConfirmConsumptionParams): Promise<ConfirmConsumptionResult> {
    const { userId, reservationId, amountConsumed, operation, idempotencyKey } = params;

    if (!Number.isInteger(amountConsumed) || amountConsumed < 0) {
      throw new InvalidAmountError('A quantidade consumida deve ser um inteiro positivo ou zero.');
    }

    if (!reservationId) {
      throw new InvalidReservationError('ID de reserva e obrigatorio para confirmacao.');
    }

    const txDocId = hashKey('wallet:consumption', idempotencyKey);
    const payloadHash = hashKey('payload:consumption', JSON.stringify({ userId, reservationId, amountConsumed, idempotencyKey }));

    return adminDb.runTransaction(async (transaction) => {
      const txRef = adminDb.collection('credit_transactions').doc(txDocId);
      const txSnap = await transaction.get(txRef);

      if (txSnap.exists) {
        const existing = txSnap.data() || {};
        if (
          existing.userId !== userId ||
          existing.reservationId !== reservationId ||
          (existing.payloadHash && existing.payloadHash !== payloadHash)
        ) {
          throw new IdempotencyConflictError('Chave de idempotencia pertencente a outro usuario ou com parametros conflitantes.');
        }
        return { success: true, availableAfter: Number(existing.balanceAfter) };
      }

      const resRef = adminDb.collection('credit_reservations').doc(reservationId);
      const resSnap = await transaction.get(resRef);

      if (!resSnap.exists) {
        throw new InvalidReservationError('Reserva nao encontrada na base de dados.');
      }

      const resData = resSnap.data() || {};

      if (resData.userId !== userId) {
        throw new InvalidReservationError('A reserva solicitada pertence a outro usuario.');
      }

      if (resData.status !== 'reserved') {
        throw new InvalidReservationError(`A reserva nao esta no estado reservado. Estado atual: ${resData.status}.`);
      }

      const expiresAtMs = resData.expiresAt
        ? resData.expiresAt.toDate
          ? resData.expiresAt.toDate().getTime()
          : new Date(resData.expiresAt).getTime()
        : Infinity;

      if (expiresAtMs <= Date.now()) {
        throw new InvalidReservationError('A reserva solicitada esta expirada.');
      }

      const amountReserved = Number(resData.amountReserved || 0);

      if (amountConsumed > amountReserved) {
        throw new InvalidReservationError(`O valor consumido (${amountConsumed}) excede o valor reservado (${amountReserved}).`);
      }

      const userRef = adminDb.collection('users').doc(userId);
      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) {
        throw new Error('Usuario nao encontrado.');
      }

      const data = userSnap.data() || {};
      const availableBefore = Number(data.creditsAvailable ?? data.creditsRemaining ?? 0);
      const reservedBefore = Number(data.creditsReserved ?? 0);
      const consumedBefore = Number(data.creditsConsumed ?? 0);
      const purchasedBefore = Number(data.creditsPurchased ?? 0);
      const refundedBefore = Number(data.creditsRefunded ?? 0);

      if (reservedBefore < amountReserved) {
        throw new InvalidReservationError(
          `Reserva invalida. Reservado na conta: ${reservedBefore}, solicitado para confirmar: ${amountReserved}.`
        );
      }

      const reservedAfter = reservedBefore - amountReserved;
      const unconsumedRefund = amountReserved - amountConsumed;
      const availableAfter = availableBefore + unconsumedRefund;
      const consumedAfter = consumedBefore + amountConsumed;

      assertWalletInvariants({
        creditsAvailable: availableAfter,
        creditsReserved: reservedAfter,
        creditsPurchased: purchasedBefore,
        creditsConsumed: consumedAfter,
        creditsRefunded: refundedBefore,
      });

      transaction.update(userRef, {
        creditsAvailable: availableAfter,
        creditsRemaining: availableAfter,
        creditsReserved: reservedAfter,
        creditsConsumed: consumedAfter,
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.update(resRef, {
        amountConsumed,
        status: 'confirmed',
        consumptionTransactionId: txDocId,
        confirmedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(txRef, {
        userId,
        paymentDocumentId: null,
        providerPaymentId: null,
        type: 'consumption',
        amount: amountConsumed,
        amountReserved,
        unconsumedRefund,
        balanceBefore: availableBefore,
        balanceAfter: availableAfter,
        reservedBefore,
        reservedAfter,
        operation: operation || resData.operation || 'Confirmacao de consumo de creditos',
        reservationId,
        payloadHash,
        status: 'confirmed',
        idempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { success: true, availableAfter };
    });
  }

  /**
   * Releases reserved credits back to available balance.
   */
  static async releaseReservation(params: ReleaseReservationParams): Promise<ReleaseReservationResult> {
    const { userId, reservationId, operation, reason, idempotencyKey } = params;

    if (!reservationId) {
      throw new InvalidReservationError('ID de reserva e obrigatorio para liberacao.');
    }

    const txDocId = hashKey('wallet:release', idempotencyKey);
    const payloadHash = hashKey('payload:release', JSON.stringify({ userId, reservationId, idempotencyKey }));

    return adminDb.runTransaction(async (transaction) => {
      const txRef = adminDb.collection('credit_transactions').doc(txDocId);
      const txSnap = await transaction.get(txRef);

      if (txSnap.exists) {
        const existing = txSnap.data() || {};
        if (
          existing.userId !== userId ||
          existing.reservationId !== reservationId ||
          (existing.payloadHash && existing.payloadHash !== payloadHash)
        ) {
          throw new IdempotencyConflictError('Chave de idempotencia pertencente a outro usuario ou com parametros conflitantes.');
        }
        return { success: true, availableAfter: Number(existing.balanceAfter) };
      }

      const resRef = adminDb.collection('credit_reservations').doc(reservationId);
      const resSnap = await transaction.get(resRef);

      if (!resSnap.exists) {
        throw new InvalidReservationError('Reserva nao encontrada na base de dados.');
      }

      const resData = resSnap.data() || {};

      if (resData.userId !== userId) {
        throw new InvalidReservationError('A reserva solicitada pertence a outro usuario.');
      }

      if (resData.status !== 'reserved') {
        throw new InvalidReservationError(`A reserva nao esta disponivel para liberacao. Estado atual: ${resData.status}.`);
      }

      const amountReserved = Number(resData.amountReserved || 0);

      const userRef = adminDb.collection('users').doc(userId);
      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) {
        throw new Error('Usuario nao encontrado.');
      }

      const data = userSnap.data() || {};
      const availableBefore = Number(data.creditsAvailable ?? data.creditsRemaining ?? 0);
      const reservedBefore = Number(data.creditsReserved ?? 0);
      const consumedBefore = Number(data.creditsConsumed ?? 0);
      const purchasedBefore = Number(data.creditsPurchased ?? 0);
      const refundedBefore = Number(data.creditsRefunded ?? 0);

      if (reservedBefore < amountReserved) {
        throw new InvalidReservationError('Incapaz de liberar reserva inexistente ou com valor superior ao reservado.');
      }

      const reservedAfter = reservedBefore - amountReserved;
      const availableAfter = availableBefore + amountReserved;

      assertWalletInvariants({
        creditsAvailable: availableAfter,
        creditsReserved: reservedAfter,
        creditsPurchased: purchasedBefore,
        creditsConsumed: consumedBefore,
        creditsRefunded: refundedBefore,
      });

      transaction.update(userRef, {
        creditsAvailable: availableAfter,
        creditsRemaining: availableAfter,
        creditsReserved: reservedAfter,
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.update(resRef, {
        status: 'released',
        amountReleased: amountReserved,
        releaseReason: reason || 'system_or_user_released',
        releaseTransactionId: txDocId,
        releasedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(txRef, {
        userId,
        paymentDocumentId: null,
        providerPaymentId: null,
        type: 'release',
        amount: amountReserved,
        balanceBefore: availableBefore,
        balanceAfter: availableAfter,
        reservedBefore,
        reservedAfter,
        operation: operation || resData.operation || 'Liberacao de reserva de creditos',
        reservationId,
        payloadHash,
        status: 'confirmed',
        idempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { success: true, availableAfter };
    });
  }

  /**
   * Expires a reservation, returning credits from reserved to available balance.
   */
  static async expireReservation(params: ExpireReservationParams): Promise<ExpireReservationResult> {
    const { userId, reservationId, systemIdempotencyKey } = params;

    const txDocId = hashKey('wallet:expire', `${reservationId}:${systemIdempotencyKey}`);

    return adminDb.runTransaction(async (transaction) => {
      const txRef = adminDb.collection('credit_transactions').doc(txDocId);
      const txSnap = await transaction.get(txRef);

      if (txSnap.exists) {
        const existing = txSnap.data() || {};
        return { success: true, availableAfter: Number(existing.balanceAfter) };
      }

      const resRef = adminDb.collection('credit_reservations').doc(reservationId);
      const resSnap = await transaction.get(resRef);

      if (!resSnap.exists) {
        throw new InvalidReservationError('Reserva nao encontrada.');
      }

      const resData = resSnap.data() || {};

      if (userId && resData.userId !== userId) {
        throw new InvalidReservationError('A reserva pertence a outro usuario.');
      }

      if (resData.status !== 'reserved') {
        throw new InvalidReservationError(`A reserva nao esta em estado de reserva ativa. Estado atual: ${resData.status}.`);
      }

      const resUserId = resData.userId;
      const amountReserved = Number(resData.amountReserved || 0);

      const userRef = adminDb.collection('users').doc(resUserId);
      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) {
        throw new Error('Usuario nao encontrado.');
      }

      const data = userSnap.data() || {};
      const availableBefore = Number(data.creditsAvailable ?? data.creditsRemaining ?? 0);
      const reservedBefore = Number(data.creditsReserved ?? 0);
      const consumedBefore = Number(data.creditsConsumed ?? 0);
      const purchasedBefore = Number(data.creditsPurchased ?? 0);
      const refundedBefore = Number(data.creditsRefunded ?? 0);

      const actualRefund = Math.min(amountReserved, reservedBefore);
      const reservedAfter = Math.max(0, reservedBefore - actualRefund);
      const availableAfter = availableBefore + actualRefund;

      assertWalletInvariants({
        creditsAvailable: availableAfter,
        creditsReserved: reservedAfter,
        creditsPurchased: purchasedBefore,
        creditsConsumed: consumedBefore,
        creditsRefunded: refundedBefore,
      });

      transaction.update(userRef, {
        creditsAvailable: availableAfter,
        creditsRemaining: availableAfter,
        creditsReserved: reservedAfter,
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.update(resRef, {
        status: 'expired',
        expiredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(txRef, {
        userId: resUserId,
        paymentDocumentId: null,
        providerPaymentId: null,
        type: 'expiration',
        amount: amountReserved,
        balanceBefore: availableBefore,
        balanceAfter: availableAfter,
        reservedBefore,
        reservedAfter,
        operation: 'Expiracao de reserva de creditos',
        reservationId,
        status: 'confirmed',
        idempotencyKey: systemIdempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { success: true, availableAfter };
    });
  }

  /**
   * Credits purchased tokens to user upon approved payment with deterministic doc ID.
   */
  static async creditPurchase(params: CreditPurchaseParams): Promise<{ success: boolean; availableAfter: number }> {
    const {
      userId,
      paymentDocumentId,
      providerPaymentId,
      baseCredits,
      bonusCredits,
      idempotencyKey,
    } = params;

    const totalCredits = baseCredits + bonusCredits;
    const txDocId = hashKey('wallet:purchase', idempotencyKey);
    const payloadHash = hashKey('payload:purchase', JSON.stringify({ userId, paymentDocumentId, totalCredits, idempotencyKey }));

    return adminDb.runTransaction(async (transaction) => {
      // 1. Idempotency check with deterministic doc path
      const txRef = adminDb.collection('credit_transactions').doc(txDocId);
      const txSnap = await transaction.get(txRef);

      if (txSnap.exists) {
        const existingTx = txSnap.data() || {};
        return { success: true, availableAfter: Number(existingTx.balanceAfter) };
      }

      // 2. Read payment document
      const paymentRef = adminDb.collection('payments').doc(paymentDocumentId);
      const paymentSnap = await transaction.get(paymentRef);

      if (!paymentSnap.exists) {
        throw new Error(`Pagamento ${paymentDocumentId} nao encontrado no Firestore.`);
      }

      const paymentData = paymentSnap.data() || {};

      if (paymentData.credited === true) {
        const userSnap = await transaction.get(adminDb.collection('users').doc(userId));
        const currentBal = Number(userSnap.data()?.creditsAvailable ?? 0);
        return { success: true, availableAfter: currentBal };
      }

      // 3. Read user doc
      const userRef = adminDb.collection('users').doc(userId);
      const userSnap = await transaction.get(userRef);

      let availableBefore = 0;
      let purchasedBefore = 0;
      let reservedBefore = 0;
      let consumedBefore = 0;
      let refundedBefore = 0;

      if (userSnap.exists) {
        const uData = userSnap.data() || {};
        availableBefore = Number(uData.creditsAvailable ?? uData.creditsRemaining ?? 0);
        purchasedBefore = Number(uData.creditsPurchased ?? 0);
        reservedBefore = Number(uData.creditsReserved ?? 0);
        consumedBefore = Number(uData.creditsConsumed ?? 0);
        refundedBefore = Number(uData.creditsRefunded ?? 0);
      }

      const availableAfter = availableBefore + totalCredits;
      const purchasedAfter = purchasedBefore + totalCredits;

      assertWalletInvariants({
        creditsAvailable: availableAfter,
        creditsReserved: reservedBefore,
        creditsPurchased: purchasedAfter,
        creditsConsumed: consumedBefore,
        creditsRefunded: refundedBefore,
      });

      // 4. Update user profile doc
      if (userSnap.exists) {
        transaction.update(userRef, {
          creditsAvailable: availableAfter,
          creditsRemaining: availableAfter,
          creditsPurchased: purchasedAfter,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(userRef, {
          uid: userId,
          creditsAvailable: availableAfter,
          creditsRemaining: availableAfter,
          creditsReserved: 0,
          creditsPurchased: purchasedAfter,
          creditsConsumed: 0,
          creditsRefunded: 0,
          role: 'user',
          plan: 'free',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // 5. Update payment document to approved & credited
      transaction.update(paymentRef, {
        status: 'approved',
        credited: true,
        creditedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 6. Record statement transaction
      transaction.set(txRef, {
        userId,
        paymentDocumentId,
        providerPaymentId,
        type: 'purchase',
        amount: totalCredits,
        balanceBefore: availableBefore,
        balanceAfter: availableAfter,
        reservedBefore,
        reservedAfter: reservedBefore,
        operation: `Compra de pacote: +${baseCredits} creditos (+${bonusCredits} bonus)`,
        payloadHash,
        status: 'confirmed',
        idempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { success: true, availableAfter };
    });
  }

  /**
   * Admin manual grant of credits with deterministic doc ID.
   */
  static async grantCreditsByAdmin(params: GrantCreditsByAdminParams): Promise<{ success: boolean; availableAfter: number }> {
    const { adminUid, targetUserId, amount, reason, idempotencyKey } = params;

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new InvalidAmountError('A quantidade de creditos concedida deve ser um inteiro positivo.');
    }

    if (amount > 50000) {
      throw new InvalidAmountError('A quantidade de creditos excede o limite maximo por operacao (50.000).');
    }

    if (!reason || reason.trim().length < 3) {
      throw new Error('E obrigatorio informar uma justificativa valida com no minimo 3 caracteres.');
    }

    const txDocId = hashKey('wallet:admin-grant', idempotencyKey);
    const payloadHash = hashKey('payload:grant', JSON.stringify({ adminUid, targetUserId, amount, reason, idempotencyKey }));

    return adminDb.runTransaction(async (transaction) => {
      const txRef = adminDb.collection('credit_transactions').doc(txDocId);
      const txSnap = await transaction.get(txRef);

      if (txSnap.exists) {
        const existingTx = txSnap.data() || {};
        return { success: true, availableAfter: Number(existingTx.balanceAfter) };
      }

      const userRef = adminDb.collection('users').doc(targetUserId);
      const userSnap = await transaction.get(userRef);

      let availableBefore = 0;
      let reservedBefore = 0;
      let purchasedBefore = 0;
      let consumedBefore = 0;
      let refundedBefore = 0;

      if (userSnap.exists) {
        const uData = userSnap.data() || {};
        availableBefore = Number(uData.creditsAvailable ?? uData.creditsRemaining ?? 0);
        reservedBefore = Number(uData.creditsReserved ?? 0);
        purchasedBefore = Number(uData.creditsPurchased ?? 0);
        consumedBefore = Number(uData.creditsConsumed ?? 0);
        refundedBefore = Number(uData.creditsRefunded ?? 0);
      }

      const availableAfter = availableBefore + amount;

      assertWalletInvariants({
        creditsAvailable: availableAfter,
        creditsReserved: reservedBefore,
        creditsPurchased: purchasedBefore,
        creditsConsumed: consumedBefore,
        creditsRefunded: refundedBefore,
      });

      if (userSnap.exists) {
        transaction.update(userRef, {
          creditsAvailable: availableAfter,
          creditsRemaining: availableAfter,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(userRef, {
          uid: targetUserId,
          creditsAvailable: availableAfter,
          creditsRemaining: availableAfter,
          creditsReserved: 0,
          creditsPurchased: amount,
          creditsConsumed: 0,
          creditsRefunded: 0,
          role: 'user',
          plan: 'free',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      transaction.set(txRef, {
        userId: targetUserId,
        grantedByAdminUid: adminUid,
        paymentDocumentId: null,
        providerPaymentId: null,
        type: 'admin_grant',
        amount,
        balanceBefore: availableBefore,
        balanceAfter: availableAfter,
        reservedBefore,
        reservedAfter: reservedBefore,
        operation: `Concessao administrativa: ${reason}`,
        payloadHash,
        status: 'confirmed',
        idempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { success: true, availableAfter };
    });
  }

  /**
   * Provision user profile with welcome credits (10 credits) using transactional ledger with key `welcome-credit:${userId}`.
   */
  static async provisionUserWithWelcomeCredits(params: ProvisionUserParams): Promise<{
    profile: {
      uid: string;
      email: string;
      displayName: string;
      avatarUrl: string;
      role: 'admin' | 'user';
      plan: string;
      creditsAvailable: number;
      creditsReserved: number;
    };
    credited: boolean;
  }> {
    if (!adminDb) {
      throw new WalletUnavailableError('Banco de dados indisponível (adminDb não inicializado).');
    }

    const { userId, email, displayName, avatarUrl = '', role = 'user' } = params;
    const idempotencyKey = `welcome-credit:${userId}`;
    const txDocId = hashKey('wallet:welcome', idempotencyKey);
    const payloadHash = hashKey('payload:welcome', JSON.stringify({ userId, email, idempotencyKey }));

    return adminDb.runTransaction(async (transaction) => {
      const txRef = adminDb.collection('credit_transactions').doc(txDocId);
      const txSnap = await transaction.get(txRef);

      const userRef = adminDb.collection('users').doc(userId);
      const userSnap = await transaction.get(userRef);

      if (txSnap.exists && userSnap.exists) {
        const uData = userSnap.data() || {};
        const avail = Number(uData.creditsAvailable ?? uData.creditsRemaining ?? 10);
        const resv = Number(uData.creditsReserved ?? 0);
        return {
          profile: {
            uid: userId,
            email: uData.email || email,
            displayName: uData.displayName || uData.name || displayName,
            avatarUrl: uData.avatarUrl || avatarUrl,
            role: uData.role || role,
            plan: uData.plan || 'Inicial',
            creditsAvailable: avail,
            creditsReserved: resv,
          },
          credited: false,
        };
      }

      let availableBefore = 0;
      let reservedBefore = 0;
      let purchasedBefore = 0;
      let consumedBefore = 0;
      let refundedBefore = 0;
      let existingData: any = {};

      if (userSnap.exists) {
        existingData = userSnap.data() || {};
        availableBefore = Number(existingData.creditsAvailable ?? existingData.creditsRemaining ?? 0);
        reservedBefore = Number(existingData.creditsReserved ?? 0);
        purchasedBefore = Number(existingData.creditsPurchased ?? 0);
        consumedBefore = Number(existingData.creditsConsumed ?? 0);
        refundedBefore = Number(existingData.creditsRefunded ?? 0);

        if (existingData.welcomeCredited === true || txSnap.exists) {
          return {
            profile: {
              uid: userId,
              email: existingData.email || email,
              displayName: existingData.displayName || existingData.name || displayName,
              avatarUrl: existingData.avatarUrl || avatarUrl,
              role: existingData.role || role,
              plan: existingData.plan || 'Inicial',
              creditsAvailable: availableBefore,
              creditsReserved: reservedBefore,
            },
            credited: false,
          };
        }
      }

      const WELCOME_AMOUNT = 10;
      const availableAfter = availableBefore + WELCOME_AMOUNT;

      assertWalletInvariants({
        creditsAvailable: availableAfter,
        creditsReserved: reservedBefore,
        creditsPurchased: purchasedBefore,
        creditsConsumed: consumedBefore,
        creditsRefunded: refundedBefore,
      });

      const now = new Date();
      const profileToSave = {
        uid: userId,
        email: existingData.email || email || '',
        displayName: existingData.displayName || existingData.name || displayName,
        name: existingData.displayName || existingData.name || displayName,
        avatarUrl: existingData.avatarUrl || avatarUrl,
        role: existingData.role || role,
        plan: existingData.plan || 'Inicial',
        planId: 'plan_inicial',
        creditsAvailable: availableAfter,
        creditsRemaining: availableAfter,
        creditsReserved: reservedBefore,
        creditsPurchased: purchasedBefore,
        creditsConsumed: consumedBefore,
        creditsRefunded: refundedBefore,
        welcomeCredited: true,
        createdAt: existingData.createdAt || now,
        updatedAt: now,
      };

      if (userSnap.exists) {
        transaction.update(userRef, {
          creditsAvailable: availableAfter,
          creditsRemaining: availableAfter,
          welcomeCredited: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(userRef, profileToSave);
      }

      transaction.set(txRef, {
        userId,
        paymentDocumentId: null,
        providerPaymentId: null,
        type: 'welcome_grant',
        amount: WELCOME_AMOUNT,
        balanceBefore: availableBefore,
        balanceAfter: availableAfter,
        reservedBefore,
        reservedAfter: reservedBefore,
        operation: 'Créditos de boas-vindas',
        payloadHash,
        status: 'confirmed',
        idempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        profile: {
          uid: userId,
          email: profileToSave.email,
          displayName: profileToSave.displayName,
          avatarUrl: profileToSave.avatarUrl,
          role: profileToSave.role as 'admin' | 'user',
          plan: profileToSave.plan,
          creditsAvailable: availableAfter,
          creditsReserved: reservedBefore,
        },
        credited: true,
      };
    });
  }
}

