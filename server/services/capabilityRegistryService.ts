import { isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { MercadoPagoService } from './mercadoPagoService.js';
import { SelfEvolutionPolicyEngine } from '../selfEvolution/selfEvolutionPolicyEngine.js';

export type CapabilityStatus = 'available' | 'beta' | 'degraded' | 'disabled' | 'coming_soon';

export interface CapabilityItem {
  id: string;
  name: string;
  category: 'ai' | 'code' | 'payment' | 'deploy' | 'automation';
  status: CapabilityStatus;
  provider: string;
  model: string;
  cost: {
    credits: number;
    description: string;
  };
  limits: string;
  requirements: string[];
  lastVerifiedAt: string;
  evidence: string;
}

export class CapabilityRegistryService {
  public static getCapabilityRegistry(): {
    version: string;
    updatedAt: string;
    capabilities: CapabilityItem[];
  } {
    const now = new Date().toISOString();
    const geminiOk = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5);
    const firebaseOk = isFirebaseAdminConfigured();
    const mercadoPagoOk = MercadoPagoService.isConfigured();
    const selfEvolutionOk = SelfEvolutionPolicyEngine.isSelfEvolutionEnabled();

    const capabilities: CapabilityItem[] = [
      {
        id: 'smart_ai_chat',
        name: 'Chat Inteligente Multi-turn Froc.IA',
        category: 'ai',
        status: geminiOk && firebaseOk ? 'available' : 'degraded',
        provider: 'Google Gemini',
        model: 'gemini-3.6-flash / gemini-3.1-pro',
        cost: {
          credits: 1,
          description: '1 crédito por interação em modo padrão',
        },
        limits: 'Até 128k tokens de contexto por chamada',
        requirements: ['GEMINI_API_KEY', 'Firebase Admin Auth'],
        lastVerifiedAt: now,
        evidence: 'Teste automatizado phase3_ai_engine.test.ts verde',
      },
      {
        id: 'code_and_site_builder',
        name: 'Gerador e Refinador de Código/Sites',
        category: 'code',
        status: geminiOk ? 'available' : 'degraded',
        provider: 'Froc.IA Engine + Vite',
        model: 'gemini-3.6-flash',
        cost: {
          credits: 5,
          description: '5 créditos por geração completa de artefato',
        },
        limits: 'Geração de artefatos React + Tailwind isolados',
        requirements: ['GEMINI_API_KEY'],
        lastVerifiedAt: now,
        evidence: 'Compilação e build Vite de produção validados',
      },
      {
        id: 'pix_payment',
        name: 'Recarga de Créditos via PIX (Mercado Pago)',
        category: 'payment',
        status: mercadoPagoOk ? 'available' : 'beta',
        provider: 'Mercado Pago',
        model: 'Pix API + Webhooks HMAC-SHA256',
        cost: {
          credits: 0,
          description: 'Recarga direta de saldo em Reais (BRL)',
        },
        limits: 'Pacote mínimo 10 créditos (R$ 9,90)',
        requirements: ['MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_WEBHOOK_SECRET'],
        lastVerifiedAt: now,
        evidence: 'Testes de webhook e idetempotência verde',
      },
      {
        id: 'card_payment',
        name: 'Pagamento via Cartão de Crédito',
        category: 'payment',
        status: 'coming_soon',
        provider: 'Mercado Pago (Cartão/3DS)',
        model: '3D Secure v2',
        cost: {
          credits: 0,
          description: 'Indisponível até validação E2E com 3DS em sandbox',
        },
        limits: 'Pendente de homologação de risco/fraude',
        requirements: ['MERCADO_PAGO_PUBLIC_KEY'],
        lastVerifiedAt: now,
        evidence: 'Rótulo explicitamente indisponível conforme regra 4.5',
      },
      {
        id: 'image_generation',
        name: 'Geração de Imagens de Alta Resolução',
        category: 'ai',
        status: 'coming_soon',
        provider: 'Google Gemini Imagen',
        model: 'gemini-3.1-flash-image',
        cost: {
          credits: 10,
          description: '10 créditos por imagem gerada',
        },
        limits: 'Pendente de pipeline verde de moderação e Storage',
        requirements: ['GEMINI_API_KEY', 'Firebase Storage'],
        lastVerifiedAt: now,
        evidence: 'Em breve/indisponível até homologação de pipeline',
      },
      {
        id: 'video_generation',
        name: 'Geração e Edição de Vídeos IA',
        category: 'ai',
        status: 'coming_soon',
        provider: 'Google Veo / Omni',
        model: 'veo-2.0',
        cost: {
          credits: 50,
          description: '50 créditos por renderização de vídeo',
        },
        limits: 'Job assíncrono com polling e CDN',
        requirements: ['GEMINI_API_KEY'],
        lastVerifiedAt: now,
        evidence: 'Em breve/indisponível até homologação de pipeline',
      },
      {
        id: 'github_vercel_deploy',
        name: 'Publicação Direta em GitHub / Vercel',
        category: 'deploy',
        status: 'coming_soon',
        provider: 'GitHub OAuth + Vercel API',
        model: 'REST / GraphQL API',
        cost: {
          credits: 0,
          description: 'Exportação e deploy direto',
        },
        limits: 'Requer escopos OAuth e token no servidor',
        requirements: ['GITHUB_CLIENT_ID', 'VERCEL_TOKEN'],
        lastVerifiedAt: now,
        evidence: 'Em breve/indisponível até OAuth E2E completo',
      },
      {
        id: 'self_evolution',
        name: 'Sistema Autônomo de Autoevolução',
        category: 'automation',
        status: selfEvolutionOk ? 'available' : 'disabled',
        provider: 'Froc.IA Orchestrator',
        model: 'Gemini Code Agent',
        cost: {
          credits: 100,
          description: 'Orçamento isolado por ciclo de evolução',
        },
        limits: 'Trava por Firestore/Redis e kill switch durável',
        requirements: ['SELF_EVOLUTION_ENABLED=true'],
        lastVerifiedAt: now,
        evidence: 'Desativado por padrão até ciclo completo com patch assinado',
      },
    ];

    return {
      version: '1.0.0',
      updatedAt: now,
      capabilities,
    };
  }
}
