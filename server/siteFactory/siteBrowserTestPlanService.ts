import crypto from 'node:crypto';
import { SiteQualityGateKey } from './siteArchitectureCatalog.js';
import { SiteSpecificationVersion } from './siteSpecificationService.js';

export type SiteBrowserViewport = 'mobile' | 'tablet' | 'desktop';

export type SiteBrowserScenarioKey =
  | 'direct-routes'
  | 'navigation'
  | 'refresh'
  | 'responsive-layout'
  | 'keyboard-navigation'
  | 'screen-reader'
  | 'reduced-motion'
  | 'console-errors'
  | 'network-failures'
  | 'http-status'
  | 'visual-errors'
  | 'persistence'
  | 'broken-links'
  | 'public-url-smoke'
  | 'registration'
  | 'login'
  | 'logout'
  | 'password-recovery'
  | 'expired-session'
  | 'company-switch'
  | 'forms'
  | 'uploads'
  | 'search'
  | 'admin-panel'
  | 'subscription'
  | 'payment-sandbox'
  | 'cancellation'
  | 'email-or-webhook';

export interface SiteBrowserScenario {
  id: string;
  key: SiteBrowserScenarioKey;
  title: string;
  gate: SiteQualityGateKey;
  required: true;
  viewports: SiteBrowserViewport[];
  preconditions: string[];
  steps: string[];
  assertions: string[];
  externalDependency: string | null;
}

export interface SiteBrowserTestPlan {
  format: 'froc-site-browser-plan-v1';
  specificationId: string;
  specificationVersion: number;
  specificationHash: string;
  architectureId: string;
  scenarios: SiteBrowserScenario[];
  requiredScenarioCount: number;
  externalDependencyCount: number;
  digest: string;
}

type ScenarioInput = Omit<SiteBrowserScenario, 'id' | 'required'>;

const ALL_VIEWPORTS: SiteBrowserViewport[] = [
  'mobile',
  'tablet',
  'desktop',
];

