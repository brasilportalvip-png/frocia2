# Froc.IA: conhecimento do proprio projeto e manutencao autonoma

## Escopo implementado no codigo

A Froc.IA passa a indexar seu proprio repositorio, consultar esse conhecimento na conversa do administrador, auditar o site e encaminhar falhas a esteira que gera codigo, testa, abre PR, verifica preview, revisa, faz merge e comprova a versao publicada. A ativacao real ainda depende da instalacao e dos acessos do ambiente.

### Conhecimento do projeto

- Cada execucao indexa os arquivos versionados do checkout, vinculados ao SHA completo. Fontes e configuracoes de texto sao armazenadas integralmente em partes; arquivos grandes nao sao cortados em 150 ou 700 mil caracteres nesse indice.
- O mapa inclui caminhos, hashes, dependencias, rotas encontradas no codigo, menu de navegacao e os vinte agentes: dez revisores e dez agentes de inovacao.
- Arquivos binarios recebem metadados; credenciais e arquivos de segredo ficam protegidos. Arquivos que nao puderam ser lidos sao declarados como pendentes.
- O grafo resolve imports ESM `.js` para os arquivos `.ts`/`.tsx` versionados. O worker recebe o inventario completo e seleciona o contexto pertinente a cada correcao.
- A importacao publica de repositorios continua tendo seu limite de transporte, agora com JSON valido e declaracao de leitura parcial. Esse importador e diferente do indice interno do proprio projeto.

### Varredura e fila

- O crawler trabalha em lotes de ate quarenta URLs para caber em uma chamada. A fronteira restante e persistida e retomada, inclusive no dia seguinte. Nao ha teto total de quarenta paginas ou duas mil URLs no modo interno retomavel.
- No proprio site autorizado pelo dono, robots nao e usado para descartar paginas. O auditor de sites de terceiros conserva o comportamento anterior.
- O navegador verifica as entradas do menu extraidas do codigo e as entradas marcadas no DOM. Hoje o menu tem oito entradas, incluindo Criar projeto; novas entradas marcadas tambem entram na descoberta. Navegar para essa tela nao cria um projeto nem envia formularios.
- Vistas pendentes podem ser retomadas. Falta de sessao, acesso ou tempo permanece visivel na cobertura.
- Todos os grupos distintos de falhas observadas entram na fila; o limite anterior de cinco novas tarefas foi removido. O historico integral dos achados fica nos documentos da geracao da auditoria.
- Falhas de HTML/HTTP, console, rede e navegacao nao dependem de o modelo propor uma novidade. A pesquisa externa dos agentes de inovacao continua separada da manutencao corretiva.
- Cobertura de codigo, paginas e navegacao nao e prova de todos os fluxos de negocio, pagamentos ou respostas possiveis do chat. Essas alegacoes exigem cenarios executados e evidencias correspondentes.

### Controle pelo proprietario

O papel de administrador vem da autenticacao do servidor; o cliente nao pode se promover enviando role ou userId no corpo.

Na conversa autenticada do administrador, pedidos sobre o proprio site recebem o mapa do projeto e os ultimos resultados reais do executor. Ordens explicitas como "Corrija os erros do meu site Froc IA" registram uma tarefa e solicitam o workflow. O recibo distingue pedido registrado, execucao solicitada e publicacao comprovada. Perguntas explicativas e ordens negadas nao iniciam uma correcao.

Comandos explicitos para pausar ou retomar os proprios agentes atualizam o controle persistente. O merge automatico consulta novamente a parada antes da publicacao. Falta de acesso ao GitHub permanece no recibo e a tarefa fica registrada, sem inventar sucesso.

Endpoints adicionais, todos com requireAuth e requireAdmin:

| Endpoint | Funcao |
| --- | --- |
| GET /api/admin/self-evolution/site-map | Mapa do projeto, agentes e estado operacional |
| GET /api/admin/self-evolution/repository/source?path=src/App.tsx&part=0 | Ler uma parte do arquivo indexado, com SHA e numero total de partes |
| POST /api/admin/self-evolution/control/run | Registrar e solicitar manutencao; corpo com reason |
| POST /api/admin/self-evolution/control/enabled | Pausar ou retomar; corpo com enabled true ou false |

