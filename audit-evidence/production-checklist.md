# Checklist de produção Froc.IA

Data da última auditoria local: 26/08/2026.

## Gates comprovados no baseline `d1f0c66`

- [x] Instalação limpa com lockfile usando cache isolado.
- [x] Tipagem com exit 0.
- [x] 148 testes aprovados em 21 arquivos.
- [x] Build de frontend e servidor com exit 0.
- [x] Auditoria de dependências sem vulnerabilidade alta ou crítica em produção.
- [x] Tracker estruturalmente válido com 563 IDs únicos.
- [x] Preview do PR respondeu `live` e `ready` segundo evidência fornecida pelo proprietário.

## Gates locais do primeiro bloco `c97865e`

- [x] 9 testes específicos de classificação/orquestração aprovados.
- [x] 157 testes totais aprovados em 22 arquivos.
- [x] Typecheck aprovado.
- [x] Build de produção aprovado.
- [x] `git diff --check` aprovado.
- [x] Tracker válido com 563 IDs únicos.
- [ ] Revisão independente do bloco.
- [ ] Preview e smoke test do bloco na Vercel.

## Gates locais do segundo bloco `5de3d06`

- [x] 16 testes específicos do runtime de ferramentas aprovados.
- [x] 173 testes totais aprovados em 23 arquivos.
- [x] Typecheck aprovado.
- [x] Build de produção aprovado.
- [x] Validação de entrada/saída, escopos, confirmação, custo e rate limit coberta por testes.
- [x] Timeout, retry seguro, idempotência, lease, redaction e receipts cobertos por testes.
- [ ] Concorrência do adaptador Firestore validada no Emulator.
- [ ] Handlers externos reais migrados para o runtime.
- [ ] Preview e smoke test do segundo bloco na Vercel.

## Gates ainda não comprovados integralmente

- [ ] Smoke test registrado na URL de produção após o merge.
- [ ] Logs de produção sem erro crítico durante uma janela observável.
- [ ] Migrations e banco validados em staging e produção.
- [ ] E2E dos fluxos críticos no navegador.
- [ ] Acessibilidade, responsividade e regressão visual automatizadas.
- [ ] Carga e concorrência nas rotas críticas.
- [ ] Backups configurados e restauração ensaiada.
- [ ] Rollback testado operacionalmente.
- [ ] Monitoramento, alertas e runbooks ativos.
- [ ] Auditoria independente com identidade separada.
- [ ] Todos os requisitos obrigatórios do tracker fechados.

Enquanto qualquer gate obrigatório permanecer aberto, não usar `READY_FOR_PRODUCTION` para a plataforma completa.
