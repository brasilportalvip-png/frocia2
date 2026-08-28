import { isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { MercadoPagoService } from './mercadoPagoService.js';
import { SelfEvolutionPolicyEngine } from '../selfEvolution/selfEvolutionPolicyEngine.js';
import { SocialSearchService } from '../ai/socialSearchService.js';

export type CapabilityStatus =
  | 'available'
  | 'configured'
  | 'beta'
  | 'degraded'
  | 'disabled'
  | 'coming_soon';

export interface CapabilityItem {
  id: string;
  name: string;
  category:
    | 'ai'
    | 'code'
    | 'payment'
    | 'deploy'
    | 'automation';
  status: CapabilityStatus;
  provider: string;
  model: string;
  cost: {
    credits: number;
    description: string;
  };
  limits: string;
  requirements: string[];
  checkedAt: string;
  lastVerifiedAt: string | null;
  evidence: string;
}

export class CapabilityRegistryService {
  public static getCapabilityRegistry(): {
    version: string;
    updatedAt: string;
    capabilities: CapabilityItem[];
  } {
    const now = new Date().toISOString();

    const geminiOk = Boolean(
      process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY.trim().length > 5
    );

    const mediaGeminiOk = Boolean(
      process.env.GEMINI_MEDIA_API_KEY &&
      process.env.GEMINI_MEDIA_API_KEY.trim().length > 5
    );

    const firebaseOk = isFirebaseAdminConfigured();
    const agenticResearchOk = geminiOk && firebaseOk;

    const mercadoPagoOk =
      MercadoPagoService.isConfigured();

    const selfEvolutionOk =
      SelfEvolutionPolicyEngine.isSelfEvolutionEnabled();

    const imageGenerationAvailable =
      mediaGeminiOk &&
      process.env.IMAGE_GENERATION_AVAILABLE === 'true' &&
      process.env.IMAGE_GENERATION_ENABLED === 'true';

    const videoGenerationAvailable =
      mediaGeminiOk &&
      process.env.VIDEO_GENERATION_AVAILABLE === 'true' &&
      process.env.VIDEO_GENERATION_ENABLED === 'true';

    const cardPaymentAvailable =
      mercadoPagoOk &&
      process.env.CARD_PAYMENT_AVAILABLE === 'true';

    const githubDeployAvailable =
      Boolean(
        process.env.GITHUB_TOKEN ||
        process.env.GITHUB_APP_TOKEN
      ) &&
      Boolean(process.env.VERCEL_TOKEN);

    const socialCapabilities =
      SocialSearchService.capabilities();
    const configuredSocialPlatforms =
      socialCapabilities.filter(
        (capability) => capability.configured
      );

    const imageModel =
      process.env.GEMINI_IMAGE_MODEL ||
      'gemini-3.1-flash-image';

    const veoLiteModel =
      process.env.VEO_LITE_MODEL ||
      'veo-3.1-lite-generate-preview';

    const veoFastModel =
      process.env.VEO_FAST_MODEL ||
      'veo-3.1-fast-generate-preview';

    const veoStandardModel =
      process.env.VEO_STANDARD_MODEL ||
      'veo-3.1-generate-preview';

    const capabilities: CapabilityItem[] = [
      {
        id: 'smart_ai_chat',
        name: 'Chat Inteligente Multi-turn Froc.IA',
        category: 'ai',
        status:
          geminiOk && firebaseOk
            ? 'configured'
            : 'degraded',
        provider: 'Google Gemini',
        model:
          `${process.env.GEMINI_DEFAULT_MODEL || 'Gemini Flash'} / ` +
          `${process.env.GEMINI_REASONING_MODEL || 'Gemini Pro'}`,
        cost: {
          credits: 5,
          description:
            '5 créditos no modo Inteligente; outros modos seguem suas faixas oficiais',
        },
        limits:
          'Consumo calculado por modo, tokens e recursos utilizados',
        requirements: [
          'GEMINI_API_KEY',
          'Firebase Admin Auth',
        ],
        checkedAt: now,
        lastVerifiedAt: null,
        evidence:
          'Configuração detectada; execução real do provedor exige recibo separado',
      },
      {
        id: 'agentic_deep_research',
        name: 'Pesquisa Profunda Agêntica',
        category: 'ai',
        status: agenticResearchOk ? 'configured' : 'degraded',
        provider: 'Google Gemini Search Grounding + Froc.IA',
        model: process.env.GEMINI_REASONING_MODEL || 'Gemini Pro',
        cost: {
          credits: 18,
          description:
            'Reserva máxima interna por job; consumo externo depende das buscas e tokens',
        },
        limits:
          'Até quatro subconsultas fundamentadas por job, retomada durável e sem contornar login, paywall, CAPTCHA ou conteúdo privado',
        requirements: [
          'GEMINI_API_KEY',
          'Firebase Admin Auth',
        ],
        checkedAt: now,
        lastVerifiedAt: null,
        evidence: agenticResearchOk
          ? 'Configuração detectada; o coordenador Gemini persiste plano, subconsultas, fontes, citações e avaliação de cobertura.'
          : 'A pesquisa agêntica exige apenas a configuração Gemini e o Firebase já usados pela plataforma.',
      },
      {
        id: 'official_social_search',
        name: 'Pesquisa Oficial em Redes Sociais',
        category: 'automation',
        status:
          configuredSocialPlatforms.length > 0
            ? 'configured'
            : 'disabled',
        provider:
          'YouTube, X, Reddit, Meta e TikTok',
        model: 'APIs oficiais + evidências com permalink',
        cost: {
          credits: 10,
          description:
            'Custo máximo interno por pesquisa; quotas externas dependem de cada plataforma',
        },
        limits:
          'Somente conteúdo permitido pelas APIs, escopos e planos configurados',
        requirements:
          socialCapabilities.flatMap(
            (capability) =>
              capability.configured
                ? []
                : capability.requirements
          ),
        checkedAt: now,
        lastVerifiedAt: null,
        evidence:
          configuredSocialPlatforms.length > 0
            ? `Configuração detectada para: ${configuredSocialPlatforms
                .map((capability) => capability.platform)
                .join(', ')}. A execução real exige recibo da API.`
            : 'Nenhuma credencial social foi detectada; a pesquisa web pública continua separada e não é apresentada como acesso autenticado.',
      },
      {
        id: 'public_site_auditor',
        name: 'Auditoria de Sites e URLs Públicas',
        category: 'automation',
        status: 'available',
        provider: 'Froc.IA Safe Crawler',
        model: 'robots.txt + sitemap + links internos + SHA-256',
        cost: {
          credits: 15,
          description: 'Limite máximo interno por auditoria automática'
        },
        limits:
          'Até 40 páginas na execução manual e 8 no chat; sem contornar login, CAPTCHA, paywall ou robots.txt',
        requirements: ['Firebase Admin Auth'],
        checkedAt: now,
        lastVerifiedAt: null,
        evidence:
          'Crawler público com SSRF, limite de bytes/tempo, status complete/partial/blocked e evidências por página; conteúdo renderizado por JavaScript é declarado como limitação.'
      },
      {
        id: 'code_and_site_builder',
        name: 'Gerador e Refinador de Código/Sites',
        category: 'code',
        status:
          geminiOk && firebaseOk
            ? 'configured'
            : 'degraded',
        provider: 'Froc.IA Engine + Vite',
        model:
          process.env.GEMINI_CODE_MODEL ||
          process.env.GEMINI_DEFAULT_MODEL ||
          'Gemini',
        cost: {
          credits: 40,
          description:
            'Código: 40 a 60 créditos; site completo: 250 a 300 créditos',
        },
        limits:
          'Geração, análise e refinamento de projetos conforme o modo selecionado',
        requirements: [
          'GEMINI_API_KEY',
          'Firebase Admin Auth',
        ],
        checkedAt: now,
        lastVerifiedAt: null,
        evidence:
          'Implementação possui testes locais; publicação de um site exige os gates próprios',
      },
      {
        id: 'pix_payment',
        name: 'Recarga de Créditos via Pix',
        category: 'payment',
        status:
          mercadoPagoOk
            ? 'configured'
            : 'degraded',
        provider: 'Mercado Pago',
        model: 'Pix API + Webhook HMAC-SHA256',
        cost: {
          credits: 0,
          description:
            'Recarga de saldo conforme o pacote escolhido',
        },
        limits:
          'Pacote pago mínimo: 50 créditos por R$ 49,90',
        requirements: [
          'MERCADO_PAGO_ACCESS_TOKEN',
          'MERCADO_PAGO_WEBHOOK_SECRET',
          'MERCADO_PAGO_WEBHOOK_URL',
        ],
        checkedAt: now,
        lastVerifiedAt: null,
        evidence:
          mercadoPagoOk
            ? 'Credenciais detectadas; transação real não foi executada por esta consulta'
            : 'Configuração do Mercado Pago incompleta',
      },
      {
        id: 'card_payment',
        name: 'Pagamento por Cartão de Crédito',
        category: 'payment',
        status:
          cardPaymentAvailable
            ? 'configured'
            : 'beta',
        provider: 'Mercado Pago',
        model: 'Token Checkout',
        cost: {
          credits: 0,
          description:
            'Recarga de saldo conforme o pacote escolhido',
        },
        limits:
          'Permanece em beta até homologação de uma transação real',
        requirements: [
          'MERCADO_PAGO_ACCESS_TOKEN',
          'CARD_PAYMENT_AVAILABLE=true',
        ],
        checkedAt: now,
        lastVerifiedAt: null,
        evidence:
          cardPaymentAvailable
            ? 'Recurso configurado; homologação real continua sem recibo nesta consulta'
            : 'Integração presente, aguardando homologação real',
      },
      {
        id: 'image_generation',
        name: 'Geração de Imagens de Alta Qualidade',
        category: 'ai',
        status:
          imageGenerationAvailable
            ? 'configured'
            : 'disabled',
        provider: 'Google Gemini — Nano Banana 2',
        model: imageModel,
        cost: {
          credits: 18,
          description:
            '18 créditos por imagem 2K concluída',
        },
        limits:
          'Uma imagem 2K por execução; proporções 1:1, 4:3 e 16:9',
        requirements: [
          'GEMINI_MEDIA_API_KEY',
          'IMAGE_GENERATION_AVAILABLE=true',
          'IMAGE_GENERATION_ENABLED=true',
        ],
        checkedAt: now,
        lastVerifiedAt: null,
        evidence:
          imageGenerationAvailable
            ? 'Chave e flags configuradas; geração real ainda exige recibo do provedor'
            : 'Desativado até homologação real e ativação explícita',
      },
      {
        id: 'video_generation',
        name: 'Geração de Vídeos com IA',
        category: 'ai',
        status:
          videoGenerationAvailable
            ? 'configured'
            : 'disabled',
        provider: 'Google Veo 3.1',
        model:
          `Lite: ${veoLiteModel}; ` +
          `Fast: ${veoFastModel}; ` +
          `Standard: ${veoStandardModel}`,
        cost: {
          credits: 30,
          description:
            'Lite: 30; Fast: 46; Standard: 120 créditos',
        },
        limits:
          'Vídeos de 4, 6 ou 8 segundos; formatos 16:9 e 9:16; polling e cancelamento confirmado pelo provedor',
        requirements: [
          'GEMINI_MEDIA_API_KEY',
          'VIDEO_GENERATION_AVAILABLE=true',
          'VIDEO_GENERATION_ENABLED=true',
        ],
        checkedAt: now,
        lastVerifiedAt: null,
        evidence:
          videoGenerationAvailable
            ? 'Chave e flags configuradas; geração real ainda exige recibo do provedor'
            : 'Desativado até homologação real e ativação explícita',
      },
      {
        id: 'github_vercel_deploy',
        name: 'Publicação GitHub e Vercel',
        category: 'deploy',
        status:
          githubDeployAvailable
            ? 'configured'
            : 'disabled',
        provider: 'GitHub + Vercel',
        model: 'Git e APIs de publicação',
        cost: {
          credits: 0,
          description:
            'Publicação não desconta créditos de IA',
        },
        limits:
          'Disponível somente quando as integrações estiverem configuradas no servidor',
        requirements: [
          'GITHUB_TOKEN ou GITHUB_APP_TOKEN',
          'VERCEL_TOKEN',
        ],
        checkedAt: now,
        lastVerifiedAt: null,
        evidence:
          githubDeployAvailable
            ? 'Credenciais presentes; cada publicação precisa de commit e deployment verificados'
            : 'Credenciais necessárias não confirmadas pelo servidor',
      },
      {
        id: 'self_evolution',
        name: 'Autoevolução Supervisionada',
        category: 'automation',
        status:
          selfEvolutionOk
            ? 'beta'
            : 'disabled',
        provider: 'Froc.IA Orchestrator',
        model: 'Agente de Código Supervisionado',
        cost: {
          credits: 100,
          description:
            'Orçamento administrativo isolado por ciclo',
        },
        limits:
          'Exige aprovação humana, worker configurado, PR e verificações',
        requirements: [
          'SELF_EVOLUTION_ENABLED=true',
          'SELF_EVOLUTION_WORKER_URL',
          'SELF_EVOLUTION_WORKER_TOKEN',
        ],
        checkedAt: now,
        lastVerifiedAt: null,
        evidence:
          selfEvolutionOk
            ? 'Recurso ativado em modo supervisionado'
            : 'Desativado por padrão',
      },
    ];

    return {
      version: '1.3.0',
      updatedAt: now,
      capabilities,
    };
  }
}