## Agendamento e publicacao

- Primeira tentativa prevista para 09h17 de Brasilia; recuperacao/retomada a cada trinta minutos ate 20h47. O GitHub pode atrasar eventos; as tentativas extras reduzem a dependencia de um unico disparo, sem garantir pontualidade absoluta.
- Um workflow verde aguardando CI, preview, varredura ou verificacao de producao nao encerra as retomadas. O marcador de conclusao depende de nao haver retomada indicada.
- A selecao de tarefas considera todos os estados retomaveis, incluindo a verificacao depois do merge; nao fica limitada aos cem documentos mais recentes.
- O modo desta esteira permite manutencao do codigo do repositorio, inclusive agentes/worker/workflows, com SELF_EVOLUTION_FULL_REPOSITORY_ACCESS=true. Isso nao dispensa sandbox, testes, CI, preview ou revisao independente. Segredos permanecem fora dos arquivos gerados.
- A publicacao automatica fica habilitada por padrao no workflow, conforme o pedido do proprietario. A variable AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED=false conserva uma parada explicita da publicacao. A parada global persistente tambem e respeitada.
- O token proprio ou GitHub App tem prioridade. Sem esses tokens, o executor usa GITHUB_TOKEN com Contents/Pull requests/Actions e solicita o CI oficial por workflow_dispatch; assim nao depende do evento pull_request disparado pelo proprio token. O repositorio precisa permitir que Actions crie PRs.
- O ci.yml passa a aceitar workflow_dispatch. Um pedido de CI e persistido como ci_pending e nao regenera nem cobra outro patch nas retomadas.
- Antes de trabalho pago, a esteira verifica leitura autenticada de GitHub e Vercel. A escrita so e comprovada quando a acao real e aceita. Uma versao atualmente quebrada do site nao impede a verificacao de acesso para iniciar seu reparo.
- Apos o merge, approved_for_release/monitoring continuam retomaveis. O verificador resolve o alias de producao na Vercel, confirma projeto e SHA do deployment, executa /api/live, /api/ready, /api/health e navegador assinado, e confere novamente o alias. Apenas entao marca accepted.
- Falha comprovada da versao publicada aciona a reversao existente, agora compativel tambem com GitHub App. Merge da reversao e recuperacao publicada sao evidencias distintas.
- Os limites de orcamento existentes continuam aplicados; uma reserva concorrente recusada impede gerar codigo. Uma integracao configurada nao e prova de funcionamento de ponta a ponta.

## Configuracao dos ambientes

O aplicativo na Vercel e o executor do Actions sao ambientes distintos. O executor precisa receber as credenciais de servicos que utiliza. O pacote nao contem credenciais.

Para GitHub, pode-se usar o token padrao do Actions quando as configuracoes do repositorio permitem criar PRs e executar workflows. Para App/token proprio, configure uma das opcoes:

1. GitHub App: secrets FROC_GITHUB_APP_ID, FROC_GITHUB_APP_PRIVATE_KEY e variable FROC_GITHUB_APP_SLUG.
2. Token de automacao: secret SELF_EVOLUTION_GITHUB_TOKEN.
3. Token de instalacao ja emitido: secret FROC_GITHUB_APP_TOKEN, considerando a expiracao.

O App/token deve ter Contents, Pull requests e Actions com escrita, e leitura dos checks necessarios. Os nomes FROC_GITHUB_* do workflow sao traduzidos para as variaveis GITHUB_APP_* esperadas pelos servicos. Configuracoes do repositorio que comecam com GITHUB_ sao reservadas.

Para modificar arquivos de workflow, o App precisa tambem de Workflows com escrita, ou o token pessoal precisa da permissao correspondente. O token padrao do Actions nao concede essa capacidade; uma tentativa recusada permanece registrada como falha de acesso.

