# Evidência — drill de recuperação e plano de navegador — 2026-08-30

## Identidade

- Base funcional em produção: merge `3438fd8` do PR #13.
- Evidência de backup usada como pré-condição: `froc-backup-2026-08-30T07-36-11-570Z`.
- Commit técnico deste bloco: `7f895b8`.

## Backup real confirmado antes do drill

O backup de produção retornou `status: verified`, exportou 409 documentos de 29 coleções e gravou 508745 bytes no bucket `frocia-e07a5.firebasestorage.app`. O objeto foi baixado novamente, autenticado, descriptografado e teve os hashes do conteúdo e do arquivo criptografado conferidos.

## Implementado neste bloco

- rota interna protegida `POST /api/internal/backups/drill`;
- seleção somente do objeto de backup verificado mais recente;
- conferência do SHA-256 criptografado antes da descriptografia;
- autenticação AES-256-GCM, validação do projeto e do checksum portátil;
- execução do restaurador em `dryRun: true`, sem gravar documentos restaurados;
- contagem cruzada de documentos, coleções e `backupId`;
- registro de auditoria do exercício sem expor conteúdo dos usuários;
- plano determinístico de navegador para cada especificação de site aprovada;
- cenários condicionais para autenticação, multiempresa, administração, formulários, uploads, busca, pagamentos, cancelamento, e-mail e webhook;
- cenários universais para rotas, navegação, refresh, responsividade, teclado, leitor de tela, movimento reduzido, console, rede, status HTTP, estados visuais, persistência, links e smoke público;
- acoplamento de cada cenário a um quality gate obrigatório e bloqueio de readiness enquanto houver gate pendente;
- endpoint autenticado para consultar o plano de navegador versionado e seu digest;
- modal de autenticação com foco inicial, restauração de foco, escape, armadilha de teclado, rótulos e rolagem em telas pequenas;
- Playwright agora inicia o build compilado em vez do servidor de desenvolvimento.

## Gates executados localmente

```text
npm run typecheck
npm run validate:migrations
npm run validate:production-integrity
npm run test:production-gates
npm run test:site-factory
npx playwright test --list
npm test
npm run build
npm audit --omit=dev --audit-level=moderate
npm run validate:tracker
git diff --check
```

Resultados:

- tipagem aprovada;
- migration alvo 1 íntegra;
- integridade aprovada em 166 arquivos;
- 17/17 testes específicos de backup e migrations aprovados;
- 37/37 testes específicos da fábrica e observabilidade aprovados;
- 12 execuções Playwright descobertas em Chromium desktop/mobile;
- 349/349 testes Vitest aprovados em 42 arquivos;
- build de produção aprovado;
- auditoria de produção com 0 vulnerabilidades;
- tracker com 563 IDs únicos;
- diff sem erro de whitespace.

## Limites declarados

O navegador local não executou os dez testes que exigem renderização porque este ambiente não possui o binário do Chromium; dois testes somente de API passaram. O GitHub Actions instala o Chromium antes de executar o gate. Portanto, a ampliação E2E permanece pendente até o CI do novo PR.

O drill está implementado e coberto por testes criptográficos, mas só poderá contar como exercício operacional depois que o novo commit estiver em produção e a rota protegida retornar `status: verified` com `dryRun: true`. Até isso ocorrer, recuperação permanece `IN_PROGRESS`.

O plano de navegador torna os cenários obrigatórios para cada site gerado, mas não afirma que um site específico já executou todos eles. Essa confirmação depende dos relatórios reais anexados aos quality gates e de revisão independente.
