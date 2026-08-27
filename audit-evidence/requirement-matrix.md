# Matriz de requisitos da Froc.IA

As declarações antigas de “100%”, “publicado e verificado” foram retiradas porque não continham a cadeia de evidências exigida pelo PROMPT MESTRE.

A fonte oficial agora é `prompt-master-tracker.jsonl`. Cada linha contém um único requisito e somente pode receber `VERIFIED` quando o validador confirmar arquivos, testes, comando, resultado, commit, ambiente, evidência e revisor independente.

Execute:

```bash
npm run validate:tracker
```

Enquanto os gates completos não forem executados, requisitos permanecem `OPEN`, `IN_PROGRESS`, `FIXED_NOT_VERIFIED` ou `EXTERNAL_BLOCKER`.

## Estado em 27/08/2026 — implementação `a0aa91f`

| Estado | Quantidade |
|---|---:|
| `OPEN` | 195 |
| `IN_PROGRESS` | 159 |
| `FIXED_NOT_VERIFIED` | 204 |
| `EXTERNAL_BLOCKER` | 5 |
| `VERIFIED` | 0 |
| Total | 563 |

O primeiro bloco implementou classificação, orquestração, roteamento seguro e contratos. O segundo adicionou enforcement no runtime de ferramentas, incluindo escopos, confirmação, timeout, retry seguro, custo, rate limit, redaction, idempotência e verificação de resultado. O terceiro adicionou pesquisa fail-closed com citações seguras e visíveis, além de RAG privado com seleção explícita, revisão ativa, vigência, expiração, deduplicação e reindexação. O quarto adicionou memória privada com consentimento, isolamento por tenant, criptografia de aplicação, retenção, contexto longo controlado e uma máquina durável com idempotência, leases, fencing token, outbox, compensação e reconciliação. O quinto adicionou especificações versionadas, catálogo oficial de arquiteturas, change requests, quality gates fail-closed, telemetria real, alertas, resiliência e painel operacional sem métricas falsas. O sexto adicionou integridade de requisições, registro e tratamento de incidentes, gates fail-closed de produção, catálogo versionado de avaliações contínuas e readiness/capabilities sem alegações falsas de homologação. O sétimo adicionou pesquisa por APIs oficiais do YouTube, X, Reddit, Instagram, Facebook e TikTok, bloqueio explícito do LinkedIn quando não há produto oficial aplicável, proveniência social, citações, cota durável e leitura externa com redirects revalidados, streaming limitado e HTML sanitizado. As evidências reproduzíveis estão em `baseline-2026-08-26.md`, `research-rag-2026-08-26.md`, `memory-durable-2026-08-27.md`, `site-factory-observability-2026-08-27.md`, `security-production-2026-08-27.md` e `social-search-completion-2026-08-27.md`.

Os requisitos continuam sem `VERIFIED` porque não há revisor independente registrado. Itens com apenas contrato ou classificação, mas sem enforcement ou fluxo completo, permanecem `IN_PROGRESS`.
