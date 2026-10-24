import { AGENT_EXECUTION_PROTOCOL } from "../../shared/agentExecutionProtocol.js";
import {
  CREATION_AGENTS,
  FACTORY_STAGES,
  describeAgent,
} from "../../shared/advancedAgentCatalog.js";

/** Direções aplicadas de fato na geração/refinamento, pelo modelo configurado. */
export function creationTeamPolicy(
  mode: "preview" | "project" = "preview",
): string {
  return [
    "EQUIPE PROFISSIONAL DE CRIAÇÃO: 50 perspectivas cooperantes em 10 disciplinas.",
    "Aplique todos os perfis abaixo aos requisitos pertinentes. Isto não comprova 50 chamadas independentes nem testes executados.",
    "Antes de escrever, construa internamente a matriz requisito -> implementação -> teste. Entregue implementação, não apenas recomendações.",
    mode === "preview"
      ? "O HTML deste endpoint é uma prévia isolada. Não finja backend, pagamento, autenticação, email enviado ou publicação."
      : "Entregue um projeto completo com frontend, backend, persistência, testes e integrações reais. A certificação e a publicação ocorrerão no executor, com recibos.",
    "Quando um requisito precisar de API, banco, provedor, domínio ou credencial que este artefato não possui, registre a dependência na entrega.",
    "Não peça ao cliente que edite código: descreva configurações necessárias como variáveis pelo painel, nunca como chaves a colar no HTML.",
    "Nunca inclua credenciais, tokens privados, dados pessoais de exemplo reais, depoimentos falsos ou números inventados.",
    "Inclua responsividade, navegação funcional, estados de erro, acessibilidade, conteúdo final e preferência por movimento reduzido.",
    "Cookies opcionais devem permanecer desativados antes do consentimento; forneça aceitar, rejeitar, personalizar e revogar.",
    "Termos, privacidade e cookies precisam refletir os dados, fornecedores, finalidade, contato e jurisdição realmente configurados.",
    "Sitemap XML, robots, canonical, schema e submissão a buscadores pertencem à entrega publicada; não invente confirmação ou ranking.",
    "3D, imagens e vídeo só devem ser apresentados como gerados quando existir o ativo final; respeite desempenho e alternativas acessíveis.",
    "Pagamento exige checkout oficial, sandbox separado, webhook autenticado/idempotente e verificação de valor/moeda/pedido.",
    "Uma resposta do modelo não certifica produção. Instalação, testes, navegador, integrações e publicação exigem recibos independentes.",
    AGENT_EXECUTION_PROTOCOL,
    ...FACTORY_STAGES.flatMap((stage) => [
      "DISCIPLINA: " + stage.label,
      ...CREATION_AGENTS.filter((a) => a.stage === stage.id).map(describeAgent),
    ]),
  ].join("\n\n");
}

export interface DeliveryRequirement {
  id: string;
  title: string;
  required: boolean;
  status: "pending";
}

/** Os gates começam pendentes. Nenhum texto produzido pelo modelo pode aprová-los. */
export function createDeliveryChecklist(prompt: string): DeliveryRequirement[] {
  const applicable =
    /pagamento|checkout|venda|loja|assinatura|pix|cart[aã]o/i.test(prompt);
  return [
    ["requirements", "Todos os requisitos implementados e rastreados", true],
    ["installation", "Instalação limpa e dependências verificadas", true],
    ["types-tests-build", "Tipos, testes de regras e build de produção", true],
    ["browser", "Jornadas críticas em navegador real", true],
    [
      "responsive-accessibility",
      "Celular, tablet, desktop, teclado e acessibilidade",
      true,
    ],
    ["api-data-auth", "APIs, persistência e autorização aplicáveis", true],
    ["security", "Isolamento, segredos e testes negativos", true],
    [
      "consent-policies",
      "Consentimento, termos e políticas contextualizados",
      true,
    ],
    ["seo", "Metadados, robots e sitemap XML canônicos", true],
    ["payments", "Pagamento sandbox e webhook autenticado", applicable],
    ["media", "Ativos finais e direitos de uso verificados", true],
    ["preview", "Prévia publicada e integrações verificadas", true],
    ["production", "Artefato publicado e versão acessível confirmada", true],
    ["operations", "Monitoramento e recuperação verificados", true],
  ].map(([id, title, required]) => ({
    id: String(id),
    title: String(title),
    required: Boolean(required),
    status: "pending",
  }));
}

export function previewDelivery(prompt: string) {
  return {
    status: "preview" as const,
    productionReady: false as const,
    appliedProfileIds: CREATION_AGENTS.map((a) => a.id),
    profileExecution: "cooperative-directions-in-generation" as const,
    checklist: createDeliveryChecklist(prompt),
    notice:
      "Prévia gerada. A aprovação para produção depende de implementação completa, testes e confirmação da publicação.",
  };
}
