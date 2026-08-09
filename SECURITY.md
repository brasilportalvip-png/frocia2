# Política de Segurança do Froc.IA

## Relatando Vulnerabilidades

A segurança do Froc.IA é nossa prioridade máxima. Se você encontrar uma vulnerabilidade de segurança, solicitamos que reporte com responsabilidade.

### Como Reportar

Por favor, NÃO abra uma issue pública para relatar vulnerabilidades de segurança. Em vez disso, envie um e-mail para:

**seguranca@froc.ia**

Inclua no seu e-mail:
1. Descrição do problema e impacto potencial.
2. Passos reproduzíveis ou prova de conceito (PoC).
3. Qualquer mitigação temporária sugerida.

### Prazos de Resposta

- **Confirmação de recebimento:** até 24 horas úteis.
- **Avaliação e triagem inicial:** até 72 horas.
- **Correção e publicação:** priorizado com base na gravidade (CVSS v3.1).

## Práticas Recomendadas para Produção

1. Mantenha as variáveis de ambiente sensíveis (`FIREBASE_PRIVATE_KEY`, `MERCADO_PAGO_ACCESS_TOKEN`, `INTERNAL_CRON_SECRET`) configuradas exclusivamente via secret manager do servidor de hospedagem.
2. Nunca efetue commit de arquivos `.env` ou chaves privadas.
3. Certifique-se de que o webhook do Mercado Pago utiliza obrigatoriamente protocolo HTTPS em produção.
