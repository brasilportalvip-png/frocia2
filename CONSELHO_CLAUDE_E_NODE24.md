# Froc.IA — revisão de continuidade, conselho da Claude e Node.js 24

Revisão do histórico disponível em 26/10/2026. Base: PR #103, commit 139c95de900581e634029b736c682dfe5341fa3d. O histórico visível foi cruzado com a base de continuidade aceita em 24/10, a auditoria dos 20 agentes de 22/10 e a revisão de código de 25/10. Isso não constitui acesso garantido a mensagens que não foram preservadas ou disponibilizadas.

## O que Flavio pediu para preservar

- Evoluir incrementalmente, mantendo memória, histórico, credenciais, os 85 perfis e as funções existentes.
- Manutenção automática quando autorizada, sem pedir outro comando depois de cada merge.
- Um controle Ligar/Desligar para decidir quando autorizar o consumo diário. Esse controle foi publicado no PR #103 e permanece preservado.
- Distinguir tarefa registrada, execução, geração, testes, preview, merge e publicação confirmada.
- Não iniciar rodadas pagas repetidas apenas para investigar o estado de uma rodada anterior.

## O conselho da Claude e a evidência encontrada

| Etapa do histórico | O que ficou registrado |
| --- | --- |
| 22/10 — auditoria dos 20 agentes | Catálogo confirmado; dois runs verdes sem comprovar trabalho dos 20 papéis. |
| 24/10 — base aceita | Preservar a versão ecd390d, memória e continuidade; PR #85 ainda aberto, com CI explícito aprovado e produção não confirmada. |
| 24/10 — expansão para 85 perfis | Foram acrescentados 15 perfis de inteligência e 50 de criação aos 20 anteriores; não são 85 modelos independentes. |
| 25/10 — gerador e PR #96 | Geração voltou a responder, mas o PR tinha árvore idêntica à base. A revisão encontrou seis falhas nas ligações entre pedido, patch, CI e publicação. |
| PR #97 | Pacote integrado para patches efetivos, arquivos novos, CI, retomada, risco e correlação do pedido. |
| PR #99 | Retomada automática após CI/deployment; resultado ainda dependia da execução real. |
| PR #100 | Comitê por tarefa e exclusão auditável da fila. |
| Run #66 e PR #101 | A fila não encaminhou o achado para uma tarefa executável; foram corrigidos encaminhamento, evidências ao gerador, revisão de baixo risco e devolução de pareceres para reparo. |
| Runs #72 e #74 | #72 ficou presa antes do worker e foi cancelada; #74 terminou verde sem entrega correspondente para retomar. |
| Run #75 e PR #102 | Houve geração real, certificação, CI e preview; o PR não entrou em produção na última conferência. |
| PR #103 | Controle Ligar/Desligar publicado e testado por Flavio; a leitura posterior mostrava o workflow ativo, coerente com o teste encerrado em Ligado. |
| Revisão de 26/10 | Foram reaproveitados logs e testes locais; três problemas da proposta #102 foram reproduzidos sem nova chamada paga. |

1. **Usar GitHub App ou token próprio para criar o PR.** A orientação é pertinente. Nos logs das rodadas #75, #83 e #85, GITHUB_TOKEN estava presente, SELF_EVOLUTION_CI_DISPATCH_REQUIRED era true e GITHUB_APP_TOKEN, GITHUB_APP_ID e GITHUB_APP_PRIVATE_KEY estavam vazios. O executor estava no fallback do token padrão do Actions. O App da Vercel não é automaticamente herdado pelo GitHub Actions. Não foram lidos nem copiados valores de segredos nesta análise.
2. **Permitir que Actions crie/aprove PRs.** A configuração diz respeito ao token padrão. Ela não substitui a seleção da credencial e não comprova o resultado das operações reais.
3. **Merge automático depois do CI.** O objetivo é válido. A Froc.IA já implementa merge pela API com conferência do SHA depois das verificações; esse caminho não exige o comando gh pr merge --auto. Não foi confirmado que a opção nativa Allow auto-merge esteja habilitada no repositório.
4. **Deploy após merge na main.** Houve confirmação de publicação dos PRs manuais, inclusive o controle do PR #103. Um deployment da branch de um PR não equivale à publicação em produção.
5. **Exit 0 sem tarefa para retomar.** É o comportamento adequado para uma retomada sem entrega correspondente, e foi observado nas rodadas #74, #83 e #85. A #66 também tinha um achado de auditoria pendente e nenhuma tarefa executável; apenas trocar o exit não produziria um reparo.
6. **R2/R3 e autonomia.** O fluxo principal permite publicação autônoma quando habilitada e as verificações passam. A revisão de baixo risco foi simplificada no PR #101. Alterar somente a documentação não modifica as regras executadas. Esta atualização não acrescenta uma nova aprovação humana.

