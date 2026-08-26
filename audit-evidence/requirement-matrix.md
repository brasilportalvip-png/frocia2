# Matriz de requisitos da Froc.IA

As declarações antigas de “100%”, “publicado e verificado” foram retiradas porque não continham a cadeia de evidências exigida pelo PROMPT MESTRE.

A fonte oficial agora é `prompt-master-tracker.jsonl`. Cada linha contém um único requisito e somente pode receber `VERIFIED` quando o validador confirmar arquivos, testes, comando, resultado, commit, ambiente, evidência e revisor independente.

Execute:

```bash
npm run validate:tracker
```

Enquanto os gates completos não forem executados, requisitos permanecem `OPEN`, `IN_PROGRESS`, `FIXED_NOT_VERIFIED` ou `EXTERNAL_BLOCKER`.
