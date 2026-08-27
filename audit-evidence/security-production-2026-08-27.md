# Evidência — segurança, avaliações e gates de produção

## Escopo

Commit de implementação: `df96baa87d840ad144cd1c262db8f06434a63cfd`.

Este bloco adicionou validação estrutural de payload, bloqueio de mutações cross-site, política JSON, CSP sem framing externo, detecção persistente de abuso, incidentes com transições controladas, rate-limit auditável, revogação Firebase fail-closed, secret scanning, 20 gates de release e um catálogo versionado com 17 avaliações contínuas.

O endpoint `/api/ready` deixou de chamar configuração de “homologação”: ele diferencia leitura real do Firestore de simples presença de credenciais de Gemini e Mercado Pago.

## Comandos executados

```text
npm run validate:production-integrity
Integridade de produção válida: 150 arquivos sem catch vazio, mocks, execução dinâmica ou segredos hardcoded.

npm run typecheck
tsc --noEmit — aprovado.

npm run test:security-release
3 arquivos, 34 testes — aprovados.

npm test
29 arquivos, 263 testes — aprovados.

npm run build
Vite: 1735 módulos transformados; bundle do servidor: 675.5 kB — aprovado.
```

## Casos adversariais novos

- Prototype pollution em qualquer profundidade.
- Payload excessivamente profundo.
- Mutação cross-site.
- Corpo mutável sem `application/json`.
- Vazamento de token em evento de segurança.
- Repetição de ataque agrupada em um incidente.
- Incidente não pode ser resolvido sem causa e contenção.
- Evidência de release pertencente a outro commit.
- Staging sem dependências locais.
- Implementador tentando aprovar sua própria segurança.
- Backup externo ausente permanecendo bloqueador.
- Avaliações ausentes ou sem revisor independente.
- Timestamp de homologação não é fabricado a partir de configuração.

## Limites e bloqueadores

- Não houve E2E autenticado no navegador nesta execução local.
- O staging e o deployment deste commit ainda não existem antes do PR.
- O backup atual é portátil e manual; backup automático gerenciado continua ausente.
- Gemini e Mercado Pago não foram acionados por esta fase; chaves configuradas não são recibos de operação.
- Nenhum requisito recebeu `VERIFIED`: falta identidade revisora independente.
- A suíte contínua possui catálogo e gate fail-closed, mas os 17 resultados reais ainda precisam ser executados e anexados por ambiente.

Esses itens permanecem `IN_PROGRESS` ou `EXTERNAL_BLOCKER`; não são tratados como sucesso.
