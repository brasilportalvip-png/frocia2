export interface CreditPackageConfig {
  id: string;
  name: string;
  credits: number;
  bonusCredits: number;
  totalCredits: number;
  priceBrl: number;
  active: boolean;
  description: string;
  badge?: string;
  popular?: boolean;
  features: string[];
}

export const CREDIT_PACKAGES: CreditPackageConfig[] = [
  {
    id: "initial",
    name: "Pacote Inicial",
    credits: 100,
    bonusCredits: 10,
    totalCredits: 110,
    priceBrl: 49,
    active: true,
    description: "Ideal para experimentar e criar seus primeiros sites com IA.",
    badge: "Economia",
    features: [
      "110 Créditos Totais (Com Bônus)",
      "Acesso ao Gemini 3.6 Flash",
      "Geração de Sites e Código",
      "Exportação ilimitada em HTML/ZIP",
      "Validade de 90 dias"
    ]
  },
  {
    id: "creator",
    name: "Pacote Criador",
    credits: 300,
    bonusCredits: 50,
    totalCredits: 350,
    priceBrl: 119,
    active: true,
    description: "Para criadores e freelancers gerarem múltiplos projetos e imagens.",
    popular: true,
    badge: "Mais Vendido",
    features: [
      "350 Créditos Totais (Com Bônus)",
      "Acesso ao Gemini 3.6 Flash & 3.1 Pro",
      "Geração de Imagens Imagen 3",
      "Correção e Refatoração de Código",
      "Deploy direto no GitHub & Vercel",
      "Validade de 180 dias"
    ]
  },
  {
    id: "professional",
    name: "Pacote Profissional",
    credits: 1000,
    bonusCredits: 200,
    totalCredits: 1200,
    priceBrl: 299,
    active: true,
    description: "Para profissionais e estúdios com alto volume de desenvolvimento.",
    badge: "Alta Performance",
    features: [
      "1200 Créditos Totais (Com Bônus)",
      "Todos os Modelos de IA Liberados",
      "Geração de Vídeos Veo",
      "Atendimento de Suporte Prioritário",
      "Failover de Alta Disponibilidade",
      "Créditos Sem Validade"
    ]
  },
  {
    id: "agency",
    name: "Pacote Agência",
    credits: 3000,
    bonusCredits: 800,
    totalCredits: 3800,
    priceBrl: 799,
    active: true,
    description: "Pacote empresarial de alta capacidade para demandas ilimitadas.",
    badge: "Empresarial",
    features: [
      "3800 Créditos Totais (Com Bônus)",
      "Uso Ilimitado Multiagente",
      "Acesso via API Externa",
      "Gerente de Conta Dedicado",
      "SLA 99.9% Garantido",
      "Créditos Sem Validade"
    ]
  }
];

export function getCreditPackageById(id: string): CreditPackageConfig | undefined {
  return CREDIT_PACKAGES.find((pkg) => pkg.id === id && pkg.active);
}
