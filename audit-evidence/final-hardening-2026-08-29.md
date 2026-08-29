# Evidência — hardening final, continuidade de modelos e governança — 2026-08-29

## Base confirmada

- Base da branch: `0532b63`, merge do PR #11 na `main`.
- Produção antes desta fase: `GET /api/live` respondeu `status=live` e `GET /api/ready` respondeu `status=ready`.
- Commit técnico desta fase: `1ddb802`.
- Branch: `fix/prompt-master-final-hardening-20260828`.

O smoke test inicial confirma somente a saúde da versão já publicada. O código desta fase ainda precisa passar pelo preview, pelos checks do PR e por novo smoke test antes do merge.

## Escopo entregue

- cadeia global configurável `3.7 -> 3.6 -> 3.5 -> 3.5-lite`, deduplicada e usada pelo chat, pesquisa agêntica e fábrica de sites;
- troca imediata de modelo após erro explícito, preservando retry interno somente na última alternativa;
- circuit breaker por modelo após falhas consecutivas, cooldown de 60 segundos e chamada de prova para recuperação;
- telemetria do modelo que realmente respondeu, modelos tentados e uso de fallback;
- readiness com a cadeia configurada e conectores sociais realmente configurados, sem confundir configuração com homologação;
- correção da definição duplicada de modelos quando funções diferentes apontam para o mesmo ID;
- remoção de `child_process` e `execSync` das avaliações acessadas por rota HTTP; a rota GET agora apenas lê resultados persistidos;
- merge automático somente quando habilitado, depois da aprovação, no PR esperado e no SHA exato aprovado;
- rollback real pelo `revertPullRequest` oficial do GitHub, criando um PR de reversão e declarando sucesso somente depois do merge confirmado;
- atualização transitiva de `uuid` para `11.1.1`, eliminando as vulnerabilidades conhecidas da árvore de produção.

## Arquivos principais

- `server/ai/geminiFailoverService.ts`
- `server/ai/modelHealthService.ts`
- `server/ai/aiExecutionService.ts`
- `server/ai/researchJobService.ts`
- `server/routes/siteBuilderRoutes.ts`
- `server/routes/healthRoutes.ts`
- `server/selfEvolution/evaluationEngine.ts`
- `server/selfEvolution/githubAutomationService.ts`
- `server/selfEvolution/rollbackService.ts`
- `server/selfEvolution/selfEvolutionOrchestrator.ts`
- `tests/geminiFailoverService.test.ts`
- `tests/finalProductionHardening.test.ts`

## Gates reproduzíveis

```text
npm run typecheck
npm test
npm run build
npm run validate:production-integrity
npm run validate:tracker
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Resultados locais:

- tipagem: aprovada;
- suíte completa: 41 arquivos e 337 testes aprovados;
- build Vite + servidor esbuild: aprovado;
- integridade: 162 arquivos sem catch vazio, mocks, execução dinâmica ou segredos hardcoded;
- auditoria de dependências de produção: 0 vulnerabilidades;
- `uuid`: `11.1.1` em toda a árvore afetada;
- tracker: 563 requisitos e 563 IDs únicos;
- whitespace/diff: aprovado.

## Contrato de rollback e release

A documentação oficial do GitHub confirma que `revertPullRequest` cria um novo Pull Request que desfaz um PR mergeado. O runtime:

1. consulta o PR original e exige `node_id`, `merge_commit_sha` e `merged_at`;
2. cria o PR de reversão pela API GraphQL oficial;
3. quando deploy autônomo está desativado, retorna `revert_pr_created` e aguarda aprovação humana;
4. quando está habilitado, tenta o merge com o SHA exato do PR de reversão;
5. somente retorna `success=true` se o GitHub confirmar `merged=true`.

Referência: https://docs.github.com/en/graphql/reference/pulls#revertpullrequest

## Estado honesto e risco residual

Estado correto: **implementado e testado localmente, ainda não verificado independentemente nem no preview desta branch**.

- O fallback foi provado por testes com falha simulada; teste ao vivo desligando modelos reais exigiria chamadas pagas/controladas e pode variar por conta.
- O rollback foi provado por contrato e mocks adversariais; não foi disparado contra produção para evitar uma reversão destrutiva sem incidente real.
- X, Instagram, Facebook, TikTok, Reddit e LinkedIn continuam limitados pelas credenciais, planos, aprovação e escopos oficiais de cada plataforma.
- Conteúdo privado, fechado, removido, protegido por login, CAPTCHA, paywall ou bloqueio técnico não é contornado.
- Não há revisor independente registrado; portanto nenhum requisito desta fase deve ser marcado `VERIFIED`.
- A execução ao vivo completa do benchmark de 100 casos e a homologação humana continuam pendentes.
