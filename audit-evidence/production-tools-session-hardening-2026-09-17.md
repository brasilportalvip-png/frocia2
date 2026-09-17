# Ferramentas reais, sessão e probes — 17/09/2026

## Escopo

- Transformar a calculadora registrada em executor determinístico real.
- Disponibilizar execução autenticada pelo runtime seguro de ferramentas.
- Integrar o resultado determinístico ao fluxo de conversa quando houver expressão explícita.
- Renovar uma vez o token Firebase depois de `401`, sem loop de repetição.
- Impedir cache compartilhado dos endpoints operacionais de saúde.
- Fornecer instalação reproduzível no Windows por CMD.

## Controles implementados

- Parser matemático próprio, sem `eval`, `Function`, subprocesso ou execução dinâmica.
- Limites de entrada e resultado, precedência, parênteses, potência, módulo e divisão por zero.
- Endpoint `POST /api/tools/execute` protegido por Firebase Authentication.
- Escopo de usuário, rate limit, timeout, validação de entrada/saída e receipt determinístico pelo runtime existente.
- Somente `execute_calculator` é permitido pelo endpoint nesta fase.
- Repetição de requisição após `401` limitada a uma tentativa com token forçadamente renovado.
- `Cache-Control: no-store`, `Pragma: no-cache` e `Expires: 0` nos probes.
- Instalador fail-closed: para imediatamente se instalação, tipagem, testes, tracker, migrations, integridade, auditoria ou build falhar.

## Evidências locais reproduzíveis

```text
npm run typecheck: exit 0
npm test: 53 arquivos e 410 testes aprovados
npm run build: exit 0
npm run validate:production-integrity: 171 arquivos aprovados
git diff --check: exit 0
```

## Limites honestos

- A revisão independente continua ausente; requisitos alterados permanecem `FIXED_NOT_VERIFIED`.
- O teste de deploy deve ser executado novamente no preview e em produção após o merge.
- Uma execução de `npm audit` foi bloqueada pelo allowlist de rede do ambiente de auditoria; a execução imediatamente anterior desta mesma sessão retornou zero vulnerabilidades.
