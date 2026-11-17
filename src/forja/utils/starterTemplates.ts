export interface StarterBlueprint {
  id: string;
  title: string;
  category: string;
  summary: string;
  prompt: string;
}

export const STARTER_BLUEPRINTS: StarterBlueprint[] = [
  {
    id: 'saas-fintech',
    title: 'Plataforma SaaS Financeira B2B',
    category: 'SaaS · Landing Page',
    summary: 'Calculadora interativa de ROI, tabela de planos Mensal/Anual, FAQ e modal de agendamento.',
    prompt:
      'Crie um site institucional completo e pronto para produção para a "Atlas Pay", uma plataforma SaaS B2B de automação financeira e conciliação bancária para empresas brasileiras. Inclua: barra de navegação limpa, hero com foto ultrarrealista de equipe financeira em escritório moderno e gráfico SVG de fluxo de caixa sobreposto, calculadora interativa de economia mensal baseada no volume de notas fiscais, comparativo de planos com alternância Mensal/Anual real, seção de como funciona em 3 passos, acordeão de perguntas frequentes funcional e modal de solicitação de demonstração com validação completa e confirmação salva no localStorage.',
  },
  {
    id: 'ecommerce-atelier',
    title: 'Loja Virtual Minimalista com Carrinho',
    category: 'E-commerce · Checkout',
    summary: 'Catálogo com busca e filtros, seleção de variação, cupom BEMVINDO10 e checkout completo.',
    prompt:
      'Crie uma loja virtual completa e pronta para produção para a "Kairo Atelier", marca de mochilas urbanas, carteiras em couro vegano e acessórios minimalistas de viagem. Inclua: catálogo com 8 produtos, cada um com foto de produto ultrarrealista em estúdio, busca em tempo real, filtros por categoria e ordenação por preço, seleção de cor por produto, gaveta de carrinho lateral funcional (adicionar, alterar quantidade, remover, cupom BEMVINDO10 que aplica 10% de desconto e persistência no localStorage) e fluxo completo de checkout com formulário validado e número de pedido gerado.',
  },
  {
    id: 'ops-dashboard',
    title: 'Painel Analítico de Vendas e Pedidos',
    category: 'Dashboard · Operações',
    summary: 'KPIs dinâmicos, gráfico de receita SVG, tabela ordenável, novo pedido e exportação CSV.',
    prompt:
      'Crie um dashboard administrativo completo e pronto para produção chamado "PulseOps", para gestão de vendas e pedidos de uma operação digital. Inclua: barra lateral de navegação funcional alternando entre Visão Geral, Pedidos e Clientes, 4 cards de KPIs calculados dinamicamente a partir dos pedidos reais, gráfico SVG interativo de receita semanal com tooltip ao passar o mouse, tabela de pedidos com busca, filtro por status (Pago, Pendente, Enviado), ordenação por valor/data, modal para criar novo pedido persistindo no localStorage e botão funcional de exportar relatório CSV.',
  },
  {
    id: 'clinic-booking',
    title: 'Clínica de Estética e Agendamento Online',
    category: 'Saúde · Agendamento',
    summary: 'Catálogo de tratamentos, corpo clínico e fluxo completo de agendamento passo a passo.',
    prompt:
      'Crie um site completo e pronto para produção para a "Clínica Vitta", especializada em odontologia estética e harmonização facial em São Paulo. Inclua: design editorial claro e sofisticado, catálogo filtrável de tratamentos com duração e valores, fotos ultrarrealistas do consultório e dos tratamentos, e um sistema completo de agendamento online em 3 etapas reais (escolha do procedimento, seleção de especialista + data/horário disponível sem conflitos, e dados do paciente) salvando os agendamentos no localStorage e permitindo visualizar ou cancelar agendamentos marcados.',
  },
];