Eu deveria ter separado a disponibilidade do App na Vercel da credencial efetivamente usada no executor antes de tratar a parte do token como resolvida.

## Configuração que ainda depende do ambiente do proprietário

Reutilizar o GitHub App existente na configuração de Actions:

- Variável ou secret FROC_GITHUB_APP_ID: ID do App existente.
- Secret FROC_GITHUB_APP_PRIVATE_KEY: a mesma chave privada já autorizada para esse App, inserida pelo proprietário no painel protegido do GitHub.
- FROC_GITHUB_APP_SLUG é opcional para identificação.
- Alternativamente, SELF_EVOLUTION_GITHUB_TOKEN aceita um token próprio adequado ao repositório.

O App precisa de Actions, Contents e Pull requests com escrita. Alterar arquivos de workflow exige a permissão específica de Workflows. Esta atualização não muda permissões, não cria chaves e não transfere segredos da Vercel. Não cole chaves no chat. Um token de instalação temporário sozinho expira; a combinação App ID/chave permite gerar tokens temporários a cada execução.

Depois da configuração, o diagnóstico do executor deve informar github_app ou a credencial própria escolhida, sem expor valores. A próxima manutenção real ainda precisa confirmar criação de PR, CI, revisão, merge e produção.

## Node.js 24

- Checkout, setup-node e upload-artifact foram atualizados para versões oficiais com runtime node24 e fixados por SHA.
- Os sete workflows usam Node.js 24.22.1. A aplicação e o worker declaram 24.x; .nvmrc e .node-version indicam a versão validada.
- O worker Docker usa node:24.22.1-bookworm-slim. O template de novos projetos também declara Node 24.
- O build verifica o runtime para não aceitar silenciosamente um Node de outra linha.
- O aviso de actions/checkout@v4 apontava ao runtime da ação, que é diferente do Node instalado pelo setup-node para a aplicação.
- O limite da checagem de conexão e o controle de gastos publicado são preservados.

## Estado real dos agentes na última conferência

A rodada #75 usou gemini-3.8-flash e gerou o PR #102 com três arquivos alterados. Certificação, CI explícito e nove suítes passaram. A Vercel informou Preview Ready. O PR continuava aberto, sem merge. Os runs #83 e #85 apenas procuraram uma entrega correspondente ao evento e não executaram outro reparo.

A revisão adicional do PR #102 reproduziu três falhas: a proposta suprime H1_COUNT, THIN_CONTENT e IMAGE_ALT_MISSING em uma página HTML estática com apenas um script de analytics. A versão publicada preserva esses achados. Foi acrescentado um teste de regressão para não perder essa verificação em propostas futuras; o código problemático do PR #102 não faz parte desta atualização.

O catálogo de 85 perfis não prova 85 modelos independentes ou 85 homologações em produção. Os testes locais dos fluxos usam provedores controlados. Os testes de navegador locais ficaram limitados pelo download inválido do Chromium, e o novo container Docker não foi construído neste ambiente sem Docker. Essas etapas devem ser confirmadas pelo CI; não foram apresentadas como testes pagos ou publicação real.

## Fontes da revisão

- Base de continuidade aceita em 24/10/2026 e relatórios preservados pelo usuário.
- PRs #101, #102 e #103 e logs das rodadas citadas.
- https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
- https://docs.github.com/en/actions/concepts/security/github_token
- https://docs.github.com/en/rest/actions/workflows
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request
- https://nodejs.org/en/blog/release/v24.22.1/
- https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
