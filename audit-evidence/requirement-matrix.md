# Matriz de requisitos da Froc.IA

As declarações antigas de “100%”, “publicado e verificado” foram retiradas porque não continham a cadeia de evidências exigida pelo PROMPT MESTRE.

A fonte oficial agora é `prompt-master-tracker.jsonl`. Cada linha contém um único requisito e somente pode receber `VERIFIED` quando o validador confirmar arquivos, testes, comando, resultado, commit, ambiente, evidência e revisor independente.

Execute:

```bash
npm run validate:tracker
```

Enquanto os gates completos não forem executados, requisitos permanecem `OPEN`, `IN_PROGRESS`, `FIXED_NOT_VERIFIED` ou `EXTERNAL_BLOCKER`.

## Estado em 26/08/2026 — commit `5de3d06`

| Estado | Quantidade |
|---|---:|
| `OPEN` | 465 |
| `IN_PROGRESS` | 40 |
| `FIXED_NOT_VERIFIED` | 58 |
| `VERIFIED` | 0 |
| Total | 563 |

O primeiro bloco implementou classificação, orquestração, roteamento seguro e contratos. O segundo adicionou enforcement no runtime de ferramentas, incluindo escopos, confirmação, timeout, retry seguro, custo, rate limit, redaction, idempotência e verificação de resultado. A evidência reproduzível está em `baseline-2026-08-26.md`.

Os requisitos continuam sem `VERIFIED` porque não há revisor independente registrado. Itens com apenas contrato ou classificação, mas sem enforcement ou fluxo completo, permanecem `IN_PROGRESS`.
