# Runbook: falha de deployment

## Gatilho

Alerta `deployment_failures` quando existe evento real de deployment com status de erro na janela.

## Resposta

1. Confirme o estado no provedor usando o deployment ID; não confie apenas na interface local.
2. Consulte build logs e runtime logs sem copiar segredos para a evidência.
3. Verifique commit, branch, ambiente, variáveis, banco, migrations e integrações.
4. Corrija em branch/preview quando seguro ou execute rollback para a última release comprovada.
5. Repita status, URL pública, smoke test, logs, HTTPS e headers.

## Encerramento

Anexe recibo do provedor, URL testada, resultado do smoke test e referência do rollback ou commit corretivo.
