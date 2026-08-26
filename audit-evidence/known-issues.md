# Erros conhecidos e riscos mapeados

Fonte de estado: `prompt-master-tracker.jsonl`.

## Bloqueadores atuais

- Auditoria independente ainda não concluída; nenhum requisito está `VERIFIED`.
- Smoke test da produção após o merge ainda não foi registrado no repositório.
- Testes E2E completos, acessibilidade, regressão visual, carga e recuperação de falhas permanecem abertos.
- Backups, alertas, tracing e runbooks não possuem evidência operacional completa.
- Integrações que dependem de contas externas exigem credenciais, escopos e homologação nos respectivos provedores.
- O runtime seguro de ferramentas está implementado, mas os handlers existentes de publicação, pagamento e outras mutações ainda precisam ser migrados para ele.
- O ledger distribuído de idempotência/rate limit compila com Firestore, porém ainda não possui teste de concorrência no Firestore Emulator.

## Dependências

`npm audit --omit=dev --audit-level=high` encerra com exit 0, sem vulnerabilidade alta ou crítica, mas ainda informa 6 vulnerabilidades moderadas transitivas relacionadas a `uuid` na árvore do Firebase Admin.

Não execute `npm audit fix --force` sem analisar a alteração incompatível sugerida para o Firebase Admin.

## Estado de liberação

O commit atual pode seguir para preview e validação do bloco implementado. A plataforma completa não deve ser declarada pronta enquanto houver gates obrigatórios abertos.