| Local | Nome | Funcao |
| --- | --- | --- |
| Secret | FIREBASE_SERVICE_ACCOUNT_KEY | Indice, fila, locks, resultados e auditoria persistente |
| Secret | GEMINI_API_KEY | Modelos dos agentes |
| Secrets | SELF_EVOLUTION_WORKER_TOKEN, SELF_EVOLUTION_WORKER_SIGNING_SECRET | Autenticacao e assinatura do worker |
| Secrets | VERCEL_TOKEN, VERCEL_PROJECT_ID | Consultar deployments e confirmar publicacao; o project ID tambem pode ser variable |
| Secret ou variable opcional | VERCEL_TEAM_ID | Identificar a equipe da Vercel |
| Variable | SELF_EVOLUTION_TARGET_URL | Padrao https://frocia2.vercel.app/ |
| Variable | SELF_EVOLUTION_RUNNER_ENABLED | false pausa os disparos automaticos |
| Variable | AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED | true por padrao no workflow; false pausa publicacao |
| Variable | BROWSER_TEST_LOGIN_URL | URL de login da conta de teste |
| Secrets | BROWSER_TEST_USER, BROWSER_TEST_PASSWORD | Sessao de teste das areas autenticadas |
| Variables opcionais | BROWSER_LOGIN_OPEN_SELECTOR, BROWSER_USER_SELECTOR, BROWSER_PASSWORD_SELECTOR, BROWSER_SUBMIT_SELECTOR, BROWSER_AUTHENTICATED_SELECTOR | Ajustar abertura do modal, login e confirmacao da sessao |

Para comandos administrativos na conversa do site, o backend da Vercel precisa do Firebase Admin e da integracao GitHub/App que possa solicitar Actions. O papel administrativo e verificado pelo servidor. O executor externo confirma sua propria habilitacao e acessos quando recebe o pedido.

Sem conta de teste ou com recurso externo indisponivel, a homologacao correspondente continua pendente. O sistema nao deve declarar essas areas saudaveis.

## Atualizacao do PR 84

1. Extraia a versao nova do ZIP em uma pasta nova.
2. Execute ATUALIZAR_PR84.cmd no computador com o clone usado no primeiro pacote. O padrao e Desktop/frocia2; para outra pasta, arraste-a sobre o CMD.
3. O aplicador confirma o repositorio, exige trabalho local salvo, busca a branch fix/agentes-auditoria-20261023, confere e aplica o patch incremental, cria o commit e atualiza o mesmo PR 84. Nenhum arquivo e descartado e nao ha force-push.
4. Confira a nova execucao do CI no PR 84. Depois de integrar a branch, a esteira nova estara na main. A execucao real e a publicacao precisam ser confirmadas nos resultados da propria esteira.

O aplicador antigo nao deve ser usado para esta atualizacao. Ele criava a branch que agora ja existe.

## Evidencias desta versao

- Falha original do PR 84: seis casos E2E expiravam porque as fixtures HTML eram servidas sem UTF-8. O trace registrou InÃ­cio no lugar de Inicio acentuado. Foi corrigido o charset no HTML e nas respostas HTTP.
- 599 testes em 93 arquivos aprovados.
- Navegador Chromium 151: 18 casos aprovados, inclusive com CI=true; quatro casos de ambiente publicado ficaram ignorados porque E2E_BASE_URL nao foi fornecida.
- TypeScript, build, validacoes de tracker/migrations/integridade e actionlint aprovados. A validacao de migrations foi estatica; nao executou uma migracao na base real.
- npm audit --omit=dev --audit-level=moderate: nenhuma vulnerabilidade encontrada.
- O patch de atualizacao parte do commit 0577b727843d6d3d215d5f92692fc33d79459dbb do PR 84, cuja base e e57f4d7c706fa5f9e13d238fc793d6903221f08d.
- A API de gravacao desta conversa retornou HTTP 403 Resource not accessible by integration. Nenhuma destas atualizacoes foi enviada por esta conversa ao PR, mesclada na main ou publicada. Isso nao comprova ausencia de acesso da propria Froc.IA.

Referencias de implementacao: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow e https://vercel.com/docs/rest-api/aliases/get-an-alias e https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url .
