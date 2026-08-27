# Evidência — fábrica de sites e observabilidade operacional

Data: 2026-08-27  
Base: `origin/main` em `d80c5e6c3b6792a99e9cec3195f789575055d56b`  
Branch: `feat/prompt-master-site-factory-observability-20260827`  
Commit de implementação: `ef03e92`

## Escopo implementado

### Especificação e arquiteturas

- Especificação de engenharia estrita e versionada para objetivo, público, tipo de produto, páginas, funcionalidades, identidade visual, conteúdo, autenticação, papéis, dados, pagamentos, administração, integrações, domínio, hospedagem, SEO, acessibilidade, privacidade, métricas e critérios de aceitação.
- Hash SHA-256 determinístico de cada versão.
- Change requests append-only com versão-base, controle de concorrência otimista, idempotência e bloqueio de prototype pollution.
- Aprovação explícita antes de usar a especificação na geração por IA.
- Catálogo oficial compatível com landing page, institucional, blog, loja, portal autenticado, SaaS multiempresa, painel administrativo, agendamento, pagamentos e aplicação com IA.
- Rejeição fail-closed de arquitetura incompatível.
- Claims quantitativos ou absolutos exigem fonte ou evidência; conteúdo inventado não entra como claim aprovado.

### Gates de entrega

- Plano de qualidade obrigatório derivado da arquitetura e dos critérios de aceitação.
- Estados explícitos: `pending`, `passed`, `failed` e `external_blocker`.
- Gate aprovado exige evidência com digest SHA-256, ambiente, instante e origem.
- Gates de segurança, acessibilidade, regressão visual, produção, smoke e rollback exigem revisor autenticado diferente do implementador.
- Readiness permanece `blocked` enquanto qualquer gate estiver pendente, falhar ou possuir bloqueio externo.
- Geração pela rota existente continua compatível; quando `projectId` e `specificationVersion` são enviados, a versão atual precisa estar aprovada e sua arquitetura vira fonte de verdade do prompt.

### Observabilidade e resiliência

- Middleware HTTP registra duração, erro, recurso e correlation ID em eventos reais.
- Execuções de IA registram modelo, tokens, créditos, tentativa, latência, usuário, tenant, projeto e trace.
- Ferramentas registram tentativas, créditos, duração, status e trace.
- Snapshot operacional calcula latência P50/P95, erros, disponibilidade, tokens, créditos, chamadas de ferramentas, retry, jobs presos, qualidade, precisão de memória, falhas de deployment e cache.
- Métrica não observada retorna `status: absent` e `value: null`; não retorna zero falso.
- Custos observados são agregados por tenant, usuário e recurso. Créditos reais aparecem separados de custo monetário; custo monetário não é inventado quando o provedor não o informa.
- Alertas são criados somente a partir de limite realmente excedido.
- Quotas, budgets, circuit breaker, backoff exponencial limitado e cache com tenant/user/resource e TTL foram implementados como controles reutilizáveis com repositório Firestore para produção.
- Painel administrativo ganhou modal responsivo de observabilidade; ausência de dados aparece como “Sem dados”.
- Quatro runbooks foram adicionados para taxa de erro, latência, jobs presos e falha de deployment.

## Testes adicionados

Arquivo `tests/siteFactoryPipeline.test.ts`:

- contrato de discovery completo;
- páginas e critérios duplicados;
- pagamento sem provedor/sandbox;
- claim quantitativo sem fonte;
- catálogo e incompatibilidade de arquitetura;
- versão, hash, histórico, concorrência e idempotência;
- prototype pollution;
- aprovação de especificação;
- readiness fail-closed;
- digest de evidência;
- revisão independente autenticada;
- bloqueio externo explícito.

Arquivo `tests/operationalObservability.test.ts`:

- métricas ausentes como `null`;
- P50/P95, erros e disponibilidade;
- tokens, créditos, ferramentas e retries;
- isolamento por tenant;
- qualidade e recuperação de memória;
- alertas baseados em amostras;
- correlation ID obrigatório;
- quotas e budgets;
- circuit breaker e half-open;
- backoff limitado;
- cache isolado e bloqueio de dados sensíveis.

## Comandos e resultados locais reais

| Gate | Resultado |
|---|---|
| `npm run typecheck` | aprovado |
| `npm run test:site-factory` | 2 arquivos, 34 testes aprovados |
| `npm test` | 28 arquivos, 244 testes aprovados |
| `npm run build` | aprovado; 1.735 módulos Vite e bundle `dist/server.js` |
| `git diff --check` | aprovado |
| `npm audit --omit=dev --audit-level=high` | sem vulnerabilidade alta/crítica; 6 moderadas transitivas em `uuid` via `firebase-admin` |
| `npm run validate:tracker` | aprovado: 563 requisitos e 563 IDs únicos |

O script do tracker usa `node --import tsx`, evitando dependência de um socket IPC do executável `tsx` e mantendo o mesmo validador TypeScript no Windows e no CI Ubuntu.

## Limites e riscos residuais

- O catálogo define stacks e gates oficiais, mas ainda não existe uma implementação homologada completa de cada um dos dez tipos de produto.
- Os fluxos obrigatórios de navegador, acessibilidade, regressão visual, carga, pagamentos sandbox, domínio e rollback continuam bloqueando readiness até receberem evidência real.
- Os controles de quota/budget/circuit estão implementados e testados como serviço, mas ainda precisam ser conectados a todos os recursos externos da plataforma.
- Jobs, memória, qualidade e deployment têm contratos de telemetria; nem todos os produtores de eventos estão conectados, portanto essas métricas podem aparecer honestamente como ausentes.
- O painel não substitui um provedor externo de APM nem uma validação operacional independente.
- Não houve preview, smoke test ou produção deste commit neste ambiente.
- Não houve revisão independente. Todos os requisitos deste bloco permanecem no máximo `FIXED_NOT_VERIFIED` ou `IN_PROGRESS`; `VERIFIED` continua zero.
