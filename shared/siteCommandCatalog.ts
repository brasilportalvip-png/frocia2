/**
 * Froc.IA — Central de Comandos do Site.
 *
 * Catálogo único de TODAS as ações que a IA pode executar na interface
 * (abrir, fechar, navegar, criar, excluir, verificar, testar...).
 * Este arquivo é puro (sem React, sem DOM, sem Firebase) para ser usado:
 *  - no navegador, pelo interpretador de voz;
 *  - no servidor, pela interpretação com IA (/api/site-commands/interpret);
 *  - nos testes automatizados.
 *
 * Regras de segurança:
 *  - audience 'admin'  → só executa para administrador (o servidor continua validando cada API);
 *  - destructive true  → exige confirmação falada ("confirmar") antes de executar.
 */

export type SiteCommandAudience = 'user' | 'admin';

export type SiteCommandCategory =
  | 'navegacao'
  | 'conversas'
  | 'ferramentas'
  | 'projetos'
  | 'visualizacao'
  | 'conta'
  | 'administracao'
  | 'sistema';

export interface SiteCommandParams {
  /** Nome, número ou referência ("atual", "última", "2", "segunda"). */
  name?: string;
  /** Modo do chat, dispositivo, aba ou tema conforme o comando. */
  value?: string;
}

export interface SiteCommandDefinition {
  id: string;
  title: string;
  description: string;
  category: SiteCommandCategory;
  audience: SiteCommandAudience;
  destructive?: boolean;
  /** Comando executado antes quando a tela que contém a ação ainda não está aberta. */
  requires?: string;
  /** Exemplos falados (usados na ajuda e na interpretação por IA). */
  examples: string[];
  /** Valores aceitos em params.value (quando houver). */
  values?: readonly string[];
  patterns: RegExp[];
}

export interface ParsedSiteCommand {
  id: string;
  params: SiteCommandParams;
  source: 'local' | 'ai';
}

/* ------------------------------------------------------------------ */
/* Normalização                                                         */
/* ------------------------------------------------------------------ */

const WAKE = /^(?:(?:ok(?:ay)?|ola|ei|oi|hey)\s+)?(?:froc|frock|frog|froke|froqui|froc ia|frocia)\b\s*/;
const POLITE_PREFIX =
  /^(?:por favor|porfavor|pf|agora|entao|e|ai|bom|beleza|certo|ok|tudo bem|eu quero que voce|quero que voce|preciso que voce|gostaria que voce|eu quero|quero|preciso|gostaria de|voce pode|voce poderia|voce consegue|pode|poderia|consegue|da para|tem como|me ajuda a|me ajude a|faz o favor de|faca o favor de)\s+/;
const POLITE_SUFFIX =
  /\s+(?:por favor|pf|agora|pra mim|para mim|ai|ali|aqui|ja|rapidinho|de novo|novamente|obrigado|obrigada|valeu)$/;

