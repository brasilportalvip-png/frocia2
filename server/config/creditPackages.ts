export interface CreditPackageConfig {
  id: string;
  name: string;
  credits: number;
  bonusCredits: number;
  totalCredits: number;
  priceBrl: number;
  priceCents: number;
  active: boolean;
  description: string;
  badge?: string;
  popular?: boolean;
  features: string[];
}

export const CREDIT_PACKAGES: CreditPackageConfig[] = [
  {
    id: "free",
    name: "Gratuito",
    credits: 10,
    bonusCredits: 0,
    totalCredits: 10,
    priceBrl: 0,
    priceCents: 0,
    active: true,
    description: "Aproximadamente 2 conversas inteligentes para testar a Froc.IA.",
    features: [
      "10 Créditos de boas-vindas",
      "Aproximadamente 2 conversas inteligentes",
      "Não inclui imagens, vídeos ou criação de sites"
    ]
  },
  {
    id: "essential",
    name: "Essencial",
    credits: 50,
    bonusCredits: 0,
    totalCredits: 50,
    priceBrl: 49.90,
    priceCents: 4990,
    active: true,
    description: "Conversas, imagens e pequenas tarefas de IA.",
    badge: "Iniciante",
    features: [
      "50 Créditos",
      "Aproximadamente 10 conversas inteligentes ou 2 imagens",
      "Assistente de conversação e análise",
      "Pequenas edições e consultas"
    ]
  },
  {
    id: "creator",
    name: "Criador",
    credits: 350,
    bonusCredits: 0,
    totalCredits: 350,
    priceBrl: 249.90,
    priceCents: 24990,
    active: true,
    popular: true,
    badge: "Mais Vendido",
    description: "Permite aproximadamente 1 site completo. Indicado para criadores e pequenos negócios.",
    features: [
      "350 Créditos",
      "Aproximadamente 1 site completo ou dezenas de conversas",
      "Geração de código e projetos",
      "Criação de imagens e análises profundas"
    ]
  },
  {
    id: "professional",
    name: "Profissional",
    credits: 900,
    bonusCredits: 0,
    totalCredits: 900,
    priceBrl: 549.90,
    priceCents: 54990,
    active: true,
    badge: "Alta Performance",
    description: "Permite aproximadamente 3 sites completos. Indicado para profissionais e empresas.",
    features: [
      "900 Créditos",
      "Aproximadamente 3 sites completos",
      "Refatoração de código e análises avançadas",
      "Prioridade no processamento de requisições"
    ]
  },
  {
    id: "agency",
    name: "Agência",
    credits: 2200,
    bonusCredits: 0,
    totalCredits: 2200,
    priceBrl: 1099.90,
    priceCents: 109990,
    active: true,
    badge: "Empresarial",
    description: "Permite aproximadamente 7 a 8 sites completos. Indicado para equipes e agências.",
    features: [
      "2.200 Créditos",
      "Aproximadamente 7 a 8 sites completos",
      "Suporte para demandas recorrentes de equipes",
      "Histórico completo e relatórios de consumo"
    ]
  }
];

export function getCreditPackageById(id: string): CreditPackageConfig | undefined {
  return CREDIT_PACKAGES.find((pkg) => pkg.id === id && pkg.active);
}
