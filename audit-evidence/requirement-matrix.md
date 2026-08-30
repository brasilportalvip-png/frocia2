# Matriz de requisitos da Froc.IA

As declarações antigas de “100%”, “publicado e verificado” foram retiradas porque não continham a cadeia de evidências exigida pelo PROMPT MESTRE.

A fonte oficial agora é `prompt-master-tracker.jsonl`. Cada linha contém um único requisito e somente pode receber `VERIFIED` quando o validador confirmar arquivos, testes, comando, resultado, commit, ambiente, evidência e revisor independente.

Execute:

```bash
npm run validate:tracker
```

Enquanto os gates completos não forem executados, requisitos permanecem `OPEN`, `IN_PROGRESS`, `FIXED_NOT_VERIFIED` ou `EXTERNAL_BLOCKER`.

## Estado em 30/08/2026 — produção `3438fd8`

| Estado | Quantidade |
|---|---:|
| `OPEN` | 181 |
| `IN_PROGRESS` | 150 |
| `FIXED_NOT_VERIFIED` | 231 |
| `EXTERNAL_BLOCKER` | 1 |
| `VERIFIED` | 0 |
| Total | 563 |

O primeiro bloco implementou classificação, orquestração, roteamento seguro e contratos. O segundo adicionou enforcement no runtime de ferramentas, incluindo escopos, confirmação, timeout, retry seguro, custo, rate limit, redaction, idempotência e verificação de resultado. O terceiro adicionou pesquisa fail-closed com citações seguras e visíveis, além de RAG privado com seleção explícita, revisão ativa, vigência, expiração, deduplicação e reindexação. O quarto adicionou memória privada com consentimento, isolamento por tenant, criptografia de aplicação, retenção, contexto longo controlado e uma máquina durável com idempotência, leases, fencing token, outbox, compensação e reconciliação. O quinto adicionou especificações versionadas, catálogo oficial de arquiteturas, change requests, quality gates fail-closed, telemetria real, alertas, resiliência e painel operacional sem métricas falsas. O sexto adicionou integridade de requisições, registro e tratamento de incidentes, gates fail-closed de produção, catálogo versionado de avaliações contínuas e readiness/capabilities sem alegações falsas de homologação. O sétimo adicionou pesquisa por APIs oficiais do YouTube, X, Reddit, Instagram, Facebook e TikTok, bloqueio explícito do LinkedIn quando não há produto oficial aplicável, proveniência social, citações, cota durável e leitura externa com redirects revalidados, streaming limitado e HTML sanitizado. O oitavo adicionou auditoria de sites públicos com robots.txt, sitemaps, links internos, hashes, sinais de SEO/acessibilidade/segurança, citações, estados parciais honestos e limites de custo/tempo/páginas. O nono adicionou pesquisa agêntica Gemini com planejamento, subconsultas fundamentadas, jobs retomáveis, trajetória de busca, citações por trecho, gate quantitativo de fontes, benchmark de 100 casos e recuperação semântica de memória, sem exigir fornecedor adicional. O décimo adicionou failover global entre modelos Gemini com circuit breaker, telemetria do modelo efetivo, avaliações HTTP sem execução de processos, merge supervisionado por SHA, rollback real por PR de reversão e auditoria de dependências sem vulnerabilidades conhecidas. O décimo primeiro adicionou Playwright desktop/mobile no CI, validação WCAG, migrations Firestore versionadas com ledger e checksum e backup automático criptografado com verificação pós-upload e retenção segura. Em produção, o Preview foi homologado como staging, a migration versão 1 foi aplicada sem pendências e o primeiro backup real exportou 409 documentos de 29 coleções, foi criptografado, gravado, baixado e validado com checksums. As evidências reproduzíveis estão em `baseline-2026-08-26.md`, `research-rag-2026-08-26.md`, `memory-durable-2026-08-27.md`, `site-factory-observability-2026-08-27.md`, `security-production-2026-08-27.md`, `social-search-completion-2026-08-27.md`, `full-site-auditor-2026-08-28.md`, `agentic-research-semantic-memory-2026-08-28.md`, `final-hardening-2026-08-29.md` e `production-gates-e2e-backup-migrations-2026-08-29.md`.

Os requisitos continuam sem `VERIFIED` porque não há revisor independente registrado. Itens com apenas contrato ou classificação, mas sem enforcement ou fluxo completo, permanecem `IN_PROGRESS`.