export function normalizeCommandText(text: string): string {
  let value = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  value = value.replace(WAKE, '').trim();
  for (let guard = 0; guard < 6; guard += 1) {
    const next = value.replace(POLITE_PREFIX, '').replace(POLITE_SUFFIX, '').trim();
    if (next === value) break;
    value = next;
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Blocos de expressões (texto já normalizado: sem acento, minúsculo)   */
/* ------------------------------------------------------------------ */

const OPEN =
  '(?:abr(?:a|e|ir|i)|mostr(?:e|a|ar)|me mostr(?:e|a)|exib(?:a|e|ir)|ver|veja|visualiz(?:e|a|ar)|acess(?:e|a|ar)|carreg(?:ue|a|ar)|selecion(?:e|a|ar)|entr(?:e|a|ar) (?:em|no|na|nos|nas)|(?:me )?lev(?:e|a)(?: me)? (?:para|pro|pra|ao|a|na|no)|v(?:a|ai) (?:para|pro|pra|ao|a|em|no|na|nas|nos)|ir (?:para|pro|pra|ao|a|na|no)|naveg(?:ue|a|ar) (?:para|ate)|volt(?:e|a|ar) (?:para|pro|pra|ao|a|na|no)|quero ver|cade)';
const CLOSE =
  '(?:fech(?:e|a|ar)|ocult(?:e|a|ar)|escond(?:a|e|er)|minimiz(?:e|a|ar)|recolh(?:a|e|er)|sai(?:a|r)? (?:da|do|de)|tir(?:e|a|ar)|desativ(?:e|a|ar))';
const DELETE =
  '(?:exclu(?:a|i|ir)|apag(?:ue|a|ar)|delet(?:e|a|ar)|remov(?:a|e|er)|limp(?:e|a|ar)|elimin(?:e|a|ar)|jog(?:ue|a|ar) fora|descart(?:e|a|ar))';
const CREATE =
  '(?:cri(?:e|a|ar)|inici(?:e|a|ar)|comec(?:e|a|ar)|abr(?:a|e|ir) (?:um|uma)|fa(?:ca|z|zer) (?:um|uma)|gere|gera|gerar)';
const SWITCH =
  '(?:mud(?:e|a|ar)|troqu?(?:e|a|ar)|trocar|alter(?:e|a|ar)|us(?:e|a|ar)|coloqu?(?:e|a)|colocar|ativ(?:e|a|ar)|lig(?:ue|a|ar)|pass(?:e|a|ar)|selecion(?:e|a|ar)|deix(?:e|a|ar)|bot(?:e|a|ar))';
const RUN =
  '(?:verifiqu?(?:e|a)|verificar|test(?:e|a|ar)|chequ?(?:e|a)|checar|diagnostiqu?(?:e|a)|diagnosticar|rod(?:e|a|ar)|execut(?:e|a|ar)|fa(?:ca|z|zer) (?:um|uma|o|a)?\\s*(?:teste|diagnostico|verificacao|checagem))';
const LIST = '(?:list(?:e|a|ar)|quais (?:sao|sao as|sao os)?|me (?:diga|fala|fale|diz)|diga|fala|fale|mostr(?:e|a|ar) a lista de)';
const STOP = '(?:par(?:e|a|ar)|interromp(?:a|e|er)|cancel(?:e|a|ar)|segur(?:e|a|ar))';
const EXPORT = '(?:export(?:e|a|ar)|baix(?:e|a|ar)|fa(?:ca|zer) (?:o )?download(?: d[eoa])?|download(?: d[eoa])?|salv(?:e|a|ar) (?:em|como) zip)';
const CLICK =
  '(?:cliqu?(?:e|a)|clicar|clica|apert(?:e|a|ar)|pression(?:e|a|ar)|toqu?(?:e|a)|tocar|acion(?:e|a|ar)|marqu?(?:e|a)|marcar|desmarqu?(?:e|a)|desmarcar|escolh(?:a|e|er)|selecion(?:e|a|ar)|confirm(?:e|ar) (?:o|a|no|na)|d(?:e|a|ar) (?:um )?(?:clique|click) (?:em|no|na))';
const TYPE = '(?:digit(?:e|a|ar)|preench(?:a|e|er)(?: com)?)';
const FILL =
  '(?:(?:o|a|os|as|um|uma|meu|minha|meus|minhas|seu|sua|do|da|de|dos|das|no|na|nos|nas|em|ao|aos|pro|pra|para|tela|pagina|aba|janela|area|secao|modal|parte|opcao|opcoes|guia)\\s+)*';
const NAME_LINK =
  '(?:\\s+(?:sobre|chamad[oa]|com (?:o )?(?:titulo|nome)|de nome|de titulo|intitulad[oa]|que fala (?:sobre|de)|do|da|de|numero|n))?';
const THIS = '(?:est[ea]|ess[ea]|atual|aberta|aberto|corrente)';

const rx = (verbs: string, targets: string, tail = '') =>
  new RegExp(`^${verbs}\\s+${FILL}(?:${targets})${tail}$`);
const exact = (body: string) => new RegExp(`^(?:${body})$`);

/* ------------------------------------------------------------------ */
/* Catálogo                                                            */
/* ------------------------------------------------------------------ */

export const CHAT_MODE_VALUES = ['Rápido', 'Inteligente', 'Profundo', 'Programação', 'Pesquisa', 'Criador de projetos', 'Imagem', 'Vídeo'] as const;
export const DEVICE_VALUES = ['desktop', 'tablet', 'mobile'] as const;
export const THEME_VALUES = ['light', 'dark', 'toggle'] as const;
export const SIDEBAR_SECTION_VALUES = ['history', 'projects', 'create', 'templates', 'tools'] as const;

const MODE_WORDS =
  '(?<value>rapido|inteligente|profundo|programacao|codigo|programador|pesquisa|pesquisar|criador de projetos|criador|criacao de sites|imagem|imagens|video|videos)';

export const SITE_COMMANDS: SiteCommandDefinition[] = [
  /* ---------------- Navegação ---------------- */
  {
    id: 'nav.studio', title: 'Ir para o início (chat)', category: 'navegacao', audience: 'user',
    description: 'Abre a tela principal de conversa/estúdio.',
    examples: ['ir para o início', 'voltar para o chat', 'abrir o estúdio'],
    patterns: [
      rx(OPEN, '(?:inicio|tela inicial|home|estudio|chat|conversa principal|pagina principal|comeco)'),
      exact('(?:volt(?:e|a|ar)|voltar ao inicio|inicio|pagina inicial|tela inicial)'),
    ],
  },
  {
    id: 'nav.dashboard', title: 'Abrir meu painel', category: 'navegacao', audience: 'user',
    description: 'Abre o painel do usuário com projetos salvos, créditos e plano.',
    examples: ['abrir meu painel', 'mostrar o dashboard'],
    patterns: [rx(OPEN, '(?:painel(?: do usuario| de projetos| pessoal)?|meu painel|dashboard|minha conta|area do usuario|minha area)')],
  },
  {
    id: 'nav.pricing', title: 'Abrir preços e créditos', category: 'navegacao', audience: 'user',
    description: 'Abre a página de planos, preços e compra de créditos.',
    examples: ['abrir preços', 'quero comprar créditos', 'mostrar os planos'],
    patterns: [
      rx(OPEN, '(?:precos?|planos?|creditos|compra de creditos|comprar creditos|assinaturas?|pagamentos?|tabela de precos?)'),
      exact('(?:comprar|compre|adicionar|adicione|recarregar|recarregue) (?:mais )?creditos'),
    ],
  },
  {
    id: 'nav.integrations', title: 'Abrir integrações', category: 'navegacao', audience: 'user',
    description: 'Abre a página de integrações e conexões externas.',
    examples: ['abrir integrações', 'mostrar conexões'],
    patterns: [rx(OPEN, '(?:integracoes|integracao|conexoes|conectores|apps conectados)')],
  },
  {
    id: 'nav.admin', title: 'Abrir painel administrativo', category: 'administracao', audience: 'admin',
    description: 'Abre o painel executivo do administrador.',
    examples: ['abrir o painel admin', 'ir para administração'],
    patterns: [rx(OPEN, '(?:painel (?:do )?(?:admin|adm|administrador|administrativo|executivo)|admin|adm|administracao|area (?:do )?admin(?:istrador)?|painel de controle)')],
  },

  /* ---------------- Administração (só admin) ---------------- */
  {
    id: 'admin.tab', title: 'Abrir aba do painel admin', category: 'administracao', audience: 'admin', requires: 'nav.admin',
    description: 'Troca a aba do painel admin: metrics (métricas), models (modelos de IA), users (usuários/créditos), audit (auditoria), selfEvolution (autoevolução/agentes).',
    values: ['metrics', 'models', 'users', 'audit', 'selfEvolution'],
    examples: ['abrir métricas', 'mostrar os logs de auditoria', 'abrir autoevolução', 'abrir aba de usuários'],
    patterns: [
      rx(OPEN, '(?<value>metricas|indicadores|faturamento|receita|saude dos modelos|modelos de ia|aba de modelos|usuarios|gestao de usuarios|conceder creditos|dar creditos|auditoria|logs(?: de auditoria)?|eventos de seguranca|autoevolucao|auto evolucao|evolucao|comite|agentes(?: autonomos)?)'),
    ],
  },
  {
    id: 'admin.prompts', title: 'Abrir registro de prompts', category: 'administracao', audience: 'admin', requires: 'nav.admin',
    description: 'Abre o registro/versionamento de prompts do sistema.',
    examples: ['abrir prompts', 'abrir registro de prompts'],
    patterns: [rx(OPEN, '(?:(?:registro|versoes|gerenciador) de prompts?|prompts?(?: do sistema)?)')],
  },
  {
    id: 'admin.evaluations', title: 'Abrir avaliações', category: 'administracao', audience: 'admin', requires: 'nav.admin',
    description: 'Abre as avaliações (evals) de qualidade da IA.',
    examples: ['abrir avaliações', 'mostrar evals'],
    patterns: [rx(OPEN, '(?:avaliacoes|avaliacao|evals?|benchmarks?)')],
  },
  {
    id: 'admin.traces', title: 'Abrir rastros de execução', category: 'administracao', audience: 'admin', requires: 'nav.admin',
    description: 'Abre os rastros (traces) de execução da IA.',
    examples: ['abrir rastros de execução', 'mostrar traces'],
    patterns: [rx(OPEN, '(?:rastros?(?: de execucao)?|traces?|execucoes|historico de execucoes)')],
  },
  {
    id: 'admin.observability', title: 'Abrir observabilidade', category: 'administracao', audience: 'admin', requires: 'nav.admin',
    description: 'Abre a observabilidade operacional (erros, latência, saúde).',
    examples: ['abrir observabilidade', 'mostrar monitoramento'],
    patterns: [rx(OPEN, '(?:observabilidade|monitoramento|telemetria|saude do sistema|status do sistema)')],
  },
  {
    id: 'admin.featureFlags', title: 'Abrir chaves de funcionalidades', category: 'administracao', audience: 'admin', requires: 'nav.admin',
    description: 'Abre o painel de feature flags (ligar/desligar funcionalidades).',
    examples: ['abrir feature flags', 'abrir chaves de funcionalidades'],
    patterns: [rx(OPEN, '(?:feature flags?|flags?|chaves(?: de funcionalidades?)?|interruptores|liga desliga)')],
  },
  {
    id: 'admin.disasterRecovery', title: 'Abrir recuperação de desastre', category: 'administracao', audience: 'admin', requires: 'nav.admin',
    description: 'Abre backups e recuperação de desastre.',
    examples: ['abrir recuperação de desastre', 'abrir backups'],
    patterns: [rx(OPEN, '(?:recuperacao(?: de desastres?)?|backups?|copias de seguranca|restauracao)')],
  },

  /* ---------------- Conversas ---------------- */
  {
    id: 'chat.new', title: 'Nova conversa', category: 'conversas', audience: 'user',
    description: 'Cria uma conversa nova e limpa.',
    examples: ['nova conversa', 'criar uma conversa nova', 'começar novo chat'],
    patterns: [
      exact('(?:nova conversa|novo chat|chat novo|conversa nova)'),
      rx(CREATE, '(?:nova conversa|novo chat|chat novo|conversa nova|conversa|chat)(?: nova| novo)?'),
      rx(OPEN, '(?:nova conversa|novo chat|chat novo|conversa nova)'),
    ],
  },
  {
    id: 'chat.open', title: 'Abrir conversa', category: 'conversas', audience: 'user', requires: 'nav.studio',
    description: 'Abre uma conversa do histórico pelo título, número ("2", "segunda") ou "última".',
    examples: ['abrir a conversa sobre marketing', 'abrir a segunda conversa', 'abrir a última conversa'],
    patterns: [
      rx(OPEN, `(?<name>ultima|penultima|anterior|primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava|nona|decima) conversa`),
      rx(OPEN, `conversa${NAME_LINK}\\s+(?<name>.+)`),
    ],
  },
  {
    id: 'chat.delete', title: 'Excluir conversa', category: 'conversas', audience: 'user', destructive: true,
    description: 'Exclui uma conversa (a atual ou pelo nome/número). Pede confirmação.',
    examples: ['excluir esta conversa', 'apagar a conversa sobre vendas', 'excluir a terceira conversa'],
    patterns: [
      rx(DELETE, `(?:${THIS} conversa|conversa(?: ${THIS})?)`),
      rx(DELETE, `(?<name>ultima|penultima|primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava|nona|decima) conversa`),
      rx(DELETE, `conversa${NAME_LINK}\\s+(?<name>.+)`),
    ],
  },
  {
    id: 'chat.deleteAll', title: 'Excluir todas as conversas', category: 'conversas', audience: 'user', destructive: true,
    description: 'Apaga todo o histórico de conversas do usuário. Pede confirmação.',
    examples: ['apagar todas as conversas', 'limpar todo o histórico'],
    patterns: [rx(DELETE, '(?:todas (?:as )?conversas|todo (?:o )?historico|historico (?:inteiro|todo|completo)|historico de conversas)')],
  },
  {
    id: 'chat.list', title: 'Listar conversas', category: 'conversas', audience: 'user',
    description: 'Lê em voz alta as conversas mais recentes.',
    examples: ['quais são minhas conversas', 'listar conversas'],
    patterns: [rx(LIST, '(?:conversas|lista de conversas|historico de conversas|historico)(?: recentes| salvas)?')],
  },
  {
    id: 'chat.stop', title: 'Parar a resposta', category: 'conversas', audience: 'user',
    description: 'Interrompe a resposta/pesquisa que está sendo gerada.',
    examples: ['parar a resposta', 'cancelar a geração'],
    patterns: [rx(STOP, '(?:resposta|geracao|gerar|de gerar|de responder|pesquisa|processamento|tudo)')],
  },
  {
    id: 'chat.mode', title: 'Trocar modo do chat', category: 'conversas', audience: 'user', requires: 'nav.studio',
    description: 'Troca o modo: Rápido, Inteligente, Profundo, Programação, Pesquisa, Criador de projetos, Imagem, Vídeo.',
    values: CHAT_MODE_VALUES,
    examples: ['mudar para modo pesquisa', 'modo rápido', 'usar o modo programação'],
    patterns: [
      exact(`modo ${MODE_WORDS}`),
      rx(SWITCH, `(?:modo )?${MODE_WORDS}`, '(?: mode)?'),
      rx(SWITCH, `(?:o )?modo (?:para |pra |de )?(?:o )?(?:modo )?${MODE_WORDS}`),
    ],
  },
  {
    id: 'chat.scroll', title: 'Rolar a conversa', category: 'conversas', audience: 'user', requires: 'nav.studio',
    description: 'Rola a conversa para o topo ou para o final.',
    values: ['top', 'bottom'],
    examples: ['rolar para cima', 'ir para o final da conversa'],
    patterns: [
      exact('(?:rol(?:e|a|ar)|desc(?:a|e|er)|v(?:a|ai)|ir)\\s+(?:para |pro |pra |ate )?(?:o |a )?(?<value>final|fim|baixo|ultima mensagem)(?: da conversa)?'),
      exact('(?:rol(?:e|a|ar)|sub(?:a|e|ir)|v(?:a|ai)|ir)\\s+(?:para |pro |pra |ate )?(?:o |a )?(?<value>topo|cima|inicio da conversa|primeira mensagem)(?: da conversa)?'),
    ],
  },

  /* ---------------- Ferramentas do chat ---------------- */
  {
    id: 'tool.attachments', title: 'Abrir menu de anexos', category: 'ferramentas', audience: 'user', requires: 'nav.studio',
    description: 'Abre o menu para anexar arquivos, fotos, áudio, código, ZIP.',
    examples: ['abrir anexos', 'quero anexar um arquivo'],
    patterns: [
      rx(OPEN, '(?:anexos?|menu de anexos?|clipe|arquivos? para anexar)'),
      exact('(?:anex(?:e|a|ar)|adicion(?:e|a|ar)|envi(?:e|a|ar)) (?:um |uma )?(?:arquivos?|anexos?|documentos?)'),
    ],
  },
  {
    id: 'tool.camera', title: 'Abrir câmera/scanner', category: 'ferramentas', audience: 'user', requires: 'nav.studio',
    description: 'Abre a câmera para fotografar ou escanear documentos.',
    examples: ['abrir a câmera', 'escanear documento'],
    patterns: [
      rx(OPEN, '(?:camera|scanner|escaner|leitor de documentos)'),
      exact('(?:escane(?:ie|ia|ar)|digitaliz(?:e|a|ar)|fotograf(?:e|a|ar)|tir(?:e|a|ar) (?:uma )?foto)(?: (?:de )?(?:um |uma )?(?:documento|papel|foto))?'),
    ],
  },
  {
    id: 'tool.voiceRecorder', title: 'Abrir gravador de áudio', category: 'ferramentas', audience: 'user', requires: 'nav.studio',
    description: 'Abre o gravador para gravar um áudio e anexar.',
    examples: ['abrir gravador', 'gravar um áudio'],
    patterns: [
      rx(OPEN, '(?:gravador(?: de (?:voz|audio))?|gravacao de (?:voz|audio))'),
      exact('(?:grav(?:e|a|ar)) (?:um |uma )?(?:audio|mensagem de voz|voz)'),
    ],
  },
  {
    id: 'tool.url', title: 'Importar de URL', category: 'ferramentas', audience: 'user', requires: 'nav.studio',
    description: 'Abre o importador de site/página por endereço (URL).',
    examples: ['importar de url', 'abrir importador de site'],
    patterns: [
      rx(OPEN, '(?:importador(?: de)? (?:url|link|site|pagina)|importar (?:de )?(?:url|link|site))'),
      exact('import(?:e|a|ar) (?:de |um |uma |por )?(?:url|link|site|pagina)'),
    ],
  },
  {
    id: 'tool.github', title: 'Importar do GitHub', category: 'ferramentas', audience: 'user', requires: 'nav.studio',
    description: 'Abre o importador de repositório do GitHub.',
    examples: ['importar do github', 'abrir importador do github'],
    patterns: [
      rx(OPEN, '(?:importador (?:do |de )?(?:github|git hub|repositorio)|github|git hub)'),
      exact('import(?:e|a|ar) (?:do |de |um )?(?:github|git hub|repositorio)'),
    ],
  },
  {
    id: 'tool.code', title: 'Colar trecho de código', category: 'ferramentas', audience: 'user', requires: 'nav.studio',
    description: 'Abre a janela para colar um trecho de código.',
    examples: ['colar código', 'abrir trecho de código'],
    patterns: [
      rx(OPEN, '(?:trecho de codigo|janela de codigo|snippet|colar codigo)'),
      exact('col(?:e|a|ar) (?:um )?(?:codigo|trecho de codigo)'),
    ],
  },
  {
    id: 'tool.knowledge', title: 'Abrir base de conhecimento', category: 'ferramentas', audience: 'user', requires: 'nav.studio',
    description: 'Abre as bases de conhecimento (documentos para a IA consultar).',
    examples: ['abrir base de conhecimento'],
    patterns: [rx(OPEN, '(?:bases? de conhecimentos?|conhecimento|biblioteca de documentos)')],
  },

  /* ---------------- Projetos / sites ---------------- */
  {
    id: 'site.new', title: 'Novo projeto/site', category: 'projetos', audience: 'user',
    description: 'Limpa o estúdio para começar um site/projeto novo.',
    examples: ['novo site', 'começar um projeto novo'],
    patterns: [
      exact('(?:novo (?:site|projeto)|(?:site|projeto) novo)'),
      rx(`(?:${CREATE}|${OPEN})`, '(?:novo (?:site|projeto)|(?:site|projeto) novo)'),
    ],
  },
  {
    id: 'site.open', title: 'Abrir projeto', category: 'projetos', audience: 'user', requires: 'nav.studio',
    description: 'Abre um projeto/site salvo pelo nome, número ou "último".',
    examples: ['abrir o projeto loja de roupas', 'abrir o último projeto'],
    patterns: [
      rx(OPEN, '(?<name>ultimo|penultimo|primeiro|segundo|terceiro|quarto|quinto|sexto|setimo|oitavo|nono|decimo) (?:projeto|site)'),
      rx(OPEN, `(?:projeto|site)${NAME_LINK}\\s+(?<name>.+)`),
    ],
  },
  {
    id: 'site.delete', title: 'Excluir projeto', category: 'projetos', audience: 'user', destructive: true,
    description: 'Exclui um projeto/site (o aberto ou pelo nome/número). Pede confirmação.',
    examples: ['excluir este projeto', 'apagar o projeto loja de roupas'],
    patterns: [
      rx(DELETE, `(?:${THIS} (?:projeto|site)|(?:projeto|site)(?: ${THIS})?)`),
      rx(DELETE, '(?<name>ultimo|penultimo|primeiro|segundo|terceiro|quarto|quinto|sexto|setimo|oitavo|nono|decimo) (?:projeto|site)'),
      rx(DELETE, `(?:projeto|site)${NAME_LINK}\\s+(?<name>.+)`),
    ],
  },
  {
    id: 'site.clearLocal', title: 'Limpar projetos locais', category: 'projetos', audience: 'user', destructive: true,
    description: 'Remove da lista os projetos que só existem neste aparelho. Pede confirmação.',
    examples: ['limpar projetos locais'],
    patterns: [rx(DELETE, '(?:projetos (?:locais|deste aparelho|do navegador)|lista local)')],
  },
  {
    id: 'site.favorite', title: 'Favoritar projeto', category: 'projetos', audience: 'user',
    description: 'Marca/desmarca o projeto aberto como favorito.',
    examples: ['favoritar este projeto'],
    patterns: [exact(`(?:favorit(?:e|a|ar)|marqu?(?:e|a|ar) como favorito|desfavorit(?:e|a|ar))(?: (?:o |este |esse )?(?:projeto|site)(?: ${THIS})?)?`)],
  },
  {
    id: 'site.export', title: 'Exportar/baixar projeto', category: 'projetos', audience: 'user',
    description: 'Abre a exportação (ZIP/download) do projeto aberto.',
    examples: ['exportar o site', 'baixar o projeto'],
    patterns: [
      exact(`${EXPORT}(?: (?:o |a |este |esse )?(?:site|projeto|zip|codigo|arquivos?)(?: ${THIS})?)?`),
      rx(OPEN, '(?:exportacao|exportar)'),
    ],
  },
  {
    id: 'site.configure', title: 'Configurar projeto', category: 'projetos', audience: 'user',
    description: 'Abre as configurações/variáveis do projeto aberto.',
    examples: ['abrir configurações do projeto'],
    patterns: [rx(OPEN, '(?:configurac(?:ao|oes) do (?:projeto|site)|variaveis(?: do projeto)?|configurar (?:o )?(?:projeto|site))')],
  },
  {
    id: 'site.build', title: 'Painel de construção profissional', category: 'projetos', audience: 'user',
    description: 'Abre o painel de construção/publicação profissional do projeto aberto.',
    examples: ['abrir painel de construção', 'abrir publicação'],
    patterns: [rx(OPEN, '(?:painel de (?:construcao|build|publicacao)|construcao profissional|build|publicacao|deploy)')],
  },
  {
    id: 'site.refresh', title: 'Atualizar a prévia', category: 'projetos', audience: 'user',
    description: 'Recarrega a prévia do site aberto.',
    examples: ['atualizar a prévia'],
    patterns: [exact('(?:atualiz(?:e|a|ar)|recarreg(?:ue|a|ar)) (?:a )?(?:previa|preview|visualizacao)(?: do site)?')],
  },

  /* ---------------- Visualização ---------------- */
  {
    id: 'view.mode', title: 'Ver prévia / código / dividido', category: 'visualizacao', audience: 'user',
    description: 'Alterna a visão do projeto: preview (prévia), code (código) ou split (lado a lado).',
    values: ['preview', 'code', 'split'],
    examples: ['ver a prévia', 'mostrar o código', 'ver lado a lado'],
    patterns: [
      rx(`(?:${OPEN}|${SWITCH})`, '(?:modo |visao )?(?<value>previa|preview|visualizacao do site|codigo(?: fonte)?|codigo do site|dividido|lado a lado|tela dividida|split)'),
    ],
  },
  {
    id: 'view.device', title: 'Simular dispositivo', category: 'visualizacao', audience: 'user',
    description: 'Mostra a prévia como desktop, tablet ou mobile (celular).',
    values: DEVICE_VALUES,
    examples: ['ver no celular', 'modo tablet', 'visualizar no computador'],
    patterns: [
      rx(`(?:${OPEN}|${SWITCH})`, '(?:(?:como|no|na|em|modo|versao|visao) )*(?<value>celular|mobile|telefone|smartphone|tablet|ipad|computador|desktop|pc|notebook)'),
      exact('(?:modo|versao|visao) (?<value>celular|mobile|tablet|computador|desktop)'),
    ],
  },
  {
    id: 'view.fullscreen', title: 'Tela cheia', category: 'visualizacao', audience: 'user',
    description: 'Abre (value=on) ou fecha (value=off) a prévia em tela cheia.',
    values: ['on', 'off'],
    examples: ['tela cheia', 'sair da tela cheia'],
    patterns: [
      exact('(?<value>tela cheia)'),
      rx(`(?:${OPEN}|${SWITCH})`, '(?:em )?(?<value>tela cheia)'),
      rx(CLOSE, '(?:da |de )?(?<value>tela cheia)'),
    ],
  },
  {
    id: 'ui.theme', title: 'Tema claro/escuro', category: 'visualizacao', audience: 'user',
    description: 'Troca o tema: light (claro), dark (escuro) ou toggle (alternar).',
    values: THEME_VALUES,
    examples: ['modo claro', 'ativar tema escuro', 'trocar o tema'],
    patterns: [
      exact('(?:modo|tema) (?<value>claro|escuro|noturno|diurno|branco|preto)'),
      rx(SWITCH, '(?:(?:o )?(?:modo|tema)(?: para| pra)? ?)?(?<value>claro|escuro|noturno|diurno|tema)'),
    ],
  },

  /* ---------------- Barra lateral ---------------- */
  {
    id: 'sidebar.toggle', title: 'Abrir/fechar menu lateral', category: 'navegacao', audience: 'user', requires: 'nav.studio',
    description: 'Abre (value=open) ou fecha (value=close) o menu lateral.',
    values: ['open', 'close'],
    examples: ['abrir o menu', 'fechar o menu lateral'],
    patterns: [
      rx(OPEN, '(?<value>menu(?: lateral| principal)?|barra lateral|sidebar)'),
      rx(CLOSE, '(?<value>menu(?: lateral| principal)?|barra lateral|sidebar)'),
    ],
  },
  {
    id: 'sidebar.section', title: 'Abrir seção do menu lateral', category: 'navegacao', audience: 'user', requires: 'nav.studio',
    description: 'Abre uma seção do menu lateral: history (histórico), projects (meus projetos), create (criar site), templates (modelos prontos), tools (ferramentas).',
    values: SIDEBAR_SECTION_VALUES,
    examples: ['abrir histórico', 'mostrar meus projetos', 'abrir modelos prontos', 'abrir ferramentas'],
    patterns: [
      rx(OPEN, '(?<value>historico|meus projetos|projetos(?: salvos)?|meus sites|sites salvos|criar site|criador de sites?|formulario de criacao|modelos prontos|templates?|modelos de sites?|ferramentas)'),
    ],
  },
  {
    id: 'support.open', title: 'Abrir suporte', category: 'navegacao', audience: 'user', requires: 'nav.studio',
    description: 'Abre o menu de suporte humano (WhatsApp / Telegram).',
    examples: ['abrir suporte', 'falar com o suporte'],
    patterns: [
      rx(OPEN, '(?:suporte|atendimento|ajuda humana|whatsapp|telegram)'),
      exact('(?:falar|fale|chamar|chame) (?:com )?(?:o )?(?:suporte|atendimento|atendente|humano)'),
    ],
  },

  /* ---------------- Conta ---------------- */
  {
    id: 'header.model', title: 'Escolher modelo de IA', category: 'conta', audience: 'user',
    description: 'Abre o seletor de modelo de IA.',
    examples: ['abrir seletor de modelo', 'trocar o modelo'],
    patterns: [
      rx(OPEN, '(?:seletor de modelos?|escolha de modelos?|modelo(?: de ia)?|modelos de inteligencia)'),
      exact('(?:troqu?(?:e|a|ar)|trocar|mud(?:e|a|ar)|escolh(?:a|e|er)) (?:o |de )?modelo(?: de ia)?'),
    ],
  },
  {
    id: 'header.memory', title: 'Abrir memórias', category: 'conta', audience: 'user',
    description: 'Abre o gerenciador de memórias da IA.',
    examples: ['abrir memórias', 'gerenciar memória'],
    patterns: [
      rx(OPEN, '(?:memorias?|gerenciador de memorias?|minhas memorias)'),
      exact('gerenci(?:e|a|ar) (?:as |a )?memorias?'),
    ],
  },
  {
    id: 'header.avatar', title: 'Trocar foto de perfil', category: 'conta', audience: 'user',
    description: 'Abre a troca de foto/avatar.',
    examples: ['trocar minha foto'],
    patterns: [
      rx(`(?:${OPEN}|${SWITCH})`, '(?:foto(?: de perfil)?|avatar|imagem de perfil)'),
    ],
  },
  {
    id: 'header.userMenu', title: 'Abrir menu do usuário', category: 'conta', audience: 'user',
    description: 'Abre o menu da conta (créditos, plano, tema, sair).',
    examples: ['abrir meu perfil', 'abrir menu da conta'],
    patterns: [rx(OPEN, '(?:perfil|meu perfil|menu (?:do usuario|da conta|de usuario))')],
  },
  {
    id: 'auth.login', title: 'Entrar / criar conta', category: 'conta', audience: 'user',
    description: 'Abre a janela de login/cadastro.',
    examples: ['fazer login', 'entrar na conta'],
    patterns: [
      exact('(?:entrar|entre|logar|login|fazer login|fa(?:ca|z) login|cadastr(?:e|a|ar)(?: me)?|criar conta|crie (?:uma )?conta)(?: na conta| na minha conta)?'),
      rx(OPEN, '(?:login|entrada|cadastro)'),
    ],
  },
  {
    id: 'auth.logout', title: 'Sair da conta', category: 'conta', audience: 'user', destructive: true,
    description: 'Encerra a sessão. Pede confirmação.',
    examples: ['sair da conta', 'fazer logout'],
    patterns: [exact('(?:sai(?:a|r)? da (?:minha )?conta|deslog(?:ue|a|ar)|logout|fa(?:ca|zer|z) logout|encerr(?:e|a|ar) (?:a )?sessao|sai(?:a|r)? do (?:site|sistema))')],
  },

  /* ---------------- Qualquer botão / campo da tela ---------------- */
  {
    id: 'ui.click', title: 'Apertar qualquer botão da tela', category: 'sistema', audience: 'user',
    description: 'Clica em qualquer botão, aba, link, opção ou interruptor visível na tela pelo nome (name = texto do botão). Use quando nenhum outro comando específico servir.',
    examples: ['clique em salvar', 'aperte o botão gerar relatório', 'marque a opção lembrar de mim'],
    patterns: [rx(CLICK, '(?:(?:botao|opcao|link|item|cartao|icone|interruptor|chave)\\s+)?(?:(?:de|do|da|com|escrito)\\s+)?(?<name>.+)')],
  },
  {
    id: 'ui.type', title: 'Digitar em um campo', category: 'sistema', audience: 'user',
    description: 'Digita um texto no campo em foco ou no campo citado (name = texto; value = nome do campo).',
    examples: ['digite meu nome é Ana no campo nome', 'digite promo10'],
    patterns: [exact(`${TYPE}\\s+(?<name>.+?)(?:\\s+(?:no|na|em) (?:campo|caixa) (?<value>.+))?`)],
  },
  {
    id: 'ui.screen', title: 'O que tem nesta tela', category: 'sistema', audience: 'user',
    description: 'Lê em voz alta os botões e opções que estão visíveis agora.',
    examples: ['o que tem nesta tela', 'quais botões tem aqui'],
    patterns: [
      exact('(?:o )?que (?:tem|ha|existe|aparece) (?:nesta|nessa|na|aqui na) (?:tela|pagina|janela)'),
      exact('(?:quais|que) (?:sao )?(?:os )?(?:botoes|opcoes)(?: (?:tem|existem|ha))?(?: (?:aqui|nesta tela|nessa tela|na tela))?'),
      exact('(?:o )?que (?:eu )?posso (?:clicar|apertar|fazer) (?:aqui|nesta tela)'),
      exact('(?:le|leia|ler) (?:a )?tela'),
    ],
  },

  /* ---------------- Sistema ---------------- */
  {
    id: 'ui.close', title: 'Fechar janela', category: 'sistema', audience: 'user',
    description: 'Fecha a janela/painel aberto no momento (ou todos).',
    examples: ['fechar', 'fechar tudo', 'fechar essa janela'],
    patterns: [
      exact(`${CLOSE}(?: (?:isso|isto|tudo|ela|ele|a janela|o modal|o painel|a tela|essa janela|esse painel|essa tela|o artefato|o canvas|a previa|o editor|todas as janelas))?`),
      exact('(?:fech(?:e|a|ar)|ocult(?:e|a|ar)|escond(?:a|e|er)|minimiz(?:e|a|ar))(?: .{1,48})?'),
    ],
  },
  {
    id: 'ui.reload', title: 'Recarregar o site', category: 'sistema', audience: 'user',
    description: 'Recarrega a página inteira.',
    examples: ['recarregar a página'],
    patterns: [exact('(?:recarreg(?:ue|a|ar)|atualiz(?:e|a|ar)|reinici(?:e|a|ar)) (?:a )?(?:pagina|site|tela|aplicativo|app)')],
  },
  {
    id: 'ui.help', title: 'O que posso pedir', category: 'sistema', audience: 'user',
    description: 'Lista os comandos de voz disponíveis.',
    examples: ['o que você pode fazer', 'quais comandos existem', 'ajuda'],
    patterns: [
      exact('(?:ajuda|socorro|comandos|lista de comandos|menu de comandos)'),
      exact('(?:o )?que (?:voce )?(?:pode|consegue|sabe) fazer(?: no site| aqui)?'),
      exact('(?:quais|que) (?:sao )?(?:os )?comandos(?: de voz)?(?: existem| disponiveis| tem)?'),
      rx(`(?:${LIST}|${OPEN})`, '(?:comandos(?: de voz)?|ajuda)'),
    ],
  },
  {
    id: 'ui.verify', title: 'Verificar e testar o site', category: 'sistema', audience: 'user',
    description: 'Testa agora cada comando do site, a conexão com o servidor e a sessão, e informa o resultado.',
    examples: ['verificar o site', 'testar todas as funções', 'fazer um diagnóstico'],
    patterns: [
      rx(RUN, '(?:tudo|o site|site|todas (?:as )?(?:funcoes|funcionalidades)|funcionalidades|funcoes|comandos|os comandos|botoes|a interface|interface|sistema|o sistema|se esta tudo (?:ok|certo|funcionando)|(?:um |o )?diagnostico(?: completo)?)(?: inteiro| todo| completo)?'),
      exact('(?:fa(?:ca|z|zer) (?:um |uma |o |a )?(?:teste|diagnostico|verificacao|checagem)|diagnostico|autoteste|auto teste|teste geral|verificacao geral)(?: geral| completo| completa| do site| no site| de tudo)?'),
    ],
  },
  {
    id: 'confirm.yes', title: 'Confirmar', category: 'sistema', audience: 'user',
    description: 'Confirma a ação pendente (exclusão, saída).',
    examples: ['confirmar', 'sim, pode excluir'],
    patterns: [exact('(?:(?:sim|isso|claro|certo|confirmo)\\s+)*(?:sim|confirm(?:o|a|ar|e)|confirmado|pode(?: sim)?|pode (?:excluir|apagar|sair|fazer|continuar|seguir|deletar|remover)|isso|isso mesmo|com certeza|certeza|claro|manda ver|vai|faca|faz)(?: sim)?')],
  },
  {
    id: 'confirm.no', title: 'Cancelar', category: 'sistema', audience: 'user',
    description: 'Cancela a ação pendente.',
    examples: ['cancelar', 'não'],
    patterns: [exact('(?:nao|cancel(?:a|e|ar)|cancelado|esquece|deixa(?: pra la)?|nao (?:precisa|quero|faca|faz|exclua|apague)|para|pare|desisto)(?: nao)?')],
  },
];

export const SITE_COMMAND_IDS = SITE_COMMANDS.map((command) => command.id);
const BY_ID = new Map(SITE_COMMANDS.map((command) => [command.id, command]));

export function getSiteCommand(id: string): SiteCommandDefinition | undefined {
  return BY_ID.get(id);
}

/* ------------------------------------------------------------------ */
/* Normalização de valores                                             */
/* ------------------------------------------------------------------ */

function normalizeValue(id: string, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = normalizeCommandText(raw);
  switch (id) {
    case 'chat.mode':
      if (/^rapid/.test(v)) return 'Rápido';
      if (/^intelig/.test(v)) return 'Inteligente';
      if (/^profund/.test(v)) return 'Profundo';
      if (/^(?:programa|codigo)/.test(v)) return 'Programação';
      if (/^pesquis/.test(v)) return 'Pesquisa';
      if (/^cria/.test(v)) return 'Criador de projetos';
      if (/^imag/.test(v)) return 'Imagem';
      if (/^vide/.test(v)) return 'Vídeo';
      return undefined;
    case 'view.mode':
      if (/^(?:previa|preview|visualiz)/.test(v)) return 'preview';
      if (/^codigo/.test(v)) return 'code';
      return 'split';
    case 'view.device':
      if (/(?:celular|mobile|telefone|smartphone)/.test(v)) return 'mobile';
      if (/(?:tablet|ipad)/.test(v)) return 'tablet';
      return 'desktop';
    case 'view.fullscreen':
      return 'on';
    case 'ui.theme':
      if (/(?:claro|diurno|branco)/.test(v)) return 'light';
      if (/(?:escuro|noturno|preto)/.test(v)) return 'dark';
      return 'toggle';
    case 'sidebar.toggle':
      return 'open';
    case 'sidebar.section':
      if (/historico/.test(v)) return 'history';
      if (/(?:projetos|sites)/.test(v)) return 'projects';
      if (/(?:criar|criador|formulario)/.test(v)) return 'create';
      if (/(?:modelos|templates?)/.test(v)) return 'templates';
      if (/ferramentas/.test(v)) return 'tools';
      return undefined;
    case 'chat.scroll':
      return /(?:topo|cima|inicio|primeira)/.test(v) ? 'top' : 'bottom';
    case 'admin.tab':
      if (/(?:metricas|indicadores|faturamento|receita)/.test(v)) return 'metrics';
      if (/modelos/.test(v)) return 'models';
      if (/(?:usuarios|creditos)/.test(v)) return 'users';
      if (/(?:auditoria|logs|seguranca)/.test(v)) return 'audit';
      return 'selfEvolution';
    default:
      return raw;
  }
}

/* ------------------------------------------------------------------ */
/* Interpretação local (rápida, sem custo, sem internet)               */
/* ------------------------------------------------------------------ */

/** "digite joão@gmail.com no campo e-mail" → mantém acentos, maiúsculas e símbolos do que será digitado. */
function rawTypedText(text: string): { name?: string; value?: string } {
  const original = String(text || '').trim();
  const verb = /\b(?:d[ií]git(?:e|a|ar)|preench(?:a|e|er)(?:\s+com)?)\s+/i.exec(original);
  if (!verb) return {};
  const rest = original.slice(verb.index + verb[0].length).trim();
  const field = /\s+(?:no|na|em)\s+(?:campo|caixa)\s+(.+)$/i.exec(rest);
  const name = (field ? rest.slice(0, field.index) : rest).replace(/^["“']|["”'.]$/g, '').trim();
  return { name: name || undefined, value: field?.[1]?.replace(/[.!]$/, '').trim() };
}

export function parseSiteCommand(text: string): ParsedSiteCommand | null {
  const normalized = normalizeCommandText(text);
  if (!normalized || normalized.length > 160) return null;
  if (normalized.split(' ').length > 18) return null;

  for (const command of SITE_COMMANDS) {
    for (const pattern of command.patterns) {
      const match = pattern.exec(normalized);
      if (!match) continue;
      const groups = match.groups || {};
      const params: SiteCommandParams = {};
      const name = groups.name?.trim();
      if (name) {
        // "abrir o site do google e pesquisar..." é pedido para a conversa, não um nome.
        if (name.split(' ').length > 7 || /\be\s+\w+(?:ar|er|ir)\b/.test(name)) continue;
        params.name = name;
      }
      const value = normalizeValue(command.id, groups.value);
      if (value) params.value = value;
      // fechar menu lateral / sair da tela cheia
      if (command.id === 'sidebar.toggle' && new RegExp(`^${CLOSE}\\b`).test(normalized)) params.value = 'close';
      if (command.id === 'view.fullscreen' && new RegExp(`^${CLOSE}\\b`).test(normalized)) params.value = 'off';
      if (command.id === 'chat.mode' && !params.value) continue;
      if (command.id === 'ui.type') Object.assign(params, rawTypedText(text));
      if (command.id === 'ui.click' && params.name && params.name.split(' ').length > 8) continue;
      if (command.id === 'sidebar.section' && !params.value) continue;
      return { id: command.id, params, source: 'local' };
    }
  }
  return null;
}

/**
 * Frases que parecem uma ordem para o site (para decidir se vale perguntar à IA
 * do servidor quando o interpretador local não reconheceu).
 */
export function looksLikeSiteCommand(text: string): boolean {
  const normalized = normalizeCommandText(text);
  if (!normalized || normalized.length > 160 || normalized.split(' ').length > 14) return false;
  if (/\?/.test(text)) return false;
  return new RegExp(`^(?:${OPEN}|${CLOSE}|${DELETE}|${SWITCH}|${RUN}|${EXPORT}|${STOP}|${CLICK}|${TYPE})\\b`).test(normalized) &&
    !/\b(?:imagem|imagens|foto de um|video sobre|texto|redacao|resumo|poema|historia|codigo que|funcao que|explique|explica)\b/.test(normalized);
}

/* ------------------------------------------------------------------ */
/* Resolução de itens por nome / número / posição                      */
/* ------------------------------------------------------------------ */

const ORDINALS: Record<string, number> = {
  primeira: 1, primeiro: 1, um: 1, uma: 1,
  segunda: 2, segundo: 2, dois: 2, duas: 2,
  terceira: 3, terceiro: 3, tres: 3,
  quarta: 4, quarto: 4, quatro: 4,
  quinta: 5, quinto: 5, cinco: 5,
  sexta: 6, sexto: 6, seis: 6,
  setima: 7, setimo: 7, sete: 7,
  oitava: 8, oitavo: 8, oito: 8,
  nona: 9, nono: 9, nove: 9,
  decima: 10, decimo: 10, dez: 10,
};

export type ResolveResult<T> =
  | { status: 'found'; item: T }
  | { status: 'current' }
  | { status: 'not_found' }
  | { status: 'ambiguous'; options: T[] };

/**
 * Resolve "atual", "última", "2", "segunda" ou um título aproximado.
 * A lista deve vir na ordem exibida ao usuário (mais recente primeiro).
 */
export function resolveNamedItem<T>(items: T[], query: string | undefined, title: (item: T) => string): ResolveResult<T> {
  const q = normalizeCommandText(query || '').replace(/^(?:a|o|de|do|da|numero|n)\s+/, '').trim();
  if (!q || /^(?:atual|aberta|aberto|esta|este|essa|esse|corrente)$/.test(q)) return { status: 'current' };
  if (!items.length) return { status: 'not_found' };
  if (/^(?:ultima|ultimo|mais recente|recente)$/.test(q)) return { status: 'found', item: items[0] };
  if (/^(?:penultima|penultimo|anterior)$/.test(q)) return items[1] ? { status: 'found', item: items[1] } : { status: 'not_found' };
  const index = /^\d{1,3}$/.test(q) ? Number(q) : ORDINALS[q];
  if (index) return items[index - 1] ? { status: 'found', item: items[index - 1] } : { status: 'not_found' };

  const scored = items.map((item) => {
    const t = normalizeCommandText(title(item));
    if (t === q) return { item, score: 100 };
    if (t.includes(q)) return { item, score: 80 };
    const words = q.split(' ').filter((word) => word.length > 2);
    if (!words.length) return { item, score: 0 };
    const hits = words.filter((word) => t.includes(word)).length;
    return { item, score: Math.round((hits / words.length) * 70) };
  }).filter((entry) => entry.score >= 45).sort((a, b) => b.score - a.score);

  if (!scored.length) return { status: 'not_found' };
  const top = scored.filter((entry) => entry.score === scored[0].score);
  if (top.length === 1 || scored[0].score === 100) return { status: 'found', item: top[0].item };
  return { status: 'ambiguous', options: top.slice(0, 4).map((entry) => entry.item) };
}

/* ------------------------------------------------------------------ */
/* Ajuda e catálogo para a IA                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_LABELS: Record<SiteCommandCategory, string> = {
  navegacao: 'Navegação',
  conversas: 'Conversas',
  ferramentas: 'Ferramentas',
  projetos: 'Projetos e sites',
  visualizacao: 'Visualização',
  conta: 'Conta',
  administracao: 'Administração (somente admin)',
  sistema: 'Sistema',
};

export function commandsForRole(isAdmin: boolean): SiteCommandDefinition[] {
  return SITE_COMMANDS.filter((command) => isAdmin || command.audience !== 'admin');
}

export function buildSiteCommandHelp(isAdmin: boolean): string {
  const groups = new Map<SiteCommandCategory, SiteCommandDefinition[]>();
  for (const command of commandsForRole(isAdmin)) {
    if (command.id.startsWith('confirm.')) continue;
    groups.set(command.category, [...(groups.get(command.category) || []), command]);
  }
  const lines: string[] = ['Posso fazer tudo isto por voz:'];
  for (const [category, commands] of groups) {
    lines.push(`\n${CATEGORY_LABELS[category]}:`);
    for (const command of commands) lines.push(`- ${command.title} — ex.: "${command.examples[0]}"`);
  }
  lines.push('\nExclusões e saída da conta pedem "confirmar". Qualquer outro pedido vai para a conversa normal.');
  return lines.join('\n');
}

export function buildSpokenHelp(isAdmin: boolean): string {
  return isAdmin
    ? 'Posso abrir e fechar qualquer tela, criar, abrir e excluir conversas e projetos, trocar modo, tema e dispositivo, exportar, testar o site e abrir todo o painel administrativo. A lista completa está na tela.'
    : 'Posso abrir e fechar telas, criar, abrir e excluir conversas e projetos, trocar modo, tema e dispositivo, exportar e testar o site. A lista completa está na tela.';
}

/** Catálogo compacto enviado à IA do servidor para interpretar frases livres. */
export function catalogForModel(isAdmin: boolean): Array<{ id: string; description: string; values?: readonly string[]; examples: string[]; takesName: boolean }> {
  return commandsForRole(isAdmin)
    .filter((command) => !command.id.startsWith('confirm.'))
    .map((command) => ({
      id: command.id,
      description: command.description,
      values: command.values,
      examples: command.examples,
      takesName: /\(\?<name>/.test(command.patterns.map((pattern) => pattern.source).join('')),
    }));
}

/* ------------------------------------------------------------------ */
/* Interpretação por IA (servidor): instrução e validação da resposta  */
/* ------------------------------------------------------------------ */

export function buildInterpretInstruction(isAdmin: boolean): string {
  return [
    'Você é o roteador de comandos de voz do site Froc.IA (português do Brasil).',
    'Receberá uma frase falada pelo usuário. Se ela for uma ORDEM para operar a interface do site,',
    'escolha exatamente um comando do catálogo abaixo. Se for uma pergunta, conversa, pedido de conteúdo',
    '(texto, imagem, vídeo, código, site novo com descrição) ou não corresponder a nenhum comando, responda id "none".',
    'Use "value" somente com um dos valores listados no comando. Use "name" para o título ou número citado.',
    'Nunca invente ids. Responda apenas JSON.',
    '',
    `CATÁLOGO: ${JSON.stringify(catalogForModel(isAdmin))}`,
  ].join('\n');
}

export function acceptModelInterpretation(
  raw: unknown,
  isAdmin: boolean
): { id: string; params: { name?: string; value?: string } } | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const id = typeof data.id === 'string' ? data.id.trim() : '';
  const confidence = typeof data.confidence === 'number' ? data.confidence : 0;
  const definition = getSiteCommand(id);
  if (!definition || id.startsWith('confirm.') || confidence < 0.6) return null;
  if (definition.audience === 'admin' && !isAdmin) return null;
  const params: { name?: string; value?: string } = {};
  if (typeof data.name === 'string' && data.name.trim()) params.name = data.name.trim().slice(0, 120);
  if (typeof data.value === 'string' && data.value.trim()) {
    const value = data.value.trim();
    if (definition.values && !definition.values.includes(value)) return null;
    params.value = value;
  }
  if (definition.values && !params.value && ['chat.mode', 'sidebar.section', 'admin.tab'].includes(id)) return null;
  return { id, params };
}