function normalizedFeatureText(specification: SiteSpecificationVersion): string {
  return specification.specification.features
    .join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

function scenarioId(
  specification: SiteSpecificationVersion,
  key: SiteBrowserScenarioKey
): string {
  return crypto
    .createHash('sha256')
    .update(
      `${specification.specificationId}:${specification.version}:${specification.contentHash}:${key}`
    )
    .digest('hex')
    .slice(0, 24);
}

export function buildSiteBrowserTestPlan(
  specification: SiteSpecificationVersion
): SiteBrowserTestPlan {
  const input = specification.specification;
  const features = normalizedFeatureText(specification);
  const scenarios = new Map<SiteBrowserScenarioKey, SiteBrowserScenario>();
  const add = (scenario: ScenarioInput) => {
    scenarios.set(scenario.key, {
      ...scenario,
      id: scenarioId(specification, scenario.key),
      required: true,
      viewports: [...scenario.viewports],
      preconditions: [...scenario.preconditions],
      steps: [...scenario.steps],
      assertions: [...scenario.assertions],
    });
  };

  add({
    key: 'direct-routes',
    title: 'Rotas diretas declaradas na especificação',
    gate: 'e2e-browser',
    viewports: ['desktop'],
    preconditions: ['Preview publicado.'],
    steps: input.pages.map((page) => `Abrir diretamente ${page.path}.`),
    assertions: [
      'Cada rota responde com o status esperado.',
      'Rotas privadas não expõem conteúdo sem autenticação.',
    ],
    externalDependency: null,
  });
  add({
    key: 'navigation',
    title: 'Navegação principal e histórico',
    gate: 'e2e-browser',
    viewports: ALL_VIEWPORTS,
    preconditions: ['Aplicação iniciada.'],
    steps: ['Navegar pelos links principais.', 'Usar voltar e avançar.'],
    assertions: ['URL, título e conteúdo permanecem coerentes.'],
    externalDependency: null,
  });
  add({
    key: 'refresh',
    title: 'Atualização em todas as rotas',
    gate: 'e2e-browser',
    viewports: ['mobile', 'desktop'],
    preconditions: ['Rotas públicas e privadas enumeradas.'],
    steps: ['Atualizar cada rota suportada.'],
    assertions: ['Não ocorre tela branca, 404 indevido ou perda de sessão válida.'],
    externalDependency: null,
  });
  add({
    key: 'responsive-layout',
    title: 'Responsividade sem corte ou rolagem horizontal',
    gate: 'responsive-layout',
    viewports: ALL_VIEWPORTS,
    preconditions: ['Conteúdo representativo disponível.'],
    steps: ['Executar o fluxo principal nos três viewports.'],
    assertions: [
      'Não existe rolagem horizontal indevida.',
      'Ações e conteúdo permanecem visíveis e utilizáveis.',
    ],
    externalDependency: null,
  });
  add({
    key: 'keyboard-navigation',
    title: 'Fluxo completo somente com teclado',
    gate: 'accessibility',
    viewports: ['desktop'],
    preconditions: ['WCAG 2.2 AA exigido.'],
    steps: ['Percorrer ações com Tab, Shift+Tab, Enter, Espaço e Escape.'],
    assertions: ['Foco visível, ordem lógica e ausência de armadilha de teclado.'],
    externalDependency: null,
  });
  add({
    key: 'screen-reader',
    title: 'Semântica para leitor de tela',
    gate: 'accessibility',
    viewports: ['desktop'],
    preconditions: ['Página renderizada.'],
    steps: ['Executar auditoria WCAG e inspecionar nomes e relações acessíveis.'],
    assertions: ['Zero bloqueador crítico e controles com nomes acessíveis.'],
    externalDependency: null,
  });
  add({
    key: 'reduced-motion',
    title: 'Preferência de movimento reduzido',
    gate: 'accessibility',
    viewports: ['mobile', 'desktop'],
    preconditions: ['prefers-reduced-motion ativado.'],
    steps: ['Abrir páginas e executar transições.'],
    assertions: ['Animações não essenciais são removidas ou reduzidas.'],
    externalDependency: null,
  });
  add({
    key: 'console-errors',
    title: 'Console sem erro crítico',
    gate: 'runtime-logs',
    viewports: ['mobile', 'desktop'],
    preconditions: ['Captura de console e pageerror ativa.'],
    steps: ['Executar todos os fluxos críticos.'],
    assertions: ['Nenhum erro não tratado ou segredo aparece no console.'],
    externalDependency: null,
  });
  add({
    key: 'network-failures',
    title: 'Falhas e lentidão de rede',
    gate: 'integration-tests',
    viewports: ['mobile', 'desktop'],
    preconditions: ['Interceptação de rede habilitada.'],
    steps: ['Simular timeout, offline, 429 e 5xx.'],
    assertions: ['Loading termina e o erro orienta retry seguro sem duplicação.'],
    externalDependency: null,
  });
  add({
    key: 'http-status',
    title: 'Contratos e status HTTP',
    gate: 'api-contract',
    viewports: ['desktop'],
    preconditions: ['Rotas de API enumeradas.'],
    steps: ['Executar casos válidos, inválidos, sem autenticação e inexistentes.'],
    assertions: ['Status e corpo seguem o contrato sem stack trace.'],
    externalDependency: null,
  });
  add({
    key: 'visual-errors',
    title: 'Estados visuais de loading, vazio, erro e sucesso',
    gate: 'visual-regression',
    viewports: ALL_VIEWPORTS,
    preconditions: ['Fixtures para cada estado disponíveis.'],
    steps: ['Capturar e comparar os quatro estados.'],
    assertions: ['Estados são distinguíveis, acessíveis e não sobrepostos.'],
    externalDependency: null,
  });
  add({
    key: 'persistence',
    title: 'Persistência após atualização e nova sessão',
    gate: 'integration-tests',
    viewports: ['desktop'],
    preconditions: ['Fixture mutável isolada.'],
    steps: ['Criar dado, atualizar, recarregar e consultar novamente.'],
    assertions: ['Dado confirmado persiste uma única vez.'],
    externalDependency: null,
  });
  add({
    key: 'broken-links',
    title: 'Links internos e externos válidos',
    gate: 'broken-links',
    viewports: ['desktop'],
    preconditions: ['Site completo no Preview.'],
    steps: ['Extrair links e consultar destinos respeitando limites.'],
    assertions: ['Nenhum link obrigatório retorna 4xx/5xx ou protocolo inseguro.'],
    externalDependency: 'A disponibilidade de destinos externos pode variar.',
  });
  add({
    key: 'public-url-smoke',
    title: 'Smoke test da URL pública',
    gate: 'public-url-smoke',
    viewports: ['mobile', 'desktop'],
    preconditions: ['Deploy de produção concluído.'],
    steps: ['Abrir domínio canônico e rotas críticas.'],
    assertions: ['HTTPS, cabeçalhos, conteúdo e APIs essenciais estão verdes.'],
    externalDependency: 'Domínio e deploy de produção.',
  });

  if (input.authentication.required) {
    for (const scenario of [
      ['registration', 'Cadastro', 'Criar conta válida e rejeitar duplicada.'],
      ['login', 'Login', 'Entrar com credencial válida e rejeitar inválida.'],
      ['logout', 'Logout', 'Encerrar sessão e bloquear rota privada.'],
      ['password-recovery', 'Recuperação de senha', 'Solicitar recuperação sem enumerar contas.'],
      ['expired-session', 'Sessão expirada', 'Expirar token e exigir nova autenticação.'],
    ] as const) {
      add({
        key: scenario[0],
        title: scenario[1],
        gate: 'e2e-browser',
        viewports: ['mobile', 'desktop'],
        preconditions: ['Conta de teste isolada e provedor de autenticação homologado.'],
        steps: [scenario[2]],
        assertions: ['Autenticação e autorização do servidor permanecem coerentes.'],
        externalDependency: 'Credenciais e provedor de autenticação no ambiente de teste.',
      });
    }
  }

  if (input.authentication.multiTenant) {
    add({
      key: 'company-switch',
      title: 'Troca de empresa sem vazamento entre tenants',
      gate: 'security',
      viewports: ['desktop'],
      preconditions: ['Conta pertencente a dois tenants e dados adversariais.'],
      steps: ['Alternar tenant e consultar rotas e recursos diretamente.'],
      assertions: ['Nenhum dado, cache ou autorização do tenant anterior permanece.'],
      externalDependency: 'Fixtures multiempresa isoladas.',
    });
  }

  if (input.administration.required) {
    add({
      key: 'admin-panel',
      title: 'Painel administrativo e RBAC',
      gate: 'security',
      viewports: ['desktop'],
      preconditions: ['Usuários admin e não-admin de teste.'],
      steps: ['Executar ações administrativas com ambos os perfis.'],
      assertions: ['Somente o papel autorizado executa e cada ação gera auditoria.'],
      externalDependency: 'Credenciais de papéis de teste.',
    });
  }

  if (/form|contato|cadastro|lead/.test(features)) {
    add({
      key: 'forms',
      title: 'Formulários válidos, inválidos e duplicados',
      gate: 'e2e-browser',
      viewports: ALL_VIEWPORTS,
      preconditions: ['Dados de teste sem informações pessoais reais.'],
      steps: ['Enviar vazio, inválido, válido e repetido.'],
      assertions: ['Validação clara e uma única confirmação verificável.'],
      externalDependency: null,
    });
  }
  if (/upload|arquivo|documento|importa/.test(features)) {
    add({
      key: 'uploads',
      title: 'Uploads válidos e adversariais',
      gate: 'security',
      viewports: ['desktop'],
      preconditions: ['Fixtures permitidas, grandes, malformadas e maliciosas.'],
      steps: ['Enviar cada fixture e interromper uma transferência.'],
      assertions: ['Tipo, tamanho, autorização e retomada seguem o contrato.'],
      externalDependency: 'Storage e scanner configurados no ambiente de teste.',
    });
  }
  if (/busca|pesquisa|search|catalog/.test(features)) {
    add({
      key: 'search',
      title: 'Busca, vazio, paginação e isolamento',
      gate: 'e2e-browser',
      viewports: ['mobile', 'desktop'],
      preconditions: ['Índice de teste com resultados e ausência de resultados.'],
      steps: ['Buscar termos válidos, vazios, especiais e de outro tenant.'],
      assertions: ['Resultados corretos, paginados e isolados.'],
      externalDependency: null,
    });
  }

  if (input.payments.required) {
    for (const scenario of [
      ['subscription', 'Assinatura e estado do plano'],
      ['payment-sandbox', 'Pagamento aprovado, pendente e recusado no sandbox'],
      ['cancellation', 'Cancelamento idempotente e reflexo financeiro'],
    ] as const) {
      add({
        key: scenario[0],
        title: scenario[1],
        gate: 'integration-health',
        viewports: ['mobile', 'desktop'],
        preconditions: ['Conta e credenciais oficiais de sandbox.'],
        steps: ['Executar o fluxo e repetir callbacks mutáveis.'],
        assertions: ['Estado deriva do provedor e não há cobrança duplicada.'],
        externalDependency: `Sandbox ${input.payments.provider}.`,
      });
    }
  }

  if (
    input.integrations.some((integration) =>
      /email|e-mail|webhook/i.test(`${integration.name} ${integration.purpose}`)
    )
  ) {
    add({
      key: 'email-or-webhook',
      title: 'Entrega e autenticação de e-mail ou webhook',
      gate: 'integration-health',
      viewports: ['desktop'],
      preconditions: ['Inbox ou receptor de sandbox controlado.'],
      steps: ['Disparar, observar recibo e repetir a entrega.'],
      assertions: ['Assinatura, destino, conteúdo e idempotência são confirmados.'],
      externalDependency: 'Provedor externo e credenciais de sandbox.',
    });
  }

  const ordered = [...scenarios.values()].sort((a, b) =>
    a.key.localeCompare(b.key)
  );
  const planWithoutDigest = {
    format: 'froc-site-browser-plan-v1' as const,
    specificationId: specification.specificationId,
    specificationVersion: specification.version,
    specificationHash: specification.contentHash,
    architectureId: specification.architectureId,
    scenarios: ordered,
    requiredScenarioCount: ordered.length,
    externalDependencyCount: ordered.filter(
      (scenario) => scenario.externalDependency
    ).length,
  };

  return {
    ...planWithoutDigest,
    digest: crypto
      .createHash('sha256')
      .update(stableStringify(planWithoutDigest))
      .digest('hex'),
  };
}
