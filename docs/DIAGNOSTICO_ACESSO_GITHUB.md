# Acesso real do chat da Froc.IA ao GitHub

No chat publicado, entre com a conta administradora e pergunte:
`Voce tem acesso ao GitHub?`

A consulta le o estado do workflow, sem iniciar manutencao. O recibo informa
o repositorio consultado, a origem da credencial e a versao publicada na Vercel,
quando esse SHA estiver disponivel. Para um App, mostra o ID e o slug devolvidos
pelo proprio GitHub, o ID da instalacao e as permissoes do token temporario.
Esses identificadores sao publicos. Tokens e chaves nao aparecem no recibo.

| Resultado observado | Correcao correspondente |
| --- | --- |
| `GITHUB_TOKEN` ou `GITHUB_APP_TOKEN` selecionado | A Vercel usa esse token antes do App. Alterar permissoes do App nao atualiza um token estatico. Verifique a credencial indicada no ambiente Production. Para usar o App, confirme primeiro sua configuracao e remova a variavel estatica que tem prioridade; publique um novo deploy. |
| App/ID diferente daquele que foi alterado no GitHub | Confira `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` e `GITHUB_APP_SLUG` do projeto frocia2 na Vercel. Devem pertencer ao App instalado no repositorio indicado. Publique um novo deploy apos mudar variaveis. |
| `actions=read` ou `actions=none` na instalacao | Solicite Actions com leitura e escrita no App identificado e aceite a atualizacao na mesma instalacao. O backend gera um token temporario novo em cada consulta; nao reutiliza um token antigo em cache. |
| Workflow `disabled_manually` ou outro estado diferente de `active` | Habilite Froc.IA - Autoevolucao Externa no repositorio indicado. |
| HTTP 403 com `Resource not accessible by integration` | Leia a origem da credencial e as permissoes exigidas que o GitHub devolveu. A consulta do workflow comprova leitura; somente o dispatch aceito comprova a solicitacao de inicio. |
| PR recusado com `GitHub Actions is not permitted to create or approve pull requests` | Nas configuracoes Actions do repositorio, habilite a criacao de PRs pelo GitHub Actions. Contents:write e a criacao de blobs nao comprovam essa permissao separada. |
| Limite de requisicoes atingido / `Retry-After` | Respeite o prazo informado. Nem todo HTTP 403 significa falta de permissao. |

Para iniciar a manutencao, envie uma ordem explicita como:
`Corrija os erros do meu site Froc IA e inicie a manutencao agora.`

Uma recusa preserva o pedido na fila com o diagnostico. O recibo diferencia
habilitar a manutencao de conseguir solicitar a execucao. A data junto da
ultima tarefa identifica um registro anterior, sem apresenta-lo como uma nova
tentativa. Apagar execucoes com erro no GitHub nao concede novas permissoes.

Esta atualizacao melhora a identificacao e o tratamento do bloqueio. Ela nao
altera permissoes da conta, nao escolhe outra credencial depois de um 403 e nao
comprova acesso em producao sem uma nova consulta no servidor publicado.
