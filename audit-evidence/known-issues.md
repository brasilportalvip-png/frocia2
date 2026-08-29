# Erros conhecidos e riscos mapeados

Fonte de estado: `prompt-master-tracker.jsonl`.

## Bloqueadores atuais

- Auditoria independente ainda não concluída; nenhum requisito está `VERIFIED`.
- A `main` `0532b63` possui smoke test registrado; a branch desta fase ainda precisa de preview e novo smoke test antes do merge.
- Testes E2E completos, acessibilidade, regressão visual, carga e recuperação de falhas permanecem abertos.
- Backups, alertas, tracing e runbooks não possuem evidência operacional completa.
- Integrações que dependem de contas externas exigem credenciais, escopos e homologação nos respectivos provedores.
- O runtime seguro de ferramentas está implementado, mas os handlers existentes de publicação, pagamento e outras mutações ainda precisam ser migrados para ele.
- O ledger distribuído de idempotência/rate limit compila com Firestore, porém ainda não possui teste de concorrência no Firestore Emulator.

## Dependências

Em 29/08/2026, `npm audit --omit=dev --audit-level=moderate` encerra com exit 0 e informa **0 vulnerabilidades**. A versão transitiva de `uuid` foi fixada em `11.1.1` por override, sem rebaixar o Firebase Admin.

Não execute `npm audit fix --force`; novas correções devem continuar sendo analisadas e travadas explicitamente.

## Estado de liberação

O commit atual pode seguir para preview e validação do bloco implementado. A plataforma completa não deve ser declarada pronta enquanto houver gates obrigatórios abertos.
