# Agentes: agendamento, auditoria do proprio site e correcoes

Esta alteracao conecta a auditoria de producao a fila de autoevolucao. Ela nao equivale a uma homologacao completa do site nem comprova que as credenciais de producao estejam autorizadas.

## Comportamento

- Primeira tentativa as 09h17 de Brasilia; recuperacao e retomada a cada 30 minutos ate 20h47. O GitHub pode atrasar ou descartar eventos de agenda; isto adiciona oportunidades de recuperacao, sem prometer pontualidade absoluta.
- A verificacao inicial le somente metadados do Actions. Um workflow verde aguardando CI, preview ou outras tarefas nao encerra as retomadas. A conclusao explicita da rodada evita reconstruir o worker sem necessidade.
- Antes de investigar novidades externas, o executor audita o proprio site: crawler de ate 40 URLs, navegador com sete vistas internas, cenarios de desktop/tablet/celular, acessibilidade, console, rede e sessao.
- Os resultados observados geram ate cinco novas tarefas por auditoria. Erros detectados nao dependem de cinco ocorrencias anteriores na telemetria nem da vontade do modelo de sugerir uma novidade.
- Os dados sao registrados em `self_evolution_site_audits`, ligados a `self_evolution_candidates` e resumidos na trilha de auditoria e no Actions. Um clique manual solicita uma nova auditoria, sem duplicar candidatos ativos.
- Falta de login, tempo esgotado, limites do crawler e cobertura incompleta sao registrados como limitacoes. A auditoria nao prova todos os fluxos de negocio, pagamentos ou respostas possiveis do chat.
- Antes de gerar um patch pago, o executor verifica a leitura autenticada do repositorio e consulta o deployment da Vercel. Uma falha de acesso tem mensagem propria; ela nao vira `no_proposal`.
- Branch, testes, CI, preview, comite, verificacao independente, politica de risco e autorizacao de producao continuam compondo o caminho de publicacao. Ter uma integracao configurada nao comprova que uma correcao foi publicada.
- A importacao do GitHub foi corrigida para ajustar objetos completos ao limite de 700.000 bytes, mantendo JSON valido e declarando a cobertura parcial. O JSON nunca e cortado no meio.

## Configuracao do executor no GitHub

As configuracoes da aplicacao hospedada na Vercel e as do executor do Actions sao ambientes diferentes. Reutilize as credenciais existentes nos campos apropriados do repositorio; o pacote nao contem credenciais.

Escolha UMA forma de autenticar a automacao de escrita:

1. GitHub App instalado no repositorio: secrets `FROC_GITHUB_APP_ID`, `FROC_GITHUB_APP_PRIVATE_KEY` e variable `FROC_GITHUB_APP_SLUG`.
2. Token proprio de automacao: secret `SELF_EVOLUTION_GITHUB_TOKEN`. A alternativa `FROC_GITHUB_APP_TOKEN` aceita um token de instalacao ja emitido, considerando sua expiracao.

O App/token deve ter acesso ao repositorio, Contents e Pull requests com escrita e leitura dos checks/Actions necessarios. A verificacao de leitura nao certifica escrita: a criacao real do PR e a comprovacao dessa etapa. O token padrao `GITHUB_TOKEN` do Actions fica reservado a leituras; PRs criados com ele podem exigir aprovacao para iniciar o CI, impedindo uma esteira totalmente automatica.

O workflow traduz os nomes `FROC_GITHUB_*` para as variaveis `GITHUB_APP_*` esperadas pelo servidor. Nomes de configuracao do GitHub que comecam com `GITHUB_` sao reservados.

Configuracoes adicionais:

