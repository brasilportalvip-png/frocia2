# Gates de liberação de produção

O serviço `ProductionReleaseService` inicia todos os 20 gates em `pending`. Nenhum gate é inferido a partir de documentação ou de outro gate.

- Evidência aprovada exige URI `https:` ou `urn:`, SHA-256, commit de 40 caracteres, comando, resultado, ambiente e horário.
- Evidência de outro commit é recusada.
- Staging depende de instalação, lockfile, lint, tipagem, testes e build.
- Produção depende de staging, segurança e tracker.
- Smoke e logs dependem do deployment de produção.
- Segurança, E2E e auditoria independente não podem ser aprovados pelo implementador.
- Falta de credencial ou serviço externo deve usar `external_blocker`.
- O relatório final sempre expõe pendências, falhas, bloqueadores e risco residual.

Ordem operacional: criar release → anexar evidências → consultar decisão → publicar somente quando `ready: true` → gerar relatório final.
