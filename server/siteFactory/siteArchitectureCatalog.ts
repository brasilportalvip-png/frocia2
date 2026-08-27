export type SiteProductType =
  | 'landing-page'
  | 'institutional'
  | 'blog'
  | 'store'
  | 'authenticated-portal'
  | 'saas'
  | 'admin-panel'
  | 'booking'
  | 'payments'
  | 'ai-application';

export type SiteQualityGateKey =
  | 'specification'
  | 'architecture'
  | 'clean-install'
  | 'typecheck'
  | 'unit-tests'
  | 'integration-tests'
  | 'api-contract'
  | 'database-migrations'
  | 'e2e-browser'
  | 'responsive-layout'
  | 'accessibility'
  | 'visual-regression'
  | 'security'
  | 'concurrency'
  | 'idempotency'
  | 'load-critical-routes'
  | 'broken-links'
  | 'technical-seo'
  | 'production-build'
  | 'preview-deployment'
  | 'production-deployment'
  | 'public-url-smoke'
  | 'runtime-logs'
  | 'domain-https-headers'
  | 'integration-health'
  | 'rollback-plan'
  | 'monitoring';

export interface SiteArchitectureDefinition {
  id: string;
  name: string;
  status: 'official';
  compatibleProductTypes: SiteProductType[];
  frontend: string[];
  backend: string[];
  data: string[];
  delivery: string[];
  capabilities: string[];
  requiredGates: SiteQualityGateKey[];
  constraints: string[];
}

const BASE_GATES: SiteQualityGateKey[] = [
  'specification',
  'architecture',
  'clean-install',
  'typecheck',
  'unit-tests',
  'integration-tests',
  'e2e-browser',
  'responsive-layout',
  'accessibility',
  'security',
  'broken-links',
  'technical-seo',
  'production-build',
  'preview-deployment',
  'production-deployment',
  'public-url-smoke',
  'runtime-logs',
  'domain-https-headers',
  'rollback-plan',
  'monitoring',
];

const APP_GATES: SiteQualityGateKey[] = [
  ...BASE_GATES,
  'api-contract',
  'database-migrations',
  'concurrency',
  'idempotency',
  'load-critical-routes',
  'integration-health',
];

const COMMERCE_GATES: SiteQualityGateKey[] = [
  ...APP_GATES,
  'visual-regression',
];

function uniqueGates(
  gates: SiteQualityGateKey[]
): SiteQualityGateKey[] {
  return [...new Set(gates)];
}

