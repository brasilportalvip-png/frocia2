# Autoevolução Froc.IA — implementação e critérios de aceitação

Atualizado em 25/10/2026. Este documento descreve o código; não certifica por si só uma execução nem a publicação no domínio.

## Fluxo

1. O executor consulta o repositório e audita o site. Uma ocorrência observada leva evidência concreta à fila.
2. Trabalho ativo é reutilizado. Uma tarefa antiga encerrada não impede investigação nova quando existe pedido manual ou versão nova. O registro anterior é preservado.
3. O agente recebe resumo, erro observado, referências e pareceres. O worker usa esses dados na seleção de arquivos e na chamada do modelo.
4. O patch precisa conter alteração real e passar pela certificação isolada. São exigidos branch, PR, CI oficial, comparação de capacidades e navegador no preview.
5. O comitê recebe diff e resultados de CI, capacidades e navegador vinculados ao mesmo SHA e preview.
6. Solicitações de mudança dos revisores obrigatórios voltam ao agente, com até duas correções por tarefa/dia. PR e commit anteriores ficam no histórico; cada tentativa exige nova certificação e novo CI.
7. A publicação automática pode prosseguir quando a configuração permite e as verificações exigidas passam. Após o merge, o executor confirma deployment e testes do domínio. Falha de produção pode solicitar reversão.

## Revisão por risco

| Risco | Revisores obrigatórios | Outros pareceres |
|---|---|---|
| R0/R1 | Segurança, QA e Verificador Independente | Consultivos; sugestões não impedem a liberação |
| R2/R3 | Todos os dez papéis | Revisão completa; produção automática depende da configuração explícita |

Veto explícito, evidência obrigatória ausente, SHA diferente ou identidade duplicada impede aprovação. Uma solicitação de mudança pode iniciar correção de código e testes; não é convertida em aprovação. Sem modo autônomo habilitado, R2/R3 continuam exigindo aprovação humana.

O caminho de código gerado passa por branch, PR e verificações. Os 85 perfis e os controles do proprietário são preservados.

## Fila

Excluir retira uma tarefa da fila, mantendo auditoria e pareceres. O agendamento não reativa uma exclusão na mesma versão. Um novo pedido manual autoriza investigação nova de um defeito que continua presente.

O identificador inclui ocorrência, commit e geração da auditoria. Uma assinatura reutiliza trabalho ativo e impede duplicação. O orçamento é verificado e reservado antes da geração; registrar tarefa não cobra um patch.

Uma fila sem trabalho e sem falhas encerra normalmente. Falha persistente sem execução possível informa identificador, estado e motivo, sem registrar reparo ou publicação inexistentes.

## GitHub e Vercel

O workflow aceita token próprio ou GitHub App. Com GITHUB_TOKEN padrão, solicita os workflows oficiais via workflow_dispatch. Uma PR com action_required não substitui a consulta aos resultados oficiais do SHA.

Auto-merge nativo exige checks e revisões. O orquestrador também possui merge via API após as verificações. A Vercel publica a main conforme a integração configurada; a confirmação do domínio é separada.

As configurações efetivas estão em .github/workflows/self-evolution-runner.yml, selfEvolutionPolicyEngine.ts e nos serviços de integração. Chat na Vercel e executor Actions são ambientes distintos.

## Verificação

Comandos: npm run typecheck, npm test, npm run build, npm run validate:production-integrity e node scripts/validate-serverless-runtime.mjs.

Os testes incluem fila após a falha #66, transmissão de evidência ao worker/modelo, pareceres, correção certificada, CI, merge, produção e reversão, com serviços externos simulados. A aceitação definitiva exige uma manutenção real concluída na versão publicada. A referência de fluxo do Claude não instala nem ativa o provedor Claude; o provedor atual permanece configurado.