| Local | Nome | Finalidade |
| --- | --- | --- |
| Secret | `FIREBASE_SERVICE_ACCOUNT_KEY` | Firestore persistente e fila |
| Secret | `GEMINI_API_KEY` | Modelo dos agentes |
| Secrets | `SELF_EVOLUTION_WORKER_TOKEN`, `SELF_EVOLUTION_WORKER_SIGNING_SECRET` | Autenticacao e assinatura do worker |
| Secrets | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` | Consultar e validar deployments; o project ID tambem pode ser variable |
| Variable | `SELF_EVOLUTION_TARGET_URL` | Site auditado; padrao `https://frocia2.vercel.app/` |
| Variable | `SELF_EVOLUTION_RUNNER_ENABLED` | `false` pausa somente o automatico |
| Variable | `AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED` | `true` permite a publicacao automatica depois dos gates existentes |
| Variable | `BROWSER_TEST_LOGIN_URL` | URL de login da conta de teste |
| Secrets | `BROWSER_TEST_USER`, `BROWSER_TEST_PASSWORD` | Conta de teste para areas autenticadas |
| Variables opcionais | `BROWSER_LOGIN_OPEN_SELECTOR`, `BROWSER_USER_SELECTOR`, `BROWSER_PASSWORD_SELECTOR`, `BROWSER_SUBMIT_SELECTOR`, `BROWSER_AUTHENTICATED_SELECTOR` | Ajustar o fluxo de login e confirmar a sessao |

O login padrao usa email, senha e botao `type=submit`. Se o formulario ficar num modal, configure o seletor que o abre. Prefira um marcador visivel apos o login em `BROWSER_AUTHENTICATED_SELECTOR`. Sem uma sessao de teste valida, a cobertura privada fica explicitamente pendente.

## Aplicacao do pacote no Windows

1. Extraia o ZIP em uma pasta.
2. Execute `APLICAR_CORRECAO.cmd`. Ele usa `%USERPROFILE%\Desktop\frocia2`; para outro caminho, passe-o como primeiro argumento.
3. O aplicador exige uma arvore de trabalho limpa, confirma o repositorio de destino, busca a `main`, cria uma branch, verifica e aplica o patch, cria o commit e envia a branch. Ele nao modifica a `main` nem faz merge.
4. Na pagina que abrir, crie o Pull Request. Aguarde os checks e revise as configuracoes acima antes de integrar a correcao.
5. Execute o workflow uma vez manualmente na nova versao e confira o resumo: cobertura, falhas, candidatos e bloqueios. A rodada automatica real so pode ser confirmada apos um evento `schedule`.

Se qualquer comando falhar, o aplicador para e preserva a branch e as alteracoes. Ele nao faz `reset --hard`, stash, force-push ou descarte de arquivos.

## Evidencias desta preparacao

- Verificacao local: 564 testes em 87 arquivos aprovados; TypeScript, build, integridade de producao e validacao do workflow aprovados.
- Base: `e57f4d7c706fa5f9e13d238fc793d6903221f08d` da `main`.
- O ZIP fornecido contem a versao anterior do diagnostico `model_declined`; a base atual do GitHub ja inclui esse diagnostico. O aplicador parte da `main` atual para evitar regressao.
- Regressao reproduzida antes da correcao: `O resumo seguro do repositorio excedeu o limite permitido` na importacao de arquivos elegiveis que cabiam no limite bruto, mas excediam o JSON final.
- Teste de leitura real de `brasilportalvip-png/frocia2` depois da correcao: JSON valido com 697.456 bytes, 366 caminhos listados e 15 arquivos de conteudo retornados, com cobertura parcial declarada.
- Foram preparados testes de navegador com fixtures para as sete vistas, pagina vazia e falta de login. A execucao local desses testes ficou bloqueada porque o download do Chromium retornou um arquivo invalido; a coleta dos seis casos foi validada. Execute-os no CI antes de considerar a navegacao homologada.
- A integracao desta conversa recusou gravacao no GitHub com HTTP 403. Nenhum PR ou deployment foi criado por esta preparacao. Isso nao demonstra ausencia de acesso da propria Froc.IA.

Documentacao oficial: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule e https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow .
