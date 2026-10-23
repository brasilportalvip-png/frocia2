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
- Uma resposta HTTP 422 do worker conserva um diagnostico assinado, com etapa, erro e trecho final da saida do comando, quando houver. O runner verifica assinatura, candidato, nonce e horario antes de registrar esse texto. Segredos conhecidos sao removidos. O estado legado tests_failed tambem pode indicar falha anterior aos testes; a etapa determina o que realmente ocorreu.
- Uma tarefa tests_failed anterior ao PR pode voltar ao estado detected, preservando o mesmo documento e suas evidencias. Ha uma retomada automatica por versao/dia e ate tres retomadas por versao no dia de Brasilia, incluindo pedidos manuais. Codigo corrigido nao herda o bloqueio da versao antiga. A transacao confere novamente o estado; orcamento global, lock, testes, CI e revisao continuam no caminho normal. Um defeito ainda pendente nao encerra o ciclo como concluido.
- A selecao de tarefas considera todos os estados retomaveis, incluindo a verificacao depois do merge; nao fica limitada aos cem documentos mais recentes.
- O modo desta esteira permite manutencao do codigo do repositorio, inclusive agentes/worker/workflows, com SELF_EVOLUTION_FULL_REPOSITORY_ACCESS=true. Isso nao dispensa sandbox, testes, CI, preview ou revisao independente. Segredos permanecem fora dos arquivos gerados.
- A publicacao automatica fica habilitada por padrao no workflow, conforme o pedido do proprietario. A variable AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED=false conserva uma parada explicita da publicacao. A parada global persistente tambem e respeitada.
- O token proprio ou GitHub App tem prioridade. Sem esses tokens, o executor usa GITHUB_TOKEN com Contents/Pull requests/Actions e solicita o CI oficial por workflow_dispatch; assim nao depende do evento pull_request disparado pelo proprio token. O repositorio precisa permitir que Actions crie PRs.
- O ci.yml passa a aceitar workflow_dispatch. Um pedido de CI e persistido como ci_pending e nao regenera nem cobra outro patch nas retomadas.
- Antes de trabalho pago, a esteira verifica leitura autenticada e escrita de um objeto Git vazio, sem alterar arquivos, branches ou PRs. O campo metadata.permissions.push nao decide a capacidade do GITHUB_TOKEN. Branch, PR e merge ainda precisam ser comprovados nas operacoes reais. O acesso a API da Vercel e verificado separadamente; uma versao atualmente quebrada do site nao impede iniciar seu reparo.
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
| Variable opcional | BROWSER_TEST_LOGIN_URL | URL de login; padrao e SELF_EVOLUTION_TARGET_URL |
| Secrets opcionais | BROWSER_TEST_USER, BROWSER_TEST_PASSWORD | Conta existente; configurar os dois juntos para substituir a conta automatica |
| Variable opcional | BROWSER_TEST_AUTO_PROVISION_ENABLED | true por padrao; false pausa a criacao e rotacao automaticas |
| Variables opcionais | BROWSER_LOGIN_OPEN_SELECTOR, BROWSER_USER_SELECTOR, BROWSER_PASSWORD_SELECTOR, BROWSER_SUBMIT_SELECTOR, BROWSER_AUTHENTICATED_SELECTOR | Ajustar abertura do modal, login e confirmacao da sessao |

Para comandos administrativos na conversa do site, o backend da Vercel precisa do Firebase Admin e da integracao GitHub/App que possa solicitar Actions. O papel administrativo e verificado pelo servidor. O executor externo confirma sua propria habilitacao e acessos quando recebe o pedido.

Sem conta de teste ou com recurso externo indisponivel, a homologacao correspondente continua pendente. O sistema nao deve declarar essas areas saudaveis.

### Conta automatica das areas com login

Antes de iniciar o worker, o Actions usa o Firebase Admin ja configurado para preparar o UID frocia-maintenance-browser-test. A conta e exclusiva da auditoria, com role user, sem privilegios administrativos, sem creditos concedidos e sem afirmar verificacao de e-mail. O perfil normal e carregado pelo mesmo login e API usados pelos clientes.

A senha e aleatoria e rotacionada em cada rodada, com revogacao das sessoes anteriores. Senha e usuario sao mascarados antes de seguir pelo ambiente privado do job; o registro persistente contem modo, UID e data, sem a senha. O worker recebe apenas as credenciais dessa conta, sem a chave administrativa do Firebase.

Uma conta existente sem a marca exclusiva da auditoria, desativada, administrativa ou vinculada a outro tenant nao tem a senha redefinida. A parada persistente do sistema tambem e respeitada. O servico precisa de permissao Firebase Authentication Admin; uma recusa mantem o login como pendente e preserva a auditoria publica.

No modo automatico, o login usa o dominio do destino de preview validado pelo backend. O formulario so e considerado autenticado quando o menu do perfil aparece; fechar a janela sozinho nao basta. Credenciais de conta ja configurada preservam sua URL e seletores.

Essa conta verifica a experiencia de usuario comum. Operacoes administrativas, pagamentos e a expiracao real de JWTs exigem seus proprios cenarios e evidencias; a preparacao de uma conta nao comprova todos esses fluxos.

### Acesso da Vercel no Actions

A conexao GitHub-Vercel publica os pushes da main. O executor dos agentes precisa tambem de VERCEL_TOKEN e VERCEL_PROJECT_ID para consultar previews e comprovar a publicacao. Na rodada 23, ambos chegaram vazios; uma conexao feita em outro ambiente nao os preenche automaticamente.

Cadastre os valores nas secrets do repositorio em https://github.com/brasilportalvip-png/frocia2/settings/secrets/actions . O Project ID fica nas configuracoes do projeto frocia2 da Vercel. Use um token com acesso a esse projeto/equipe. Nenhuma credencial deve ser adicionada ao Git ou enviada em mensagens.

## Revisao integrada depois da rodada 27

A rodada 27, no commit 47dab4033146a5d486e5ae0ebda56ed7f24627e5, passou no preflight real de Git, edicao, teste e rollback como UID 10001 sem capacidades nos filhos. Passou tambem nos acessos de GitHub/Vercel. A chamada seguinte ficou sem resposta de 19:08:02 a 19:13:04 UTC e terminou em fetch failed. O intervalo coincide com os 300 segundos do headersTimeout padrao do cliente fetch/Undici; o log antigo nao conservou o codigo interno da causa.

A revisao corrigiu em conjunto:

- A chamada longa usa node:http/node:https com o AbortSignal do prazo total: 50 minutos no Actions, 15 minutos por padrao fora dele ou o valor configurado entre 1 e 30 minutos. Nao ha o corte implicito de headers aos cinco minutos. TLS, HMAC, nonce, SHA, limites de tamanho e todos os gates permanecem.
- O resultado de transporte conserva codigo de erro e o prazo real. O Actions registra sempre o estado do container, OOMKilled, ExitCode e os logs finais sanitizados; o worker registra etapa e inicio/fim de comandos sem imprimir fontes ou segredos.
- A reserva do candidato dura 65 minutos, cobrindo o job externo de 60 minutos. Um agent_running abandonado so volta a tests_failed depois de poder adquirir uma nova reserva.
- O patch certificado e salvo integralmente, em partes com hash, antes do estado tests_passed. tests_passed/patch_created voltam a fila e podem retomar a criacao do PR sem gerar ou cobrar outro patch. Mudanca da main exige nova certificacao; branch parcial so e reutilizada com a mesma arvore e a mesma base.
- O token do Actions solicita ci.yml e capability-checks.yml por workflow_dispatch. Sem esse segundo disparo, as nove suites exigidas pela comparacao poderiam nunca iniciar.
- O preview confere projeto, ambiente e SHA exato antes do health e do navegador. Um preview antigo da mesma branch fica pendente.
- O controlador recebe KILL para encerrar os processos de teste como UID 10001 e seus descendentes no limite de tempo. O preflight real tambem testa esse encerramento; os filhos continuam sem capacidades efetivas/permitidas/ambientes.
- A retomada contabiliza as tentativas por SHA/dia, mantendo o orcamento global. Uma versao nova pode ser testada mesmo depois de esgotadas as tentativas da versao anterior.

O teste selfEvolutionWholeLifecycle usa um worker HTTP local real e fixtures das APIs/Firestore/modelos para atravessar patch, PR, os dois pedidos de CI, comparacao de capacidades, preview, dez pareceres, merge e confirmacao do dominio. Tambem cobre falha na API do PR sem nova cobranca, assinatura invalida, capacidades ausentes, rollback solicitado e executor interrompido. Essas fixtures testam a ligacao entre etapas; nao equivalem a gerar uma correcao real com Gemini nem a publicar na Vercel.

Os testes de transporte usam um servidor HTTP real com headers atrasados, cancelamento antes/depois dos headers, conexao interrompida, redirect e resposta acima do limite. Checkpoints sao testados com partes ausentes, alteradas e gravacao interrompida. A verificacao no container e a publicacao real dessa revisao ainda dependem da nova execucao no Actions.

Validacao local consolidada: 657 testes em 101 arquivos; 24 testes de navegador aprovados com CI=true e quatro testes do ambiente publicado pendentes; TypeScript, build, actionlint, integridade, tracker e validacao estatica de migrations aprovados; npm audit de producao sem vulnerabilidades. A validacao de migrations nao executou alteracoes na base real.

## Historico: permissoes da sandbox depois da rodada 26

A rodada 26 identificou restore_baseline: spawn git EACCES. O diretorio criado por mkdtemp tem modo 0700 e passa a pertencer ao UID 10001. O controlador root, limitado a CHOWN/SETUID/SETGID, perde acesso ao diretorio; o libuv entra no cwd antes de trocar o UID do filho. A configuracao passa a conceder DAC_OVERRIDE ao controlador do container para permitir essa operacao e a leitura/aplicacao do patch.

Os comandos de codigo continuam no UID/GID 10001. O diff, o inventario posterior aos testes e a verificacao final do Git tambem usam esse usuario, que e o proprietario do checkout. Assim nao dependem de desabilitar a verificacao de propriedade do Git.

