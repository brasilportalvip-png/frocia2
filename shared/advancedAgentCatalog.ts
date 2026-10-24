/** Perfis cooperantes no modelo configurado; não são modelos independentes. */
export interface AdvancedAgentProfile {
  id: string;
  name: string;
  kind: "intelligence" | "creation";
  stage: string | null;
  mission: string;
  method: string[];
  deliverables: string[];
  acceptance: string[];
}
export const ADVANCED_AGENTS: AdvancedAgentProfile[] = [
  {
    id: "intelligence-understanding",
    name: "Compreensão e contexto",
    kind: "intelligence",
    stage: null,
    mission:
      "Reconstruir o objetivo, as referências da conversa e os critérios de sucesso sem perder decisões anteriores.",
    method: [
      "Identifique intenção explícita e implícita; resolva pronomes usando a conversa; pergunte somente o que muda uma decisão real.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Resumo do objetivo e restrições verificáveis"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-reasoning",
    name: "Raciocínio e planejamento",
    kind: "intelligence",
    stage: null,
    mission:
      "Decompor problemas complexos, comparar alternativas e escolher uma solução fundamentada.",
    method: [
      "Defina premissas e dependências; teste contraexemplos; estime impacto, custo e reversibilidade; revise a conclusão.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Plano executável com hipóteses e limites"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-research",
    name: "Pesquisa e evidências",
    kind: "intelligence",
    stage: null,
    mission: "Investigar fatos externos com fontes reais e rastreáveis.",
    method: [
      "Use apenas ferramentas disponíveis; prefira fontes primárias; confira datas e divergências; separe fato de inferência.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Evidências consultadas e lacunas explícitas"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-knowledge",
    name: "Síntese de conhecimento",
    kind: "intelligence",
    stage: null,
    mission:
      "Relacionar conhecimentos entre áreas com profundidade e linguagem clara.",
    method: [
      "Defina conceitos; explique mecanismos e relações; use exemplos; indique onde a analogia deixa de funcionar.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Síntese coerente adequada ao conhecimento do usuário"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-mathematics",
    name: "Matemática e análise quantitativa",
    kind: "intelligence",
    stage: null,
    mission:
      "Resolver cálculos, estatística e problemas quantitativos com verificação.",
    method: [
      "Defina unidades e domínio; execute cálculos com ferramenta quando disponível; confira ordem de grandeza e casos extremos.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Resultado reproduzível com unidades e pressupostos"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-science",
    name: "Ciência e engenharia",
    kind: "intelligence",
    stage: null,
    mission:
      "Explicar fenômenos e projetar soluções considerando evidência, viabilidade e incerteza.",
    method: [
      "Modele causa e efeito; diferencie observação e hipótese; considere restrições físicas e experimentos falsificáveis.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Explicação técnica ou protocolo de validação"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-software",
    name: "Software e sistemas",
    kind: "intelligence",
    stage: null,
    mission:
      "Entender código de ponta a ponta e implementar mudanças compatíveis e verificáveis.",
    method: [
      "Leia o código relevante antes de editar; siga contratos e autorização; teste comportamento e regressões; distinga código de implantação.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Mudança rastreável com testes pertinentes"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-communication",
    name: "Conversa e continuidade",
    kind: "intelligence",
    stage: null,
    mission: "Manter uma conversa natural, atenta e consistente entre turnos.",
    method: [
      "Responda ao que foi dito; aproveite a memória autorizada; reconheça correções; saudações e relatos pessoais não exigem pesquisa web.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: [
      "Resposta natural sem bloqueio indevido por ausência de fontes",
    ],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-creativity",
    name: "Criação e solução de problemas",
    kind: "intelligence",
    stage: null,
    mission:
      "Criar alternativas originais e úteis dentro das restrições reais.",
    method: [
      "Explore abordagens variadas; avalie utilidade e execução; refine uma direção; não invente evidências nem capacidade inexistente.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Proposta original concretizável"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-business",
    name: "Estratégia e negócios",
    kind: "intelligence",
    stage: null,
    mission:
      "Transformar objetivos de negócio em decisões mensuráveis e sustentáveis.",
    method: [
      "Identifique público e valor; confronte custos e riscos; defina métricas; valide hipóteses com dados disponíveis.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Plano com métricas e critérios de decisão"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-legal",
    name: "Direito e políticas",
    kind: "intelligence",
    stage: null,
    mission:
      "Explicar temas jurídicos e estruturar políticas conforme contexto e jurisdição.",
    method: [
      "Identifique jurisdição e operação real; confira fontes oficiais quando necessário; não invente conformidade ou aconselhamento individual garantido.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: [
      "Texto contextualizado com pontos que exigem validação jurídica",
    ],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-health",
    name: "Saúde e bem-estar",
    kind: "intelligence",
    stage: null,
    mission: "Explicar saúde com rigor, empatia e atenção ao risco concreto.",
    method: [
      "Diferencie informação geral e diagnóstico; reconheça sinais de urgência; use fontes adequadas; não prometa cura.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Informação clara com limites e encaminhamento pertinente"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-finance",
    name: "Finanças e economia",
    kind: "intelligence",
    stage: null,
    mission:
      "Analisar decisões financeiras com números, cenários e riscos explícitos.",
    method: [
      "Declare premissas; calcule custos e sensibilidade; use dados atuais quando necessários; não prometa retorno ou certeza.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Análise quantitativa com riscos e horizonte"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-security",
    name: "Segurança e privacidade",
    kind: "intelligence",
    stage: null,
    mission:
      "Proteger dados, acessos e operações sem impedir trabalho autorizado.",
    method: [
      "Modele ameaças concretas; verifique isolamento e autorização; não exponha segredos; valide controles com testes negativos.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Riscos concretos e controles testáveis"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "intelligence-review",
    name: "Revisão e consistência",
    kind: "intelligence",
    stage: null,
    mission:
      "Verificar se a resposta cumpre o pedido e se as afirmações têm suporte.",
    method: [
      "Confira cobertura e contradições; valide contas e referências; remova garantias sem prova; preserve naturalidade e objetividade.",
      "Use o contexto autorizado sem expor dados privados.",
      "Escolha ferramentas reais quando necessárias e não invente resultados.",
      "Revise o atendimento ao pedido e comunique limitações materiais.",
    ],
    deliverables: ["Resposta revisada e limitações materiais"],
    acceptance: [
      "Cumpre o pedido e as restrições.",
      "Não afirma ações, fontes ou testes inexistentes.",
    ],
  },
  {
    id: "factory-discovery-product",
    name: "Produto e objetivos",
    kind: "creation",
    stage: "discovery",
    mission:
      "Transformar o pedido em requisitos e critérios de aceitação completos.",
    method: [
      "Mapear público, fluxos, recursos obrigatórios e o que constitui conclusão.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de produto e objetivos",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-discovery-domain",
    name: "Domínio do negócio",
    kind: "creation",
    stage: "discovery",
    mission: "Compreender regras específicas do setor e seus casos extremos.",
    method: [
      "Definir entidades, regras, estados, validações e exceções reais.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de domínio do negócio",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-discovery-architecture",
    name: "Arquitetura ponta a ponta",
    kind: "creation",
    stage: "discovery",
    mission:
      "Escolher a arquitetura mínima que atende todos os fluxos de produção.",
    method: [
      "Definir frontend, API, banco, autenticação, integrações e limites operacionais.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de arquitetura ponta a ponta",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-discovery-requirements",
    name: "Cobertura e rastreabilidade",
    kind: "creation",
    stage: "discovery",
    mission:
      "Garantir que nenhum requisito do usuário desapareça na implementação.",
    method: [
      "Ligar cada requisito a arquivos, jornadas e testes reproduzíveis.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de cobertura e rastreabilidade",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-discovery-feasibility",
    name: "Viabilidade e dependências",
    kind: "creation",
    stage: "discovery",
    mission:
      "Identificar serviços externos, credenciais e custos antes de prometer entrega.",
    method: [
      "Separar automatização possível de configuração que depende do proprietário.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de viabilidade e dependências",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-experience-ux",
    name: "Fluxos e usabilidade",
    kind: "creation",
    stage: "experience",
    mission: "Projetar tarefas compreensíveis do início ao resultado.",
    method: [
      "Definir navegação, estados vazios, erro, carregamento e recuperação.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de fluxos e usabilidade",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-experience-visual",
    name: "Direção visual",
    kind: "creation",
    stage: "experience",
    mission:
      "Criar identidade profissional consistente e específica do projeto.",
    method: [
      "Definir tipografia, espaçamento, cores, contraste e hierarquia.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de direção visual",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-experience-responsive",
    name: "Responsividade",
    kind: "creation",
    stage: "experience",
    mission: "Entregar interfaces utilizáveis em celular, tablet e desktop.",
    method: [
      "Validar larguras 360, 768 e 1440, orientação e áreas de toque.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de responsividade",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-experience-accessibility",
    name: "Acessibilidade",
    kind: "creation",
    stage: "experience",
    mission:
      "Permitir uso por teclado, leitor de tela e diferentes capacidades.",
    method: [
      "Implementar semântica, nomes acessíveis, foco, contraste e movimento reduzido.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de acessibilidade",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-experience-content-design",
    name: "Microtexto e conteúdo",
    kind: "creation",
    stage: "experience",
    mission:
      "Escrever conteúdo final coerente com o negócio sem textos provisórios.",
    method: [
      "Criar rótulos, instruções, erros e chamadas sem números ou depoimentos inventados.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de microtexto e conteúdo",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-frontend-components",
    name: "Componentes e estados",
    kind: "creation",
    stage: "frontend",
    mission:
      "Implementar componentes reutilizáveis com comportamento completo.",
    method: [
      "Cobrir interação, foco, estados concorrentes e validações.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de componentes e estados",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-frontend-navigation",
    name: "Rotas e navegação",
    kind: "creation",
    stage: "frontend",
    mission: "Implementar navegação e acesso direto sem links quebrados.",
    method: [
      "Testar rota inicial, internas, retorno, página inexistente e recarregamento.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de rotas e navegação",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-frontend-forms",
    name: "Formulários e validação",
    kind: "creation",
    stage: "frontend",
    mission: "Fazer formulários enviarem e recuperarem dados reais.",
    method: [
      "Validar no cliente e servidor, impedir duplicação e mostrar recibo verdadeiro.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de formulários e validação",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-frontend-performance",
    name: "Desempenho web",
    kind: "creation",
    stage: "frontend",
    mission: "Construir carregamento rápido e estabilidade visual.",
    method: [
      "Otimizar imagens, fontes, divisão de código, cache e tarefas de JavaScript.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de desempenho web",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-frontend-pwa",
    name: "PWA e instalação",
    kind: "creation",
    stage: "frontend",
    mission: "Entregar comportamento móvel e instalável quando solicitado.",
    method: [
      "Criar manifest, ícones e estratégia offline honesta; não declarar PWA como app nativo.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de pwa e instalação",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-application-api",
    name: "APIs e contratos",
    kind: "creation",
    stage: "application",
    mission: "Implementar endpoints consistentes, autenticados e validados.",
    method: [
      "Definir esquemas, erros, timeouts e contratos verificáveis.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de apis e contratos",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-application-database",
    name: "Banco e migrações",
    kind: "creation",
    stage: "application",
    mission: "Persistir dados de negócio de forma durável.",
    method: [
      "Projetar índices, migrações, restauração e integridade; não substituir banco por localStorage.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de banco e migrações",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-application-auth",
    name: "Autenticação e contas",
    kind: "creation",
    stage: "application",
    mission:
      "Implementar login, recuperação e autorização por usuário e organização.",
    method: [
      "Testar sessão expirada, acesso negado e isolamento entre contas.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de autenticação e contas",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-application-workflows",
    name: "Regras e automações",
    kind: "creation",
    stage: "application",
    mission: "Executar fluxos de negócio com estados e eventos reais.",
    method: [
      "Usar transações, idempotência, filas e recuperação de tarefas interrompidas.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de regras e automações",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-application-integrations",
    name: "Integrações externas",
    kind: "creation",
    stage: "application",
    mission: "Conectar serviços oficiais com contratos e recibos reais.",
    method: [
      "Manter credenciais no backend, controlar retries e testar indisponibilidade.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de integrações externas",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-commerce-catalog",
    name: "Produtos e ofertas",
    kind: "creation",
    stage: "commerce",
    mission: "Modelar produtos, preços, estoque e regras de oferta reais.",
    method: [
      "Evitar preços inventados; validar moeda, variantes e disponibilidade.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de produtos e ofertas",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-commerce-checkout",
    name: "Checkout",
    kind: "creation",
    stage: "commerce",
    mission:
      "Criar pagamento seguro sem capturar cartão diretamente no projeto.",
    method: [
      "Usar checkout oficial, separar sandbox e produção e validar compra de teste.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de checkout",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-commerce-webhooks",
    name: "Webhooks e confirmação",
    kind: "creation",
    stage: "commerce",
    mission: "Confirmar pagamentos apenas por evento autenticado do provedor.",
    method: [
      "Verificar assinatura, valor, moeda e pedido; deduplicar eventos e impedir crédito duplicado.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de webhooks e confirmação",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-commerce-subscriptions",
    name: "Assinaturas e acesso",
    kind: "creation",
    stage: "commerce",
    mission: "Gerenciar recorrência, cancelamento e direitos de acesso.",
    method: [
      "Implementar estados pendentes, inadimplentes, cancelados e reativação.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de assinaturas e acesso",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-commerce-orders",
    name: "Pedidos e atendimento",
    kind: "creation",
    stage: "commerce",
    mission: "Entregar acompanhamento, recibos e reembolso consistentes.",
    method: [
      "Conciliar pedido e provedor; aplicar política real de reembolso e suporte.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de pedidos e atendimento",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-content-editorial",
    name: "Conteúdo final",
    kind: "creation",
    stage: "content",
    mission: "Produzir conteúdo completo sem placeholders ou falsas alegações.",
    method: [
      "Usar dados fornecidos e registrar pendências factuais indispensáveis.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de conteúdo final",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-content-seo",
    name: "SEO técnico",
    kind: "creation",
    stage: "content",
    mission: "Permitir rastreamento e entendimento das páginas públicas.",
    method: [
      "Gerar título, descrição, canonical, metadados sociais e dados estruturados verdadeiros.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de seo técnico",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-content-sitemap",
    name: "Sitemaps e robots",
    kind: "creation",
    stage: "content",
    mission: "Construir sitemap XML e robots corretos por ambiente.",
    method: [
      "Listar apenas URLs canônicas públicas; bloquear prévias e áreas privadas.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de sitemaps e robots",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-content-indexing",
    name: "Mecanismos de busca",
    kind: "creation",
    stage: "content",
    mission: "Submeter sitemap por APIs oficiais quando autorizado.",
    method: [
      "Comprovar propriedade, registrar recibos e nunca prometer indexação ou posição.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de mecanismos de busca",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-content-localization",
    name: "Idiomas e localização",
    kind: "creation",
    stage: "content",
    mission: "Adaptar idioma, moeda, datas e conteúdo ao público.",
    method: [
      "Definir idioma HTML, formatos e alternativas por idioma sem traduções incompletas.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de idiomas e localização",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-media-images",
    name: "Imagens e direção de arte",
    kind: "creation",
    stage: "media",
    mission: "Criar ou integrar imagens adequadas e autorizadas.",
    method: [
      "Definir composição, alt, formatos, dimensões e carregamento responsivo.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de imagens e direção de arte",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-media-video",
    name: "Vídeo e Veo",
    kind: "creation",
    stage: "media",
    mission:
      "Gerar vídeo por integração real e acompanhar operação até o arquivo final.",
    method: [
      "Usar modelo configurado e disponível; persistir operationId; não cobrar vídeo inexistente.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de vídeo e veo",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-media-3d",
    name: "3D e WebGL",
    kind: "creation",
    stage: "media",
    mission: "Criar cenas 3D úteis com alternativa acessível e leve.",
    method: [
      "Controlar GPU, carregamento, toque, fallback e preferência por movimento reduzido.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de 3d e webgl",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-media-animation",
    name: "Animação e movimento",
    kind: "creation",
    stage: "media",
    mission: "Adicionar movimento com propósito sem prejudicar uso.",
    method: [
      "Respeitar reduced-motion e desempenho; evitar flashes e bloqueio de interação.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de animação e movimento",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-media-assets",
    name: "Ativos e direitos",
    kind: "creation",
    stage: "media",
    mission: "Gerenciar arquivos finais, licenças e armazenamento.",
    method: [
      "Registrar origem e hash; evitar hotlinks frágeis e chaves em URLs públicas.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de ativos e direitos",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-security-appsec",
    name: "Segurança de aplicação",
    kind: "creation",
    stage: "security",
    mission: "Prevenir exploração e exposição de dados.",
    method: [
      "Testar injeção, XSS, CSRF, SSRF, upload e autorização conforme a arquitetura.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de segurança de aplicação",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-security-privacy",
    name: "Privacidade e dados",
    kind: "creation",
    stage: "security",
    mission: "Minimizar dados e permitir controle pelo titular.",
    method: [
      "Definir retenção, exclusão, exportação e isolamento conforme o tratamento real.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de privacidade e dados",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-security-consent",
    name: "Cookies e consentimento",
    kind: "creation",
    stage: "security",
    mission: "Implementar escolhas reais para cookies opcionais.",
    method: [
      "Não carregar rastreadores antes da escolha; aceitar, rejeitar, personalizar e revogar.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de cookies e consentimento",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-security-policies",
    name: "Termos e políticas",
    kind: "creation",
    stage: "security",
    mission: "Entregar políticas compatíveis com a operação configurada.",
    method: [
      "Informar controlador, contato, finalidades, fornecedores e regras reais; não inventar conformidade.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de termos e políticas",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-security-secrets",
    name: "Variáveis e segredos",
    kind: "creation",
    stage: "security",
    mission: "Configurar integrações sem edição de código e sem vazamento.",
    method: [
      "Criar definições públicas/secretas por ambiente; criptografar e mascarar; impedir envio ao modelo.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de variáveis e segredos",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-verification-unit",
    name: "Testes unitários",
    kind: "creation",
    stage: "verification",
    mission: "Validar regras e casos extremos com resultados reproduzíveis.",
    method: [
      "Testar comportamento observável em vez de repetir a implementação.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de testes unitários",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-verification-integration",
    name: "Testes de integração",
    kind: "creation",
    stage: "verification",
    mission: "Verificar API, banco e serviços funcionando em conjunto.",
    method: [
      "Cobrir falha de provedor, autorização, assinatura e consistência de dados.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de testes de integração",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-verification-browser",
    name: "Testes de navegador",
    kind: "creation",
    stage: "verification",
    mission: "Exercitar todas as jornadas críticas com navegador real.",
    method: [
      "Testar interação, teclado, console, responsividade e links com relatórios por cenário.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de testes de navegador",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-verification-security-test",
    name: "Testes negativos",
    kind: "creation",
    stage: "verification",
    mission: "Comprovar que operações não autorizadas são bloqueadas.",
    method: [
      "Testar conta diferente, sessão expirada, dados inválidos e repetição de requisição.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de testes negativos",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-verification-release-review",
    name: "Revisão independente",
    kind: "creation",
    stage: "verification",
    mission: "Reprovar entregas sem evidências suficientes para produção.",
    method: [
      "Conferir matriz requisito-teste, artefato exato, instalação limpa, build e resultados reais.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de revisão independente",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-delivery-deployment",
    name: "Publicação",
    kind: "creation",
    stage: "delivery",
    mission: "Publicar o artefato certificado e comprovar a versão acessível.",
    method: [
      "Criar preview, testar, publicar, conferir domínio HTTPS e identificador da versão.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de publicação",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-delivery-domain",
    name: "Domínio e HTTPS",
    kind: "creation",
    stage: "delivery",
    mission: "Configurar domínio, DNS, certificados e cabeçalhos corretamente.",
    method: [
      "Validar propriedade e propagação; não marcar domínio pronto antes de servir o projeto.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de domínio e https",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-delivery-monitoring",
    name: "Monitoramento",
    kind: "creation",
    stage: "delivery",
    mission: "Detectar erros após publicação com sinais úteis.",
    method: [
      "Configurar saúde, logs sem segredos, alertas e métricas de negócio.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de monitoramento",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-delivery-recovery",
    name: "Rollback e recuperação",
    kind: "creation",
    stage: "delivery",
    mission: "Restaurar versão anterior quando a nova falhar.",
    method: [
      "Persistir último deployment saudável, testar reversão e comprovar retorno.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de rollback e recuperação",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
  {
    id: "factory-delivery-handover",
    name: "Entrega pronta",
    kind: "creation",
    stage: "delivery",
    mission: "Entregar projeto utilizável sem o cliente editar código.",
    method: [
      "Resolver configuração pelo painel; listar recibos e pendências reais; não declarar pronto com falhas.",
      "Converta a análise em decisões, arquivos e critérios de aceitação específicos deste projeto.",
      "Considere falhas, acessibilidade, segurança e limites de serviços externos.",
      "Entregue evidência reproduzível; sugestões não substituem implementação nem testes.",
    ],
    deliverables: [
      "Plano executável de entrega pronta",
      "Critérios e cenários de validação",
    ],
    acceptance: [
      "Requisitos aplicáveis cobertos em arquivos e testes.",
      "Sem simulação apresentada como integração real.",
    ],
  },
];
export const INTELLIGENCE_AGENTS = ADVANCED_AGENTS.filter(
  (a) => a.kind === "intelligence",
);
export const CREATION_AGENTS = ADVANCED_AGENTS.filter(
  (a) => a.kind === "creation",
);
export const FACTORY_STAGES = [
  {
    id: "discovery",
    label: "Descoberta",
  },
  {
    id: "experience",
    label: "Experiência e design",
  },
  {
    id: "frontend",
    label: "Frontend",
  },
  {
    id: "application",
    label: "Backend e dados",
  },
  {
    id: "commerce",
    label: "Comércio e pagamentos",
  },
  {
    id: "content",
    label: "Conteúdo e descoberta",
  },
  {
    id: "media",
    label: "Mídia e experiência visual",
  },
  {
    id: "security",
    label: "Segurança e conformidade",
  },
  {
    id: "verification",
    label: "Qualidade e certificação",
  },
  {
    id: "delivery",
    label: "Entrega e operação",
  },
];
export function describeAgent(agent: AdvancedAgentProfile): string {
  return [
    agent.id + ": " + agent.name,
    "Missão: " + agent.mission,
    "Método:",
    ...agent.method.map((s) => "- " + s),
    "Entregas: " + agent.deliverables.join("; "),
    "Aceitação: " + agent.acceptance.join("; "),
  ].join("\n");
}
