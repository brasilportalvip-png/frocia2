# Evidência — E2E, migrations e backup automático — 2026-08-29

## Identidade

- Base: `f15301a`, merge do PR #12 na `main`.
- Branch: `feat/prompt-master-production-gates-20260829`.
- Commit técnico: `0ef36c83167f9b27cb273c6f1794d4e4fe4baa6c`.

## Implementado

- Playwright separado do Vitest, com oito execuções em Chromium desktop/mobile;
- testes de liveness, inicialização do frontend, refresh público, modal de autenticação, validação local, contrato 404, cabeçalhos de segurança e violações WCAG críticas;
- instalação do Chromium e publicação do relatório Playwright no GitHub Actions;
- catálogo crescente de migrations Firestore com checksum, ledger durável, trava concorrente, retomada após lock expirado e registro de falha;
- validação reproduzível de catálogo, índices e `rules_version = 2`;
- backup automático diário pela Vercel às 03:00 UTC;
- backup portátil compactado e criptografado com AES-256-GCM antes do upload;
- download e validação do objeto imediatamente após o upload;
- SHA-256 do conteúdo original e do arquivo criptografado;
- retenção que nunca remove as três cópias mais recentes e atua somente no prefixo oficial;
- suporte seguro ao `Authorization: Bearer CRON_SECRET` da Vercel e ao cabeçalho operacional `x-cron-secret`.

## Gates executados localmente

```text
npm run typecheck
npm run validate:migrations
npm run validate:production-integrity
npm run test:production-gates
npx playwright test --list
npm test
npm run build
npm audit --omit=dev --audit-level=moderate
npm run validate:tracker
git diff --check
```

Resultados:

- tipagem aprovada;
- catálogo de migrations válido, versão alvo 1;
- integridade aprovada em 165 arquivos;
- 13 testes específicos de produção aprovados;
- 8 testes Playwright descobertos corretamente em desktop/mobile;
- 342 testes Vitest aprovados em 42 arquivos;
- build aprovado;
- auditoria com 0 vulnerabilidades;
- tracker com 563 IDs únicos;
- diff sem erro de whitespace.

## Evidência ainda pendente

O download local do Chromium expirou cinco vezes no CDN do Playwright. Portanto, os oito testes E2E **não são declarados aprovados localmente**.

O primeiro workflow do PR #13, execução `33265152238`, instalou o Chromium, mas falhou no navegador. O trace comprovou `Firebase: Error (auth/invalid-api-key)`: sem variáveis públicas `VITE_FIREBASE_*` no CI, `src/lib/firebase.ts` tentava inicializar o Auth antes do React e deixava a tela vazia. A correção tornou os serviços Firebase opcionais quando a configuração pública não existe, preservando a interface pública e bloqueando somente operações dependentes de autenticação. A nova execução do CI permanece necessária antes de aprovar o gate E2E.

O backup automático somente ficará operacional depois de configurar no Vercel:

- `CRON_SECRET` com valor aleatório de pelo menos 32 caracteres;
- `FIREBASE_STORAGE_BUCKET` com o nome do bucket, sem `gs://`;
- `BACKUP_ENCRYPTION_KEY` com segredo aleatório de pelo menos 32 caracteres;
- opcionalmente `BACKUP_RETENTION_DAYS`, padrão 30.

A migration versão 1 está implementada e testada, mas ainda precisa ser aplicada primeiro no Preview e depois em produção pela rota interna protegida. Staging, execução E2E no CI e auditoria independente continuam pendentes; nenhum desses gates é chamado de `VERIFIED` nesta evidência.
