import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

const urlSchema = z.string().optional().transform((val) => (val === '' ? undefined : val)).refine((val) => {
  if (!val) return true;
  try {
    const url = new URL(val);
    if (isProd) {
      if (url.protocol !== 'https:') return false;
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return false;
    }
    return true;
  } catch {
    return !isProd;
  }
}, {
  message: 'URL inválida, deve ser absoluta e utilizar HTTPS em produção sem localhost.',
});

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: urlSchema.optional(),
  TRUSTED_ORIGINS: z.string().optional(),

  // Gemini AI
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_DEFAULT_MODEL: z.string().default('gemini-3.7-flash'),
  GEMINI_FAST_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_REASONING_MODEL: z.string().default('gemini-3.7-flash'),
  GEMINI_CODE_MODEL: z.string().default('gemini-3.7-flash'),
  GEMINI_VISION_MODEL: z.string().default('gemini-3.7-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-3.6-flash'),
  GEMINI_MODEL_FAILOVER_CHAIN: z
    .string()
    .default(
      'gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite'
    ),

  // Internal Cron & Maintenance
  INTERNAL_CRON_SECRET: z.string().optional(),

  // Firebase Admin SDK
  FIREBASE_SERVICE_ACCOUNT_KEY: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  // Optional application-level encryption for personal memories. When it is
  // absent, personal data is rejected instead of being persisted in cleartext.
  MEMORY_ENCRYPTION_KEY: z.string().optional(),

  // Mercado Pago Config
  MERCADO_PAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADO_PAGO_PUBLIC_KEY: z.string().optional(),
  MERCADO_PAGO_WEBHOOK_SECRET: z.string().optional(),
  MERCADO_PAGO_WEBHOOK_URL: urlSchema.optional(),
  MERCADO_PAGO_SUCCESS_URL: urlSchema.optional(),
  MERCADO_PAGO_PENDING_URL: urlSchema.optional(),
  MERCADO_PAGO_FAILURE_URL: urlSchema.optional(),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    const checkRequired = (key: keyof typeof data, label: string) => {
      const val = data[key];
      if (!val || typeof val !== 'string' || val.trim().length === 0 || val.includes('MY_') || val.includes('PLACEHOLDER')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `A variável de ambiente obrigatória '${label}' não está configurada corretamente para o ambiente de produção.`,
        });
      }
    };

    // Firebase Admin check: JSON key OR trio
    const hasJsonAccount = Boolean(data.FIREBASE_SERVICE_ACCOUNT_KEY && data.FIREBASE_SERVICE_ACCOUNT_KEY.trim().length > 10);
    const hasTrioAccount = Boolean(data.FIREBASE_PROJECT_ID && data.FIREBASE_CLIENT_EMAIL && data.FIREBASE_PRIVATE_KEY);
    if (!hasJsonAccount && !hasTrioAccount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FIREBASE_SERVICE_ACCOUNT_KEY'],
        message: 'Credenciais do Firebase Admin (FIREBASE_SERVICE_ACCOUNT_KEY ou trio PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY) são obrigatórias em produção.',
      });
    }

    checkRequired('GEMINI_API_KEY', 'GEMINI_API_KEY');
    checkRequired('MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_ACCESS_TOKEN');
    checkRequired('MERCADO_PAGO_WEBHOOK_SECRET', 'MERCADO_PAGO_WEBHOOK_SECRET');
    checkRequired('INTERNAL_CRON_SECRET', 'INTERNAL_CRON_SECRET');

    if (data.INTERNAL_CRON_SECRET && (data.INTERNAL_CRON_SECRET.length < 16 || data.INTERNAL_CRON_SECRET.includes('froc-internal-cron-secret-2026'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['INTERNAL_CRON_SECRET'],
        message: 'O segredo INTERNAL_CRON_SECRET em produção deve ter pelo menos 16 caracteres e não pode ser previsível.',
      });
    }
  }
});

export type ServerEnv = z.infer<typeof EnvSchema>;

let parsedEnv: ServerEnv;

const parseResult = EnvSchema.safeParse(process.env);

if (parseResult.success) {
  parsedEnv = parseResult.data;
} else {
  console.warn('⚠️ AVISO DE CONFIGURAÇÃO: Algumas variáveis de ambiente não passaram na validação estrita:');
  for (const issue of parseResult.error.issues) {
    console.warn(`  - [${issue.path.join('.')}]: ${issue.message}`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Configuração de servidor inválida em ambiente de produção. Verifique os logs.');
  }

  // Graceful fallback for development / testing environments
  parsedEnv = {
    NODE_ENV: (process.env.NODE_ENV as any) || 'development',
    PORT: Number(process.env.PORT) || 3000,
    APP_URL: process.env.APP_URL,
    TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_DEFAULT_MODEL: process.env.GEMINI_DEFAULT_MODEL || 'gemini-3.7-flash',
    GEMINI_FAST_MODEL: process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite',
    GEMINI_REASONING_MODEL: process.env.GEMINI_REASONING_MODEL || 'gemini-3.7-flash',
    GEMINI_CODE_MODEL: process.env.GEMINI_CODE_MODEL || 'gemini-3.7-flash',
    GEMINI_VISION_MODEL: process.env.GEMINI_VISION_MODEL || 'gemini-3.7-flash',
    GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
    GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash',
    GEMINI_MODEL_FAILOVER_CHAIN:
      process.env.GEMINI_MODEL_FAILOVER_CHAIN ||
      'gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite',
    INTERNAL_CRON_SECRET: process.env.INTERNAL_CRON_SECRET || 'froc_dev_cron_secret_unpredictable_local_key_32_bytes',
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
    MEMORY_ENCRYPTION_KEY: process.env.MEMORY_ENCRYPTION_KEY,
    MERCADO_PAGO_ACCESS_TOKEN: process.env.MERCADO_PAGO_ACCESS_TOKEN,
    MERCADO_PAGO_PUBLIC_KEY: process.env.MERCADO_PAGO_PUBLIC_KEY,
    MERCADO_PAGO_WEBHOOK_SECRET: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    MERCADO_PAGO_WEBHOOK_URL: process.env.MERCADO_PAGO_WEBHOOK_URL,
    MERCADO_PAGO_SUCCESS_URL: process.env.MERCADO_PAGO_SUCCESS_URL,
    MERCADO_PAGO_PENDING_URL: process.env.MERCADO_PAGO_PENDING_URL,
    MERCADO_PAGO_FAILURE_URL: process.env.MERCADO_PAGO_FAILURE_URL,
  };
}

export const env = parsedEnv;
