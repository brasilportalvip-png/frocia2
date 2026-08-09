import { MercadoPagoConfig, Payment } from 'mercadopago';
import crypto from 'crypto';

export class PaymentProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderConfigurationError';
  }
}

export class PaymentCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentCreationError';
  }
}

export class PaymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentValidationError';
  }
}

export interface CreatePixPaymentInput {
  userId: string;
  packageId: string;
  packageName: string;
  amountBrl: number;
  userEmail: string;
  externalReference: string;
  idempotencyKey: string;
}

export interface MercadoPagoPaymentResult {
  providerPaymentId: string;
  status: string;
  statusDetail?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
  expiresAt?: string;
  liveMode?: boolean;
}

export class MercadoPagoService {
  private static getClient(): MercadoPagoConfig {
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!accessToken || accessToken.trim().length === 0) {
      throw new PaymentProviderConfigurationError(
        'MERCADO_PAGO_ACCESS_TOKEN não está configurado nas variáveis de ambiente do servidor.'
      );
    }
    return new MercadoPagoConfig({
      accessToken,
      options: { timeout: 10000 },
    });
  }

  public static isConfigured(): boolean {
    const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    return Boolean(token && token.trim().length > 0 && !token.includes('MY_'));
  }

  /**
   * Validates if a webhook URL is absolute, valid HTTPS in production, and contains no secret tokens in query string.
   */
  public static validateWebhookUrl(urlStr?: string): string {
    if (!urlStr || urlStr.trim().length === 0) {
      throw new PaymentProviderConfigurationError(
        'URL de webhook obrigatoria (MERCADO_PAGO_WEBHOOK_URL ou APP_URL) nao configurada no servidor.'
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(urlStr.trim());
    } catch {
      throw new PaymentProviderConfigurationError(
        'URL de webhook invalida. Deve ser uma URL absoluta completa.'
      );
    }

    if (parsed.search.includes('secret') || parsed.search.includes('token') || parsed.search.includes('key')) {
      throw new PaymentProviderConfigurationError(
        'URL de webhook nao pode conter segredos ou tokens na query string.'
      );
    }

    if (process.env.NODE_ENV === 'production') {
      if (parsed.protocol !== 'https:') {
        throw new PaymentProviderConfigurationError(
          'URL de webhook em producao exige protocolo obrigatorio HTTPS.'
        );
      }
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        throw new PaymentProviderConfigurationError(
          'URL de webhook em producao nao pode utilizar localhost.'
        );
      }
    }

    return parsed.toString();
  }

  /**
   * Creates an official Pix payment charge with Mercado Pago.
   */
  public static async createPixPayment(input: CreatePixPaymentInput): Promise<MercadoPagoPaymentResult> {
    const client = this.getClient();
    const payment = new Payment(client);

    const rawWebhookUrl = process.env.MERCADO_PAGO_WEBHOOK_URL ||
      (process.env.APP_URL ? `${process.env.APP_URL}/api/payments/webhook` : undefined);

    const validatedWebhookUrl = this.validateWebhookUrl(rawWebhookUrl);

    const body: any = {
      transaction_amount: input.amountBrl,
      description: `Froc.IA - ${input.packageName}`,
      payment_method_id: 'pix',
      payer: {
        email: input.userEmail,
      },
      external_reference: input.externalReference,
      notification_url: validatedWebhookUrl,
    };

    try {
      const response = await payment.create({
        body,
        requestOptions: {
          idempotencyKey: input.idempotencyKey,
        },
      });

      const poi = response.point_of_interaction?.transaction_data;

      return {
        providerPaymentId: String(response.id),
        status: response.status || 'pending',
        statusDetail: response.status_detail || undefined,
        qrCode: poi?.qr_code || undefined,
        qrCodeBase64: poi?.qr_code_base64 || undefined,
        ticketUrl: poi?.ticket_url || undefined,
        expiresAt: response.date_of_expiration || undefined,
        liveMode: response.live_mode ?? undefined,
      };
    } catch (error: any) {
      console.error('❌ Erro no Mercado Pago SDK ao criar Pix:', error?.message || error);
      throw new PaymentCreationError(
        `Nao foi possivel iniciar o pagamento com o provedor: ${error?.message || 'Erro desconhecido'}`
      );
    }
  }

  /**
   * Fetches official payment information by Mercado Pago payment ID.
   */
  public static async getPaymentById(paymentId: string): Promise<{
    id: string;
    status: string;
    statusDetail: string;
    externalReference: string;
    transactionAmount: number;
    currencyId: string;
    liveMode: boolean;
    dateApproved?: string;
  }> {
    const client = this.getClient();
    const payment = new Payment(client);

    try {
      const response = await payment.get({ id: paymentId });
      return {
        id: String(response.id),
        status: response.status || 'unknown',
        statusDetail: response.status_detail || '',
        externalReference: response.external_reference || '',
        transactionAmount: Number(response.transaction_amount || 0),
        currencyId: response.currency_id || 'BRL',
        liveMode: Boolean(response.live_mode),
        dateApproved: response.date_approved || undefined,
      };
    } catch (error: any) {
      console.error(`❌ Erro ao consultar pagamento ${paymentId} no Mercado Pago:`, error?.message || error);
      throw new PaymentValidationError(
        `Nao foi possivel verificar a cobranca no provedor de pagamento.`
      );
    }
  }

  /**
   * Validates x-signature header from Mercado Pago webhook.
   * STRICT SECURITY: Returns false if secret, headers, timestamp or HMAC match fails.
   */
  public static verifyWebhookSignature(params: {
    xSignature: string | undefined;
    xRequestId: string | undefined;
    dataId: string | undefined;
  }): boolean {
    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;

    // RULE 2 & 3: NO BYPASS allowed. Missing secret ALWAYS returns false.
    if (!secret || secret.trim().length === 0) {
      console.error('❌ MERCADO_PAGO_WEBHOOK_SECRET nao configurado no servidor. Rejeitando webhook por seguranca.');
      return false;
    }

    if (!params.xSignature || !params.xRequestId || !params.dataId) {
      return false;
    }

    try {
      // xSignature format: "ts=1700000000,v1=a1b2c3d4..."
      const parts = params.xSignature.split(',');
      let ts = '';
      let hash = '';

      for (const part of parts) {
        const [key, value] = part.split('=');
        if (key && value) {
          if (key.trim() === 'ts') ts = value.trim();
          if (key.trim() === 'v1') hash = value.trim();
        }
      }

      if (!ts || !hash) return false;

      // Validate timestamp is a valid number
      const tsNum = Number(ts);
      if (isNaN(tsNum) || tsNum <= 0) return false;

      // Validate timestamp freshness (max 10 minutes past, max 5 minutes future)
      const nowSeconds = Math.floor(Date.now() / 1000);
      let tsSeconds = tsNum;
      if (tsNum > 10000000000) {
        tsSeconds = Math.floor(tsNum / 1000);
      }
      if (process.env.NODE_ENV === 'production') {
        const age = nowSeconds - tsSeconds;
        if (age > 600 || age < -300) {
          console.warn(`⚠️ Webhook Mercado Pago rejeitado por timestamp fora da janela de seguranca (ts: ${tsSeconds}, agora: ${nowSeconds})`);
          return false;
        }
      }

      // Official Mercado Pago Manifest structure
      const manifest = `id:${params.dataId};request-id:${params.xRequestId};ts:${ts};`;
      const computedHash = crypto
        .createHmac('sha256', secret)
        .update(manifest)
        .digest('hex');

      // RULE 4: Safe length-check before crypto.timingSafeEqual
      const computedBuffer = Buffer.from(computedHash, 'utf8');
      const receivedBuffer = Buffer.from(hash, 'utf8');

      if (computedBuffer.length !== receivedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(computedBuffer, receivedBuffer);
    } catch (err) {
      console.error('Erro na verificacao HMAC do webhook:', err);
      return false;
    }
  }
}
