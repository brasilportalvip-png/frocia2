# Registro de Erros Conhecidos e Riscos Mapeados

## 1. Pendências Externas (Bloqueadas por Configuração do Usuário)

- **Mercado Pago Webhook Secret:** O recebimento em tempo real de notificações IPN de pagamento em produção exige o preenchimento de `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET` nas variáveis de ambiente no menu de configurações da plataforma.
- **Integração com GitHub OAuth Client ID:** Requer a inserção do `GITHUB_CLIENT_ID` e `GITHUB_CLIENT_SECRET` para chamadas reais de Push para repositórios do usuário fora da sandbox.

## 2. Limitações de Execução em Sandbox (iFrame)

- **Comandos de Terminal Interativo Longos:** No modo iframe do AI Studio, o atalho de execução direta de `cd` deve ser substituído por caminhos relativos ao diretório raiz da aplicação, já assegurado pelos scripts padrão em `package.json`.

## 3. Estado Atual para Liberação

- **Resultado do Diagnóstico:** **PRONTO PARA TESTES E HOMOLOGAÇÃO COMPLETA**