Antes do ciclo, sandbox-preflight.mjs cria um repositorio temporario independente e usa o mesmo executor para conferir chown, Git reset/clean, edicao pelo controlador, teste npm e rollback. Ele exige UID/GID 10001, capacidades efetivas/permitidas/ambientes zeradas, NoNewPrivs=1 e ausencia dos segredos nos processos de teste. Se essa verificacao falhar, o Gemini nao e chamado. O checkout real nao e alterado por esse teste.

O teste completo com capabilities depende do Docker do Actions. O ambiente local desta conversa nao possui Docker nem permissao para mudar o UID; seus testes de processo cobrem Git real, ambiente minimo, timeout e a reproducao de EACCES por falta de acesso ao cwd. A nova rodada deve confirmar o teste completo no container antes de tentar o reparo do site.

## Historico: diagnostico e retomada depois da rodada 25

A rodada 25, na main 0526afebed02d32f37e3cd3a7d862ec718f269ff, confirmou a prova de escrita no GitHub e Vercel ready. O worker respondeu HTTP 422, mas o adaptador descartou o corpo da resposta. Esse log nao comprova qual etapa falhou nem que algum teste chegou a ser executado.

O pacote de diagnostico parte dessa main. Extraia o ZIP atualizado em uma pasta nova, fora do clone, e execute ATUALIZAR_WORKER.cmd. Depois inicie uma nova execucao do workflow na main para reconstruir o worker, retomar a tarefa existente e obter sua causa real. Reexecutar uma rodada antiga usa o codigo antigo.

Esta atualizacao corrige o descarte do diagnostico e a exclusao da tarefa da fila retomavel. Ela nao afirma corrigir a causa ainda desconhecida do 422. A publicacao de um reparo do site continua dependendo de uma execucao real com todos os gates aprovados.

## Historico: atualizacao de acessos depois do merge do PR 84

O PR 84 ja foi integrado. O pacote atualizado parte da main f6d873fffc42df97010ccbc9f0e43da0a40eb011 e inclui a prova real de escrita e o provisionamento da conta de teste.

Extraia o ZIP atualizado em uma pasta nova e execute ATUALIZAR_ACESSOS.cmd. O clone padrao e Desktop/frocia2; outra pasta pode ser passada como argumento. O aplicador exige trabalho local salvo, confere o repositorio e o patch, cria o commit e atualiza a main sem force-push. Depois inicie uma nova rodada do workflow na main.

Evidencias locais desta atualizacao: 620 testes em 94 arquivos passaram, assim como TypeScript e validacao do workflow. A suite de navegador com CI=true passou em 24 casos; quatro verificacoes de ambiente publicado ficaram pendentes. Criacao da conta no Firebase, prova de escrita na API do GitHub e login do site publicado ainda dependem de executar esta versao no Actions. Esta conversa continua sem permissao de escrita no GitHub (HTTP 403).

## Historico: instalacao inicial pelo PR 84

1. Extraia a versao nova do ZIP em uma pasta nova.
2. Execute ATUALIZAR_PR84.cmd no computador com o clone usado no primeiro pacote. O padrao e Desktop/frocia2; para outra pasta, arraste-a sobre o CMD.
3. O aplicador confirma o repositorio, exige trabalho local salvo, busca a branch fix/agentes-auditoria-20261023, confere e aplica o patch incremental, cria o commit e atualiza o mesmo PR 84. Nenhum arquivo e descartado e nao ha force-push.
4. Confira a nova execucao do CI no PR 84. Depois de integrar a branch, a esteira nova estara na main. A execucao real e a publicacao precisam ser confirmadas nos resultados da propria esteira.

O aplicador antigo nao deve ser usado para esta atualizacao. Ele criava a branch que agora ja existe.

## Evidencias da entrega inicial do PR 84

- Falha original do PR 84: seis casos E2E expiravam porque as fixtures HTML eram servidas sem UTF-8. O trace registrou InÃ­cio no lugar de Inicio acentuado. Foi corrigido o charset no HTML e nas respostas HTTP.
- 599 testes em 93 arquivos aprovados.
- Navegador Chromium 151: 18 casos aprovados, inclusive com CI=true; quatro casos de ambiente publicado ficaram ignorados porque E2E_BASE_URL nao foi fornecida.
- TypeScript, build, validacoes de tracker/migrations/integridade e actionlint aprovados. A validacao de migrations foi estatica; nao executou uma migracao na base real.
- npm audit --omit=dev --audit-level=moderate: nenhuma vulnerabilidade encontrada.
- O patch de atualizacao parte do commit 0577b727843d6d3d215d5f92692fc33d79459dbb do PR 84, cuja base e e57f4d7c706fa5f9e13d238fc793d6903221f08d.
- A API de gravacao desta conversa retornou HTTP 403 Resource not accessible by integration. Nenhuma destas atualizacoes foi enviada por esta conversa ao PR, mesclada na main ou publicada. Isso nao comprova ausencia de acesso da propria Froc.IA.

Referencias de implementacao: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow e https://vercel.com/docs/rest-api/aliases/get-an-alias e https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url .
