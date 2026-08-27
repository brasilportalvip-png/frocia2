# Runbook: taxa de erro elevada

## Gatilho

Alerta `high_error_rate` quando a taxa observada de respostas HTTP com erro excede 5% na janela consultada. O alerta não é criado quando a métrica está ausente.

## Resposta

1. Use o `correlationId` para localizar o evento e o trace correspondente.
2. Separe erros 4xx esperados de falhas 5xx e identifique a rota afetada.
3. Verifique os logs da implantação e a saúde das integrações usadas pela rota.
4. Interrompa novas mutações se houver risco de duplicidade ou corrupção.
5. Corrija em branch separada, execute os gates e publique primeiro em preview.
6. Acione rollback quando a falha tiver começado após uma release e o reparo seguro não for imediato.

## Encerramento

Registre a janela, a causa, o commit corretivo ou rollback, o smoke test e a evidência de normalização. Não encerre com base apenas no desaparecimento visual do alerta.
