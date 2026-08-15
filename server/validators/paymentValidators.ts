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
  idempotencyKey: z.string().optional(),
}).refine((data) => Boolean(data.userEmail || data.userId), {
  message: 'Informe o e-mail ou o ID do usuário de destino.',
});

export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;
export type AdminGrantCreditsInput = z.infer<typeof AdminGrantCreditsInputSchema>;
