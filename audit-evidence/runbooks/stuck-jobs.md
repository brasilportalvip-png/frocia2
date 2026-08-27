# Runbook: jobs presos

## Gatilho

Alerta `stuck_jobs` quando ao menos um evento real de job possui estado `stuck`.

## Resposta

1. Consulte o histórico de transições, lease, fencing token e outbox do job.
2. Não repita automaticamente uma ação mutável com resultado externo incerto.
3. Reconcilie primeiro com o provedor e compare o recibo/idempotency key.
4. Reassuma o lease apenas após expiração e com novo fencing token.
5. Compense ou retome do último estado confirmado; preserve o histórico append-only.

## Encerramento

Registre resultado da reconciliação, transição final, eventos entregues e qualquer ação humana necessária.
