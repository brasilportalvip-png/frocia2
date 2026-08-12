import { z } from 'zod';

export const CheckoutInputSchema = z.object({
  packageId: z.string().min(1, 'ID do pacote é obrigatório'),
  paymentMethod: z.enum(['pix']).default('pix'),
});

export const AdminGrantCreditsInputSchema = z.object({
  userEmail: z.string().email('E-mail inválido').optional(),
  userId: z.string().optional(),
  amount: z.number().int('Quantidade de créditos deve ser um valor inteiro').positive('Quantidade de créditos deve ser maior que zero').max(50000, 'Limite máximo por concessão é 50.000 créditos'),
  reason: z.string().min(3, 'O motivo/justificativa deve conter no mínimo 3 caracteres'),
  idempotencyKey: z
  .string()
  .uuid('A chave de idempotência deve ser um UUID válido'),
}).refine((data) => Boolean(data.userEmail || data.userId), {
  message: 'Informe o e-mail ou o ID do usuário de destino.',
});

export const CardPaymentInputSchema = z.object({
  token: z
    .string()
    .min(20, 'Token de cartão inválido')
    .max(4000, 'Token de cartão excede o limite permitido'),

  issuerId: z
    .union([
      z.string(),
      z.number()
    ])
    .optional(),

  paymentMethodId: z
    .string()
    .min(1, 'Método de pagamento obrigatório')
    .max(50, 'Método de pagamento inválido')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Método de pagamento inválido'
    ),

  installments: z
    .coerce
    .number()
    .int('Número de parcelas inválido')
    .min(1, 'O pagamento deve ter pelo menos uma parcela')
    .max(24, 'O pagamento não pode exceder 24 parcelas')
    .default(1),

  packageId: z
    .string()
    .min(1, 'Pacote de créditos obrigatório')
    .max(100, 'Identificador de pacote inválido'),

  idempotencyKey: z
    .string()
    .uuid('A chave de idempotência deve ser um UUID válido')
});

export type CheckoutInput =
  z.infer<typeof CheckoutInputSchema>;

export type AdminGrantCreditsInput =
  z.infer<typeof AdminGrantCreditsInputSchema>;

export type CardPaymentInput =
  z.infer<typeof CardPaymentInputSchema>;