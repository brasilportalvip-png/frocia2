import { ResearchQualityAssessment } from './researchQualityService.js';

export interface ResearchBenchmarkCase {
  id: string;
  category: string;
  prompt: string;
  minimumDomains: number;
  requiresCurrentSources: boolean;
  requiresPrimarySource: boolean;
  requiresSocialEvidence: boolean;
  sensitivity: 'standard' | 'high-stakes';
}

const topics = [
  {
    id: 'ai-regulation',
    label: 'regulação de inteligência artificial no Brasil, União Europeia e Estados Unidos',
    sensitivity: 'standard' as const,
  },
  {
    id: 'public-health',
    label: 'orientações públicas atuais sobre vacinação e surtos respiratórios',
    sensitivity: 'high-stakes' as const,
  },
  {
    id: 'personal-finance',
    label: 'taxas oficiais, inflação e custo de crédito para pessoas físicas no Brasil',
    sensitivity: 'high-stakes' as const,
  },
  {
    id: 'cybersecurity',
    label: 'vulnerabilidades críticas recentes em software amplamente utilizado',
    sensitivity: 'high-stakes' as const,
  },
  {
    id: 'climate',
    label: 'eventos climáticos extremos e alertas meteorológicos no Brasil',
    sensitivity: 'high-stakes' as const,
  },
  {
    id: 'science',
    label: 'novas pesquisas revisadas por pares sobre modelos generativos',
    sensitivity: 'standard' as const,
  },
  {
    id: 'consumer-tech',
    label: 'comparação atual de recursos, preço e suporte de assistentes de IA',
    sensitivity: 'standard' as const,
  },
  {
    id: 'public-policy',
    label: 'mudanças recentes em serviços digitais e políticas públicas brasileiras',
    sensitivity: 'high-stakes' as const,
  },
  {
    id: 'social-trends',
    label: 'discussões públicas sobre inteligência artificial nas redes sociais',
    sensitivity: 'standard' as const,
  },
  {
    id: 'claim-audit',
    label: 'uma alegação viral recente sobre tecnologia, governo ou ciência',
    sensitivity: 'standard' as const,
  },
];

const lenses = [
  {
    id: 'latest',
    instruction: 'Investigue o que mudou nas últimas 24 horas e diferencie data de publicação da data do evento.',
    current: true,
    primary: false,
    social: false,
  },
  {
    id: 'primary',
    instruction: 'Comece por documentos oficiais e fontes primárias, depois confirme com duas fontes independentes.',
    current: true,
    primary: true,
    social: false,
  },
  {
    id: 'divergence',
    instruction: 'Localize versões divergentes, compare as evidências e explique qual conclusão é mais sustentada.',
    current: true,
    primary: true,
    social: false,
  },
  {
    id: 'timeline',
    instruction: 'Monte uma cronologia verificável com datas, responsáveis e links diretos para cada marco.',
    current: true,
    primary: true,
    social: false,
  },
  {
    id: 'numbers',
    instruction: 'Confirme todos os números em tabelas ou relatórios originais e mostre quando as métricas não são comparáveis.',
    current: true,
    primary: true,
    social: false,
  },
  {
    id: 'regional',
    instruction: 'Compare a situação brasileira com pelo menos dois países e não generalize regras regionais.',
    current: true,
    primary: true,
    social: false,
  },
  {
    id: 'social-web',
    instruction: 'Compare publicações públicas de redes oficialmente conectadas com a cobertura da web e identifique rumores.',
    current: true,
    primary: false,
    social: true,
  },
  {
    id: 'direct-links',
    instruction: 'Abra cada página relevante e entregue URL pública direta, título, autor, data e o trecho que sustenta a afirmação.',
    current: true,
    primary: false,
    social: false,
  },
  {
    id: 'counterevidence',
    instruction: 'Procure ativamente contraevidências e declare o que permanece incerto ou inacessível.',
    current: true,
    primary: true,
    social: false,
  },
  {
    id: 'decision',
    instruction: 'Produza um relatório para decisão, separando fatos, inferências, riscos e limitações de acesso.',
    current: true,
    primary: true,
    social: false,
  },
];

export const RESEARCH_BENCHMARK_V1: ResearchBenchmarkCase[] = topics.flatMap(
  (topic) =>
    lenses.map((lens) => ({
      id: `rb-v1-${topic.id}-${lens.id}`,
      category: topic.id,
      prompt: `Faça uma pesquisa profunda sobre ${topic.label}. ${lens.instruction} Cite inline toda afirmação factual importante.`,
      minimumDomains: topic.sensitivity === 'high-stakes' ? 3 : 2,
      requiresCurrentSources: lens.current,
      requiresPrimarySource: lens.primary,
      requiresSocialEvidence: lens.social,
      sensitivity: topic.sensitivity,
    }))
);

export function benchmarkCasePassed(input: {
  testCase: ResearchBenchmarkCase;
  quality: ResearchQualityAssessment;
  hasPrimarySource: boolean;
  hasCurrentSource: boolean;
  hasSocialEvidence: boolean;
}): boolean {
  return (
    input.quality.status === 'strong' &&
    input.quality.independentDomainCount >= input.testCase.minimumDomains &&
    input.quality.citedClaimCoverage >= 0.5 &&
    input.quality.openedPageCount > 0 &&
    (!input.testCase.requiresPrimarySource || input.hasPrimarySource) &&
    (!input.testCase.requiresCurrentSources || input.hasCurrentSource) &&
    (!input.testCase.requiresSocialEvidence || input.hasSocialEvidence)
  );
}
