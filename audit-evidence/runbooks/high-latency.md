# Runbook: latência elevada

## Gatilho

Alerta `high_latency` quando o P95 HTTP observado excede 2.000 ms. Ausência de amostras permanece `absent` e não dispara alerta.

## Resposta

1. Localize as rotas lentas pela dimensão `resource` e seus `correlationId`.
2. Separe tempo de aplicação, banco, IA e provedor externo.
3. Verifique saturação, queries sem índice, retries e circuit breakers.
4. Preserve timeouts e limites; não aumente o tempo indefinidamente para esconder a falha.
5. Valide a correção com carga controlada e compare P50/P95 na mesma janela.

## Encerramento

Anexe o relatório de carga, a mudança aplicada e a nova amostra. Mantenha o risco residual quando a origem for externa.