export const OFFICIAL_SITE_ARCHITECTURES: readonly SiteArchitectureDefinition[] = [
  {
    id: 'official-content-site-v1',
    name: 'Site de conteúdo oficial v1',
    status: 'official',
    compatibleProductTypes: [
      'landing-page',
      'institutional',
      'blog',
    ],
    frontend: ['React 19', 'TypeScript', 'Vite', 'Tailwind CSS'],
    backend: ['Express apenas quando houver formulário ou integração'],
    data: ['Conteúdo versionado', 'Firestore apenas quando necessário'],
    delivery: ['GitHub', 'Vercel Preview', 'Vercel Production'],
    capabilities: [
      'SEO técnico',
      'conteúdo editorial',
      'formulários verificáveis',
      'acessibilidade WCAG 2.2 AA',
    ],
    requiredGates: uniqueGates(BASE_GATES),
    constraints: [
      'Não inventar depoimentos, números, clientes ou resultados.',
      'Toda ação de formulário precisa de confirmação verificável.',
    ],
  },
  {
    id: 'official-commerce-v1',
    name: 'Comércio e pagamentos oficial v1',
    status: 'official',
    compatibleProductTypes: ['store', 'payments'],
    frontend: ['React 19', 'TypeScript', 'Vite', 'Tailwind CSS'],
    backend: ['Express', 'webhooks idempotentes', 'validação Zod'],
    data: ['Firestore', 'ledger append-only', 'migrações versionadas'],
    delivery: ['GitHub', 'Vercel Preview', 'Vercel Production'],
    capabilities: [
      'catálogo',
      'checkout',
      'pagamento sandbox',
      'reconciliação',
    ],
    requiredGates: uniqueGates(COMMERCE_GATES),
    constraints: [
      'Sandbox obrigatório antes de produção.',
      'Webhook assinado e idempotente.',
      'Nunca armazenar dados completos de cartão.',
    ],
  },
  {
    id: 'official-authenticated-app-v1',
    name: 'Aplicação autenticada oficial v1',
    status: 'official',
    compatibleProductTypes: [
      'authenticated-portal',
      'saas',
      'admin-panel',
      'booking',
    ],
    frontend: ['React 19', 'TypeScript', 'Vite', 'Tailwind CSS'],
    backend: ['Express', 'Firebase Admin', 'validação Zod'],
    data: ['Firestore', 'regras por tenant', 'migrações versionadas'],
    delivery: ['GitHub', 'Vercel Preview', 'Vercel Production'],
    capabilities: [
      'autenticação',
      'RBAC',
      'multi-tenant',
      'painel administrativo',
      'jobs duráveis',
    ],
    requiredGates: uniqueGates(APP_GATES),
    constraints: [
      'Isolamento de usuário e empresa obrigatório.',
      'Operações mutáveis exigem idempotência.',
      'A autorização deve ser validada no servidor.',
    ],
  },
  {
    id: 'official-ai-application-v1',
    name: 'Aplicação de IA oficial v1',
    status: 'official',
    compatibleProductTypes: ['ai-application'],
    frontend: ['React 19', 'TypeScript', 'Vite', 'Tailwind CSS'],
    backend: ['Express', 'orquestração de IA', 'ferramentas com contrato'],
    data: ['Firestore', 'RAG versionado', 'memória privada criptografada'],
    delivery: ['GitHub', 'Vercel Preview', 'Vercel Production'],
    capabilities: [
      'roteamento de modelos',
      'RAG privado',
      'memória consentida',
      'execução durável',
      'tracing',
    ],
    requiredGates: uniqueGates([
      ...APP_GATES,
      'visual-regression',
    ]),
    constraints: [
      'Falhar fechado quando a evidência exigida estiver ausente.',
      'Custos, tokens e fontes precisam ser rastreáveis.',
      'Memória pessoal exige consentimento e criptografia.',
    ],
  },
] as const;

export class ArchitectureCompatibilityError extends Error {
  readonly code = 'incompatible_architecture';

  constructor(message: string) {
    super(message);
    this.name = 'ArchitectureCompatibilityError';
  }
}

export function listOfficialArchitectures(): SiteArchitectureDefinition[] {
  return OFFICIAL_SITE_ARCHITECTURES.map((architecture) => ({
    ...architecture,
    compatibleProductTypes: [...architecture.compatibleProductTypes],
    frontend: [...architecture.frontend],
    backend: [...architecture.backend],
    data: [...architecture.data],
    delivery: [...architecture.delivery],
    capabilities: [...architecture.capabilities],
    requiredGates: [...architecture.requiredGates],
    constraints: [...architecture.constraints],
  }));
}

export function selectOfficialArchitecture(
  productType: SiteProductType,
  requestedArchitectureId?: string
): SiteArchitectureDefinition {
  const compatible = OFFICIAL_SITE_ARCHITECTURES.filter(
    (architecture) =>
      architecture.compatibleProductTypes.includes(productType)
  );

  const selected = requestedArchitectureId
    ? compatible.find(
        (architecture) => architecture.id === requestedArchitectureId
      )
    : compatible[0];

  if (!selected) {
    throw new ArchitectureCompatibilityError(
      requestedArchitectureId
        ? `A arquitetura '${requestedArchitectureId}' não é oficial ou não é compatível com '${productType}'.`
        : `Não existe arquitetura oficial compatível com '${productType}'.`
    );
  }

  return {
    ...selected,
    compatibleProductTypes: [...selected.compatibleProductTypes],
    frontend: [...selected.frontend],
    backend: [...selected.backend],
    data: [...selected.data],
    delivery: [...selected.delivery],
    capabilities: [...selected.capabilities],
    requiredGates: [...selected.requiredGates],
    constraints: [...selected.constraints],
  };
}
