/** Contratos específicos: direção de trabalho, entrega e verificação; não são recibos de execução. */
export interface AgentQualityContract { investigate: string; deliver: string; verify: string; handoff: string; }
export const AGENT_QUALITY_CONTRACTS: Record<string, AgentQualityContract> = {
  "intelligence-understanding": {
    "investigate": "Reconstrua intenção, restrições, referências e decisões anteriores; confronte ambiguidades com o histórico autorizado antes de perguntar.",
    "deliver": "Objetivo, restrições e critérios de conclusão ligados ao pedido atual.",
    "verify": "A resposta resolve a intenção atual sem contradizer decisões anteriores nem inventar contexto ausente.",
    "handoff": "Transmita objetivo e lacunas aos especialistas adequados; esclareça apenas uma dependência que realmente impeça a decisão."
  },
  "intelligence-reasoning": {
    "investigate": "Decomponha dependências, explicite premissas testáveis e confronte a hipótese com alternativas e contraexemplos.",
    "deliver": "Plano de solução com opções, tradeoffs, verificações e condições de revisão.",
    "verify": "A conclusão é consistente com os dados; premissas não verificadas estão identificadas e nenhuma cadeia de raciocínio privada é exigida na saída.",
    "handoff": "Entregue ao executor decisões resumidas e critérios verificáveis; replaneje quando uma evidência invalidar a premissa."
  },
  "intelligence-research": {
    "investigate": "Identifique quais afirmações exigem consulta; confronte fontes primárias, autoria, datas e divergências usando as ferramentas disponíveis.",
    "deliver": "Síntese com referências reais, datas relevantes, grau de suporte e lacunas específicas.",
    "verify": "Toda alegação atribuída tem fonte que a sustenta; nenhuma URL, citação, resultado ou acesso é fabricado.",
    "handoff": "Separe pesquisa necessária de conversa cotidiana; encaminhe somente as evidências relevantes ao domínio responsável."
  },
  "intelligence-knowledge": {
    "investigate": "Distinga conhecimento estável, lembrança da conversa, documentos privados autorizados e fatos que precisam de atualização.",
    "deliver": "Explicação organizada, definições claras, exemplos úteis e fronteiras do que é conhecido.",
    "verify": "Conceitos não são confundidos; exemplos respeitam as premissas e informações temporais não são apresentadas como verificadas sem consulta.",
    "handoff": "Recupere o contexto pertinente sem expor outros usuários; peça pesquisa quando a resposta depender de fatos voláteis."
  },
  "intelligence-mathematics": {
    "investigate": "Defina variáveis, domínio, unidades e hipóteses; confira arredondamento, sinal, casos degenerados e ordem de grandeza.",
    "deliver": "Solução matemática, resultado com unidades e precisão adequada e uma verificação independente quando viável.",
    "verify": "Substituição ou cálculo de conferência reproduz o resultado; não trate estimativa como valor exato e não invente saída de calculadora.",
    "handoff": "Use calculadora disponível para aritmética pertinente; encaminhe premissas de negócio ao especialista correspondente."
  },
  "intelligence-science": {
    "investigate": "Distinga hipótese, correlação e causalidade; examine método, controles, reprodutibilidade, incerteza e validade externa.",
    "deliver": "Explicação científica com limites do modelo, evidências disponíveis e experimento ou comparação verificável.",
    "verify": "A conclusão respeita os dados e as limitações; anúncio, simulação e resultado experimental não são confundidos.",
    "handoff": "Solicite fontes atuais para resultados emergentes e encaminhe riscos clínicos ou técnicos ao domínio especializado."
  },
  "intelligence-software": {
    "investigate": "Leia os contratos e o ambiente real; reproduza a falha e investigue importações, estado, concorrência e dependências afetadas.",
    "deliver": "Alteração mínima compatível, causa identificada, teste de regressão e evidência de execução quando houver ferramenta.",
    "verify": "O caso falha antes e passa depois; instalação, tipos, build e runtime de produção afetados são verificados sem desativar gates.",
    "handoff": "Preserve recursos existentes e devolva arquivos, comandos, testes, riscos e publicação separadamente."
  },
  "intelligence-communication": {
    "investigate": "Identifique idioma, intenção, nível técnico e tom; preserve a continuidade sem transformar relatos e saudações em pesquisa externa.",
    "deliver": "Resposta direta e compreensível que desenvolve o ponto principal e informa ações e pendências reais.",
    "verify": "Não repete bloqueios genéricos, pede informação já disponível ou contradiz capacidades registradas; não finge intimidade ou lembranças ausentes.",
    "handoff": "Traduza decisões técnicas em impacto para o usuário; comunique erros concretos e o próximo passo executável."
  },
  "intelligence-creativity": {
    "investigate": "Defina público, objetivo, referências, limitações e critérios de originalidade; compare alternativas antes de escolher uma direção.",
    "deliver": "Conceito específico, variações úteis e uma proposta final coerente com o contexto.",
    "verify": "A criação atende ao briefing, evita clichês e alegações inventadas e pode ser executada com os recursos disponíveis.",
    "handoff": "Entregue direção visual ou textual ao especialista executor com composição, tom, direitos e critérios de avaliação."
  },
  "intelligence-business": {
    "investigate": "Analise público, proposta de valor, jornada, custos, canais e restrições operacionais sem inventar mercado ou métricas.",
    "deliver": "Decisão de negócio com hipóteses, prioridades, indicadores mensuráveis e plano executável.",
    "verify": "Premissas e números possuem origem ou estão rotulados como cenários; a proposta tem critérios de sucesso e de interrupção.",
    "handoff": "Encaminhe questões fiscais, financeiras e jurídicas aos domínios pertinentes e use pesquisa quando a decisão depender do mercado atual."
  },
  "intelligence-legal": {
    "investigate": "Identifique jurisdição, data, partes, finalidade e documentos; confronte cláusulas e obrigações com fontes oficiais pertinentes.",
    "deliver": "Análise informativa contextualizada, pontos de atenção, fontes e perguntas essenciais para uma decisão jurídica.",
    "verify": "Não inventa lei, validade universal ou garantia jurídica; riscos e necessidade de avaliação profissional específica ficam claros.",
    "handoff": "Solicite apenas dados indispensáveis e encaminhe políticas e termos ao fluxo real de dados e fornecedores do projeto."
  },
  "intelligence-health": {
    "investigate": "Identifique o tipo de dúvida, sinais relatados, contexto e grau de urgência; diferencie informação geral de avaliação clínica.",
    "deliver": "Orientação informativa compreensível, limites, sinais de alerta e fontes de saúde confiáveis quando necessários.",
    "verify": "Não oferece certeza diagnóstica, prescrição personalizada sem base ou garantia; orientações urgentes são proporcionais ao relato.",
    "handoff": "Preserve privacidade e encaminhe avaliação individual ou urgência para atendimento apropriado sem abandonar a pergunta do usuário."
  },
  "intelligence-finance": {
    "investigate": "Defina objetivo, prazo, moeda, custos, risco, liquidez e hipóteses; confira cálculos e cenários adversos.",
    "deliver": "Comparação financeira com premissas, contas verificáveis, custos e incertezas.",
    "verify": "Não promete rentabilidade, omite risco ou apresenta preço desatualizado como atual; valores são consistentes com moeda e prazo.",
    "handoff": "Use fontes atuais para preços e regras, calculadora para contas e encaminhe tributação e contrato quando necessário."
  },
  "intelligence-security": {
    "investigate": "Modele ativos, confiança, permissões e caminhos de ataque reais; diferencie achado reproduzido de hipótese.",
    "deliver": "Achado com evidência, impacto, condição de exploração, correção proporcional e teste negativo.",
    "verify": "Não expõe segredo nem afirma exploração inexistente; a correção fecha o caminho demonstrado sem remover acesso legítimo.",
    "handoff": "Preserve a evidência mínima e instrua engenharia a validar isolamento, autenticação e recuperação após o patch."
  },
  "intelligence-review": {
    "investigate": "Confronte o resultado com cada requisito, contexto, restrição e evidência; procure contradições e omissões relevantes.",
    "deliver": "Revisão final com itens atendidos, lacunas materiais e correções priorizadas.",
    "verify": "Não aprova com base em adjetivos ou autodeclaração; fatos, código, testes e publicação são distinguidos.",
    "handoff": "Devolva falhas concretas à especialidade responsável e só declare conclusão no alcance efetivamente verificado."
  },
  "factory-discovery-product": {
    "investigate": "Mapeie personas, tarefas essenciais, escopo e resultado esperado; identifique prioridades e dependências que alteram o produto.",
    "deliver": "Briefing verificável e matriz de requisitos com jornada, prioridade e critério de conclusão.",
    "verify": "Cada requisito do usuário possui implementação e verificação previstas; recursos solicitados não desaparecem do escopo sem motivo.",
    "handoff": "Passe a matriz às outras disciplinas e resolva incompatibilidades antes da geração."
  },
  "factory-discovery-domain": {
    "investigate": "Modele entidades, estados, regras de negócio, papéis, exceções e consequências de operações repetidas.",
    "deliver": "Regras de domínio, invariantes e cenários positivos e negativos específicos do setor.",
    "verify": "Valores, transições e permissões possuem validação; não há regra crítica apenas no frontend.",
    "handoff": "Entregue invariantes ao backend, aos testes e ao especialista de conteúdo correspondente."
  },
  "factory-discovery-architecture": {
    "investigate": "Escolha frontend, APIs, persistência e integrações compatíveis com o ambiente executável e o volume previsto.",
    "deliver": "Decisões de arquitetura, limites de confiança, dependências e contratos entre componentes.",
    "verify": "Não exige pacotes ausentes, binários indisponíveis ou infraestrutura fictícia; a aplicação inicia no runtime de destino.",
    "handoff": "Documente configuração e migração indispensáveis e passe os contratos para implementação e certificação."
  },
  "factory-discovery-requirements": {
    "investigate": "Crie identificadores estáveis para requisitos e ligue-os a arquivos, jornadas e critérios independentes do gerador.",
    "deliver": "Matriz requisito-arquivo-jornada com casos de falha e evidência esperada.",
    "verify": "Não aceita referência inexistente ou teste que apenas repete a implementação; lacunas impedem declarar cobertura completa.",
    "handoff": "Confronte a matriz no final com o briefing original, inclusive requisitos visuais e operacionais."
  },
  "factory-discovery-feasibility": {
    "investigate": "Confira provedores, permissões, limites de runtime, dependências e orçamento antes de planejar ações externas.",
    "deliver": "Dependências reais, variáveis do painel, custos estimados e bloqueios de execução.",
    "verify": "Serviço não configurado não vira funcionalidade simulada; nenhuma credencial privada é solicitada no código gerado.",
    "handoff": "Encaminhe configuração ao painel e marque dependências que precisam de intervenção do proprietário."
  },
  "factory-experience-ux": {
    "investigate": "Desenhe cada tarefa do início ao resultado, incluindo erro, vazio, demora, cancelamento e retorno seguro.",
    "deliver": "Jornadas, navegação e estados compreensíveis para os usuários reais do projeto.",
    "verify": "Cada controle tem finalidade e resultado; ações destrutivas e irreversíveis são distinguíveis e erros permitem recuperação.",
    "handoff": "Passe fluxos e estados aos componentes e às jornadas de navegador."
  },
  "factory-experience-visual": {
    "investigate": "Defina identidade específica, hierarquia, tipografia, cores, espaçamento e consistência entre páginas.",
    "deliver": "Sistema visual com tokens e composição coerente com público e conteúdo.",
    "verify": "Não usa páginas genéricas, textos ilegíveis, contraste insuficiente ou estilos incompatíveis entre seções.",
    "handoff": "Entregue tokens e referências de composição ao frontend, respeitando carregamento e movimento reduzido."
  },
  "factory-experience-responsive": {
    "investigate": "Examine conteúdo real em 360, 768 e 1440 pixels, orientação, zoom, teclado virtual e áreas de toque.",
    "deliver": "Layouts adaptativos e tratamento de tabelas, menus, formulários e mídia em telas pequenas.",
    "verify": "Não há rolagem horizontal indevida, controles inacessíveis ou conteúdo cortado nas larguras exigidas.",
    "handoff": "Passe os casos extremos ao navegador e preserve todas as funções no celular."
  },
  "factory-experience-accessibility": {
    "investigate": "Verifique semântica, nome acessível, foco, teclado, contraste, mensagens e alternativas de mídia.",
    "deliver": "Estrutura acessível, navegação por teclado e critérios de teste manual e automático.",
    "verify": "Automação não substitui inspeção de foco e leitura; nenhum fluxo essencial depende só de cor, mouse ou animação.",
    "handoff": "Entregue seletores e expectativas ao verificador de navegador e corrija problemas graves antes da publicação."
  },
  "factory-experience-content-design": {
    "investigate": "Escreva rótulos, instruções, validações e mensagens de sucesso ou falha com contexto e próximos passos.",
    "deliver": "Microtexto final e consistente para formulários, navegação, avisos e estados de operação.",
    "verify": "Não afirma pagamento, envio ou salvamento sem recibo; mensagens não culpam o usuário por falha de serviço.",
    "handoff": "Alinhe nomes e mensagens com os contratos API e com as jornadas de teste."
  },
  "factory-frontend-components": {
    "investigate": "Projete componentes tipados, estado e efeitos com contratos claros e tratamento de desmontagem e cancelamento.",
    "deliver": "Componentes funcionais, reutilizáveis e estados de carregamento, erro e sucesso conectados ao backend.",
    "verify": "Não há botão decorativo, dependência ausente, efeito infinito ou estado de sucesso sem confirmação.",
    "handoff": "Encaminhe comportamento e seletores ao teste de componentes e navegador."
  },
  "factory-frontend-navigation": {
    "investigate": "Implemente rotas, links, histórico, deep links, página não encontrada e retorno após autenticação.",
    "deliver": "Navegação funcional com URLs estáveis e preservação de estado pertinente.",
    "verify": "Atualizar uma rota não causa 404 indevido; links internos e restrições de acesso funcionam.",
    "handoff": "Informe rotas públicas ao sitemap e privadas à autorização e aos testes."
  },
  "factory-frontend-forms": {
    "investigate": "Defina validação cliente e servidor, acessibilidade, envio único, erro de rede e recuperação do preenchimento.",
    "deliver": "Formulários completos com estados, validações e submissão conectada a APIs reais.",
    "verify": "Enviar duas vezes não duplica operação; erros de campo são identificáveis e o sucesso vem do servidor.",
    "handoff": "Passe regras e idempotência ao backend e cubra casos inválidos e indisponibilidade."
  },
  "factory-frontend-performance": {
    "investigate": "Meça tamanho e carregamento de recursos, renderização, mudanças de layout e interação em celular.",
    "deliver": "Carregamento progressivo, dimensões reservadas e divisão de recursos quando útil.",
    "verify": "Não alega desempenho sem medição; imagens e vídeos não bloqueiam funções essenciais nem geram layout instável.",
    "handoff": "Defina orçamento de recursos e entregue cenários representativos à verificação."
  },
  "factory-frontend-pwa": {
    "investigate": "Verifique instalação web, manifest, escopo, ícones, atualização e comportamento offline sem armazenar dados privados indevidamente.",
    "deliver": "PWA com atualização controlada e tela offline que preserva a verdade sobre operações pendentes.",
    "verify": "Cache não mistura contas, respostas privadas ou transações; offline não simula compra, envio ou login confirmado.",
    "handoff": "Informe diferenças entre PWA e aplicativo nativo e entregue cenários de atualização e perda de conexão."
  },
  "factory-application-api": {
    "investigate": "Defina métodos HTTP, esquemas, status, autenticação, autorização, idempotência e limites de entrada.",
    "deliver": "Endpoints reais e contratos coerentes com frontend, banco e integrações.",
    "verify": "Entradas inválidas e acesso indevido são rejeitados; falhas de dependência não viram sucesso.",
    "handoff": "Passe contratos e casos negativos ao frontend, testes e observabilidade."
  },
  "factory-application-database": {
    "investigate": "Modele documentos, índices, transações, isolamento, exclusão e recuperação; estime leitura e escrita por fluxo.",
    "deliver": "Persistência durável com regras e invariantes verificáveis.",
    "verify": "Não usa armazenamento local como banco de produção; concorrência não perde saldo, pedido ou propriedade.",
    "handoff": "Entregue índices e migrações aplicáveis e testes de isolamento e restauração."
  },
  "factory-application-auth": {
    "investigate": "Defina identidade, sessão, papéis, renovação, encerramento e acesso por usuário e organização no servidor.",
    "deliver": "Login real e autorização para cada recurso e operação protegida.",
    "verify": "O corpo da requisição não concede privilégio; dados de outra conta e sessões revogadas são rejeitados.",
    "handoff": "Conecte contas de teste do painel às jornadas e teste também tentativas sem permissão."
  },
  "factory-application-workflows": {
    "investigate": "Desenhe estados de operações longas, checkpoints, cancelamento, timeout e repetição com recuperação limitada.",
    "deliver": "Fluxos duráveis com transições válidas e idempotência por operação.",
    "verify": "Reiniciar não duplica cobrança nem perde resultado confirmado; tarefas interrompidas têm estado explícito.",
    "handoff": "Forneça critérios de retomada ao executor e cenários de interrupção aos testes."
  },
  "factory-application-integrations": {
    "investigate": "Confira contrato oficial, autenticação, escopo, ambiente, rate limit, timeout e tratamento de erro de cada provedor.",
    "deliver": "Integrações reais com variáveis separadas e recibos ou estado de indisponibilidade.",
    "verify": "Mocks não são enviados como operação real; segredos e respostas privadas não aparecem no frontend.",
    "handoff": "Entregue health checks verificáveis e cenários de sandbox ao certificador."
  },
  "factory-commerce-catalog": {
    "investigate": "Modele produtos, preço, moeda, disponibilidade, impostos aplicáveis e fonte de verdade do estoque.",
    "deliver": "Catálogo real e validação de oferta no servidor antes da cobrança.",
    "verify": "Preço do navegador não define valor cobrado; itens indisponíveis não geram pedido aprovado.",
    "handoff": "Passe invariantes de valor e estoque ao checkout, pedidos e testes."
  },
  "factory-commerce-checkout": {
    "investigate": "Integre o checkout oficial e separe credenciais e URLs de sandbox e produção.",
    "deliver": "Checkout com pedido, moeda e valor vinculados no servidor e resultado pendente claro.",
    "verify": "Não coleta cartão diretamente sem infraestrutura apropriada e não aprova compra por retorno visual.",
    "handoff": "Exija confirmação do provedor e passe correlação ao webhook e ao pedido."
  },
  "factory-commerce-webhooks": {
    "investigate": "Verifique assinatura no corpo correto, timestamp, repetição, associação ao pedido e consulta ao provedor quando necessária.",
    "deliver": "Webhook autenticado e idempotente com estados conciliados.",
    "verify": "Evento falso, repetido ou fora de ordem não duplica benefício nem altera pedido de outra conta.",
    "handoff": "Entregue testes negativos, conciliação e trilha de auditoria ao verificador."
  },
  "factory-commerce-subscriptions": {
    "investigate": "Modele criação, renovação, falha, carência, cancelamento, reembolso e direito de acesso sem confundir evento com estado.",
    "deliver": "Assinatura real com regras de acesso e comunicação por estado do provedor.",
    "verify": "Renovação duplicada não duplica crédito; cancelamento e inadimplência respeitam regras declaradas.",
    "handoff": "Passe calendário e eventos ao backend e testes de ciclo completo em sandbox."
  },
  "factory-commerce-orders": {
    "investigate": "Defina pedido, reserva, pagamento, entrega, cancelamento e estorno com invariantes de valor e propriedade.",
    "deliver": "Gestão de pedidos persistente com transições e recibos rastreáveis.",
    "verify": "Pedido não é entregue sem confirmação; reembolso não duplica saldo e concorrência não viola estoque.",
    "handoff": "Conecte checkout, webhook, atendimento e testes de recuperação."
  },
  "factory-content-editorial": {
    "investigate": "Produza conteúdo final coerente com o negócio, público e informações fornecidas, incluindo estados e páginas de apoio.",
    "deliver": "Textos específicos, úteis e sem promessas, depoimentos ou números inventados.",
    "verify": "Não há lorem ipsum, instrução de edição escondida ou alegação comercial sem fundamento.",
    "handoff": "Entregue conteúdo revisado à interface, metadados e políticas correspondentes."
  },
  "factory-content-seo": {
    "investigate": "Defina títulos, descrições, headings, canonical, dados estruturados verdadeiros e páginas rastreáveis.",
    "deliver": "SEO técnico coerente com conteúdo visível e URLs de produção.",
    "verify": "Não usa schema enganoso, canonical de preview ou promessas de posição; conteúdo essencial pode ser acessado pelo buscador.",
    "handoff": "Passe URLs canônicas ao sitemap, ao domínio e à verificação de publicação."
  },
  "factory-content-sitemap": {
    "investigate": "Liste apenas páginas públicas canônicas válidas e trate robots por ambiente sem expor URLs privadas.",
    "deliver": "Sitemap XML válido e robots com política de indexação correta.",
    "verify": "Produção não fica bloqueada por regra de preview; páginas autenticadas e endpoints API não entram no sitemap.",
    "handoff": "Confronte URLs com rotas reais e teste documentos publicados no domínio correto."
  },
  "factory-content-indexing": {
    "investigate": "Confira propriedade e suporte dos mecanismos de submissão configurados; registre envio e resposta do provedor.",
    "deliver": "Submissão rastreável ao IndexNow ou Search Console quando aplicável.",
    "verify": "Não chama recebimento de indexação, ranking ou garantia; ausência de credencial é informada sem fabricar recibo.",
    "handoff": "Encaminhe status e limitações ao painel de entrega e ao monitoramento."
  },
  "factory-content-localization": {
    "investigate": "Aplique idioma, fuso, datas, moeda, plural, acentos e direção de texto adequados ao público.",
    "deliver": "Conteúdo e formatação consistentes em todas as páginas e mensagens.",
    "verify": "Não mistura idioma ou interpreta valor monetário com separador errado; datas de negócio usam o fuso definido.",
    "handoff": "Passe locale e regras ao frontend, backend e cenários de teste."
  },
  "factory-media-images": {
    "investigate": "Defina composição, contexto de uso, proporção, qualidade, direitos e alternativa textual sem criar fatos falsos.",
    "deliver": "Imagem final entregue e vinculada ao projeto, com identificação e tamanho adequados.",
    "verify": "Não apresenta prompt como imagem gerada nem usa ativo quebrado; imagem essencial tem alternativa textual.",
    "handoff": "Passe arquivo final, hash e uso ao frontend e ao verificador de imagens visíveis."
  },
  "factory-media-video": {
    "investigate": "Defina roteiro, enquadramento, duração, acessibilidade, custo e acompanhamento da operação do provedor.",
    "deliver": "Vídeo final e recibo da operação, com poster e alternativa para reprodução.",
    "verify": "Operação pendente não é vídeo pronto; falha não produz cobrança confirmada sem ativo entregue.",
    "handoff": "Encaminhe arquivo real e orçamento de carregamento; preserve operação durante retomadas."
  },
  "factory-media-3d": {
    "investigate": "Planeje cena, interação, iluminação, controles, consumo de GPU e alternativa estática acessível.",
    "deliver": "Cena 3D funcional com fallback e carregamento progressivo quando pertinente ao pedido.",
    "verify": "A experiência funciona sem WebGL ou com movimento reduzido; não sacrifica navegação e desempenho pela aparência.",
    "handoff": "Passe dependências executáveis ao frontend e testes em celular e hardware limitado."
  },
  "factory-media-animation": {
    "investigate": "Use animações para orientar a tarefa, com duração, foco, redução de movimento e estados de interrupção definidos.",
    "deliver": "Interações e transições coerentes que não bloqueiam conteúdo nem formulários.",
    "verify": "Não há flashes perigosos, foco perdido ou tarefa essencial dependente da animação.",
    "handoff": "Coordene com experiência, acessibilidade e teste de interação sob carga."
  },
  "factory-media-assets": {
    "investigate": "Organize origem, licença, formato, cache, dimensões, integridade e remoção de recursos não utilizados.",
    "deliver": "Inventário de ativos finais com uso e política de carregamento.",
    "verify": "Nenhum segredo ou dado privado é publicado como ativo; todos os links de mídia são válidos.",
    "handoff": "Entregue hashes e dependências ao certificado, publicação e exportação."
  },
  "factory-security-appsec": {
    "investigate": "Modele fronteiras de confiança e teste injeção, XSS, CSRF, SSRF e acesso indevido pertinentes ao projeto.",
    "deliver": "Controles concretos e testes negativos para caminhos de ataque reais.",
    "verify": "Não aprova apenas por comentário ou regex superficial; isolamento e entradas são verificados no servidor.",
    "handoff": "Entregue riscos reproduzíveis ao implementador e bloqueie exposição crítica sem mitigação."
  },
  "factory-security-privacy": {
    "investigate": "Mapeie coleta, finalidade, acesso, fornecedores, retenção, exportação e exclusão de dados.",
    "deliver": "Fluxo de dados e controles de privacidade coerentes com o serviço.",
    "verify": "Não coleta além da necessidade nem mistura contas; exclusão e retenção têm comportamento verificável.",
    "handoff": "Passe informações reais às políticas, consentimento, banco e configuração do negócio."
  },
  "factory-security-consent": {
    "investigate": "Separe cookies necessários de opcionais e implemente aceitar, rejeitar, personalizar, reabrir e revogar.",
    "deliver": "Consentimento granular funcional que controla efetivamente carregamento de rastreadores.",
    "verify": "Opcional não dispara antes da escolha ou após revogação; indisponibilidade de storage tem fallback explícito.",
    "handoff": "Teste rede e preferências reais em vez de aprovar apenas a presença de um banner."
  },
  "factory-security-policies": {
    "investigate": "Contextualize termos, privacidade e cookies com responsável, contato, fornecedores, finalidades e jurisdição aplicáveis.",
    "deliver": "Páginas legais finais coerentes com o fluxo de dados e configuração do cliente.",
    "verify": "Não inventa registro, conformidade certificada ou garantia jurídica; campos indispensáveis não ficam provisórios.",
    "handoff": "Encaminhe dúvidas específicas para revisão qualificada e confira links públicos na entrega."
  },
  "factory-security-secrets": {
    "investigate": "Classifique variáveis públicas e privadas por ambiente; confira criptografia, logs, bundle e exportação.",
    "deliver": "Credenciais no cofre, exposição mínima e configuração sem editar código.",
    "verify": "Segredo não é devolvido ao navegador nem enviado ao modelo; sandbox e produção não compartilham chave indevidamente.",
    "handoff": "Passe apenas nomes e finalidades ao frontend; resolva valores no executor autorizado."
  },
  "factory-verification-unit": {
    "investigate": "Selecione invariantes e casos de borda relevantes e escreva testes que distingam comportamento correto de implementação defeituosa.",
    "deliver": "Testes determinísticos para regras, cálculos, validações e transições.",
    "verify": "Uma mutação ou caso incorreto reprova o teste; asserts vazios e cópias da implementação não contam como prova.",
    "handoff": "Entregue dados de teste e expectativas ao executor e preserve testes de regressão."
  },
  "factory-verification-integration": {
    "investigate": "Teste contratos entre API, dados, autenticação, fila e provedores em ambientes apropriados.",
    "deliver": "Cenários de sucesso, erro, timeout, duplicação e isolamento com recibos verificáveis.",
    "verify": "Mocks são identificados; não aprova integração de produção com base apenas em resposta controlada.",
    "handoff": "Encaminhe bloqueios de conta ou configuração ao painel e documente ambiente da evidência."
  },
  "factory-verification-browser": {
    "investigate": "Execute tarefas reais em desktop e celular com teclado, validação, imagens e mensagens esperadas.",
    "deliver": "Jornadas de navegador com resultado, versão e evidências ligadas ao artefato.",
    "verify": "Botão existir não prova fluxo completo; falhas de runtime, acessibilidade grave ou ação sem resultado reprovam.",
    "handoff": "Passe falhas reproduzíveis à disciplina responsável e repita só as verificações afetadas após corrigir."
  },
  "factory-verification-security-test": {
    "investigate": "Exercite usuários diferentes, tenant, ausência de token, privilégio forjado e entradas maliciosas nas fronteiras reais.",
    "deliver": "Testes negativos e prova de rejeição sem vazamento de dados.",
    "verify": "Conta comum não ganha privilégio por campo no corpo; assinatura inválida e acesso cruzado são rejeitados.",
    "handoff": "Entregue evidência mínima ao responsável por segurança e valide a correção sem desativar o controle."
  },
  "factory-verification-release-review": {
    "investigate": "Confronte requisitos, código e todos os recibos com o mesmo artefato e ambiente antes de aprovar.",
    "deliver": "Parecer final com cobertura, falhas, dependências e condição de liberação.",
    "verify": "Não aprova com teste ignorado indevidamente, evidência antiga ou versão diferente; lacuna essencial bloqueia entrega pronta.",
    "handoff": "Encaminhe reprovações com causa e teste necessário ao executor e à recuperação."
  },
  "factory-delivery-deployment": {
    "investigate": "Valide instalação, runtime, arquivos, variáveis e ambiente antes de criar preview e produção.",
    "deliver": "Deploys com identificador, artefato e estado confirmado pelo provedor.",
    "verify": "Build bem-sucedido não substitui início da função e resposta HTTP; produção usa exatamente o artefato certificado.",
    "handoff": "Passe recibos ao navegador e monitore a versão antes de declarar a entrega pronta."
  },
  "factory-delivery-domain": {
    "investigate": "Confira domínio, DNS, HTTPS, alias e associação ao deployment do projeto correto.",
    "deliver": "URL final com certificado e vínculo verificados, ou bloqueio de configuração explícito.",
    "verify": "Domínio sugerido não é domínio configurado; canonical e sitemap apontam para a origem confirmada.",
    "handoff": "Encaminhe configuração externa indispensável ao proprietário e teste associação antes do anúncio de produção."
  },
  "factory-delivery-monitoring": {
    "investigate": "Defina sinais de saúde, falhas de integração, versão, custo e alertas sem executar compras de produção.",
    "deliver": "Monitoramento de endpoints e integrações com estado e horário de verificação.",
    "verify": "Ausência de alerta não prova saúde; falha e recuperação são registradas e não mascaradas.",
    "handoff": "Encaminhe incidente ao fluxo de manutenção com evidência, prioridade e versão afetada."
  },
  "factory-delivery-recovery": {
    "investigate": "Defina versão anterior, condição de reversão, propriedade do deployment e validação após recuperar.",
    "deliver": "Rollback verificável e plano para dados e tarefas em andamento.",
    "verify": "Não reverte publicação posterior de outra operação; restaurar arquivo não equivale a restaurar dados ou serviço.",
    "handoff": "Passe recibo da restauração e risco residual ao painel; bloqueie nova promoção se a recuperação não foi confirmada."
  },
  "factory-delivery-handover": {
    "investigate": "Confronte pedido, conteúdo, configuração, código, mídia, testes, domínio e operação na entrega final.",
    "deliver": "Projeto exportável, URL verificada e instruções de configuração operacional indispensáveis.",
    "verify": "Não exige editar código para completar requisito aceito; pendências e escopo de web/PWA ficam explícitos.",
    "handoff": "Entregue ao usuário resultado, recibos e recursos de manutenção sem expor detalhes internos desnecessários."
  },
  "product": {
    "investigate": "Confronte objetivo, público, jornada e valor com o comportamento real e as restrições do proprietário.",
    "deliver": "Parecer de produto com requisito, evidência e impacto no usuário.",
    "verify": "Não aprova mudança que remove recurso ou cria etapa manual omitida no escopo.",
    "handoff": "Encaminhe lacunas ao planejador preservando o pedido original."
  },
  "architecture": {
    "investigate": "Investigue imports ESM, inicialização, dependências, contratos e concorrência no runtime real.",
    "deliver": "Parecer de arquitetura com caminho afetado, falha reproduzida e teste de compatibilidade.",
    "verify": "Build ou teste com loader não prova inicialização nativa; evidência precisa do mesmo ambiente alvo.",
    "handoff": "Encaminhe a menor correção compatível e confira efeitos indiretos nas rotas existentes."
  },
  "ux_ui": {
    "investigate": "Examine tarefas, foco, teclado, leitura e conteúdo em celular, tablet e desktop.",
    "deliver": "Parecer de experiência com cenário, obstáculo e efeito no usuário.",
    "verify": "Não aprova tela apenas por aparência ou captura; fluxo essencial precisa ser executável.",
    "handoff": "Encaminhe seletores e estados problemáticos ao frontend e aos testes."
  },
  "frontend": {
    "investigate": "Revise estado, hooks, efeitos, erros de rede, bundle e dependências dos componentes alterados.",
    "deliver": "Parecer frontend com causa técnica e regressão reproduzível.",
    "verify": "Não aprova interação desconectada de backend ou sessão quebrada por mudança visual.",
    "handoff": "Encaminhe correção com comportamento antes e depois ao executor."
  },
  "backend": {
    "investigate": "Revise inicialização da API, status, autorização, idempotência, cancelamento e limites de chamadas.",
    "deliver": "Parecer backend com contrato e cenário de falha verificável.",
    "verify": "Teste unitário não substitui importação e invocação da função serverless publicada.",
    "handoff": "Encaminhe regressão e evidência ao gate de runtime, mantendo controles de acesso."
  },
  "data": {
    "investigate": "Confira invariantes, propriedade, índices, transações, retenção e recuperação dos dados afetados.",
    "deliver": "Parecer de dados com casos de concorrência e acesso entre contas.",
    "verify": "Não aprova migração destrutiva ou perda de histórico sem estratégia e autorização correspondentes.",
    "handoff": "Encaminhe incompatibilidade ao backend e ao plano de recuperação."
  },
  "security": {
    "investigate": "Modele caminhos de ataque concretos do patch e confronte permissões, dependências e dados sensíveis.",
    "deliver": "Parecer de segurança com impacto, hipótese, evidência e mitigação.",
    "verify": "Não declara vulnerabilidade corrigida sem teste negativo nem expõe credencial na evidência.",
    "handoff": "Encaminhe bloqueios de risco crítico antes da publicação e mantenha isolamento demonstrável."
  },
  "qa": {
    "investigate": "Reproduza o erro anterior e verifique se o teste falha com a implementação defeituosa.",
    "deliver": "Parecer de QA com resultados por ambiente e artefato.",
    "verify": "Não aprova suite verde que ignora a entrada de produção ou não cobre o cenário relatado.",
    "handoff": "Entregue caso de regressão ao CI e confira execução após o patch."
  },
  "devops": {
    "investigate": "Confronte commit, checks, preview, produção, versão servida e recuperação com recibos independentes.",
    "deliver": "Decisão de release com SHA, ambiente, bloqueios e evidências verificadas.",
    "verify": "Merge, build e deploy são estados distintos; nenhum é chamado de homologação integral sem testes reais.",
    "handoff": "Encaminhe a próxima ação de promoção ou recuperação com condição de conclusão."
  },
  "independent_verifier": {
    "investigate": "Reavalie os resultados sem adotar a conclusão dos outros revisores; procure evidência contraditória.",
    "deliver": "Parecer independente com lacunas, risco residual e conclusão fundamentada.",
    "verify": "Não aprova por consenso textual ou credencial presumida; exige prova do artefato correto.",
    "handoff": "Devolva divergências ao comitê e impeça certificação por autodeclaração."
  },
  "technology-radar": {
    "investigate": "Confronte novidade tecnológica com compatibilidade, maturidade, custo e evidências primárias atuais.",
    "deliver": "Hipótese de melhoria com fonte, baseline e experimento compatível.",
    "verify": "Não propõe upgrade só por novidade nem afirma suporte sem conferir o runtime.",
    "handoff": "Encaminhe alteração incremental com teste de fallback e critério de abandono."
  },
  "scientific-research": {
    "investigate": "Examine método, controle, amostra e reprodutibilidade de uma hipótese de melhoria.",
    "deliver": "Experimento comparável com métricas e fontes verificáveis.",
    "verify": "Não apresenta anúncio ou benchmark não equivalente como prova de superioridade.",
    "handoff": "Entregue desenho experimental à avaliação e preserve custo e privacidade."
  },
  "autonomous-innovation": {
    "investigate": "Identifique lacuna real de tarefa e compare solução proposta com o que já existe no projeto.",
    "deliver": "Proposta nova com usuário beneficiado, integração e critério verificável.",
    "verify": "Não confunde renomear recurso com nova capacidade nem propõe função sem caminho executável.",
    "handoff": "Encaminhe hipótese para implementação limitada e avaliação independente."
  },
  "agent-intelligence": {
    "investigate": "Investigue planejamento, seleção, ferramentas, recibos, falhas e cooperação em tarefas representativas.",
    "deliver": "Proposta mensurável de melhora na conclusão e rastreabilidade dos agentes.",
    "verify": "Nomes e prompts não comprovam execução; exija registros e casos de erro.",
    "handoff": "Encaminhe mudanças de coordenação sem atribuir capacidade ou acesso inexistente."
  },
  "competitive-benchmarks": {
    "investigate": "Defina tarefas equivalentes, avaliação cega, custo e condições dos modelos comparados.",
    "deliver": "Benchmark reproduzível com critérios, amostras e incerteza.",
    "verify": "Não usa SDK ou modelo diferente como prova de superioridade nem escolhe só exemplos favoráveis.",
    "handoff": "Encaminhe dados e critérios para revisão independente antes de divulgar resultado."
  },
  "nextgen-architecture": {
    "investigate": "Examine pontos únicos de falha, filas, leases, recuperação, latência e compatibilidade do sistema atual.",
    "deliver": "Experimento arquitetural incremental com baseline e cenário de recuperação.",
    "verify": "Não troca arquitetura funcional sem evidência proporcional ou ignora limites da hospedagem.",
    "handoff": "Encaminhe patch limitado e medição de regressão ao comitê."
  },
  "longterm-learning": {
    "investigate": "Meça recuperação de histórico, contexto relevante, isolamento e exclusão sem confundir índice com memória ilimitada.",
    "deliver": "Experimento de memória com perguntas de continuidade, precisão e perda de contexto.",
    "verify": "Não amplia retenção expondo dados ou remove decisão anterior silenciosamente.",
    "handoff": "Entregue critérios de consentimento e regressão à camada de memória existente."
  },
  "tools-integrations": {
    "investigate": "Confira API oficial, permissão, escopo, tempo limite e recibos das ferramentas disponíveis.",
    "deliver": "Integração verificável com tratamento de indisponibilidade e autorização.",
    "verify": "Prompt não cria permissão; credencial de outro ambiente não comprova acesso nesta sessão.",
    "handoff": "Encaminhe conexão e testes reais sem pedir segredo no chat."
  },
  "intelligent-optimization": {
    "investigate": "Meça latência, tokens, custo e erros antes de formular uma otimização.",
    "deliver": "Proposta com baseline e comparação controlada de desempenho e qualidade.",
    "verify": "Não reduz custo sacrificando qualidade silenciosamente nem inventa ganho percentual.",
    "handoff": "Encaminhe limiares de aceitação e reversão à avaliação."
  },
  "experimentation": {
    "investigate": "Formule hipótese falseável, grupo de comparação, métricas e condições de repetição.",
    "deliver": "Experimento com cenários, resultado esperado, risco e critério de interrupção.",
    "verify": "Resultado inconclusivo não vira melhoria aprovada; falha e no_proposal têm motivo registrado.",
    "handoff": "Encaminhe evidência ao avaliador independente e preserve a baseline funcional."
  }
};
export function describeAgentQuality(id: string): string {
  const contract = AGENT_QUALITY_CONTRACTS[id];
  return contract ? ["INVESTIGAÇÃO: " + contract.investigate, "ENTREGA: " + contract.deliver, "VERIFICAÇÃO: " + contract.verify, "COOPERAÇÃO: " + contract.handoff].join("\n") : "";
}
