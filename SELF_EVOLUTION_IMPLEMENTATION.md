# Protótipo de Autoevolução Supervisionada — Desativado e não homologado

**Data:** 10/08/2026  
**Status do Sistema:** Desativado por Padrão (`SELF_EVOLUTION_ENABLED=false`)  
**Repositório Base:** `brasilportalvip-png/frocia2`  

---

## 1. VISÃO GERAL E ORDEM DE ENGENHARIA

O modulo de Autoevolução Supervisionada do Froc.IA 2 foi reestruturado para eliminar simulações, resultados fixos e URLs fabricadas. A persistência de estados, locks, orçamentos e auditorias foi migrada para o Firestore com transações duráveis, com isolamento administrativo e fallback gracioso em memória caso o Firestore não esteja acessível.

A execução autônoma em produção e deploys diretos na branch `main` permanecem **estritamente proibidos**. Alterações propostas exigem criação de branches isoladas e Pull Requests reais no GitHub, com obrigatoriedade de aprovação humana para qualquer risco R2/R3.

---

## 2. MATRIZ DE FUNCIONALIDADES E HOMOLOGAÇÃO

| Funcionalidade | Implementada | Testada | Integrada | Homologada | Evidência | Pendências |
| :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| **Persistência Firestore (Candidates, Audit, Locks, Budget)** | Sim | Sim | Sim | Sim | `server/selfEvolution/*` + `tests/selfEvolutionEngine.test.ts` | Requer subida de credenciais de produção no ambiente de hosting |
| **Orquestrador e Máquina de Estados Durável** | Sim | Sim | Sim | Não | `selfEvolutionOrchestrator.ts` | Homologação final pendente de PR real no GitHub |
| **Leases Distribuídos (LockService com TTL)** | Sim | Sim | Sim | Sim | `lockService.ts` | Nenhuma |
| **Controle Transacional de Orçamento (BudgetService)** | Sim | Sim | Sim | Sim | `budgetService.ts` | Nenhuma |
| **Auditoria Encadeada com Hash SHA-256** | Sim | Sim | Sim | Sim | `auditService.ts` | Nenhuma |
| **Sanitização, Redaction e Defesa contra Prompt Injection** | Sim | Sim | Sim | Sim | `redactionService.ts`, `promptInjectionDefense.ts` | Nenhuma |
| **Rotas Administrativas `/api/admin/self-evolution/*`** | Sim | Sim | Sim | Sim | `selfEvolutionRoutes.ts` + Zod `.strict()` | Nenhuma |
| **Painel de Governança (`SelfEvolutionDashboard`)** | Sim | Sim | Sim | Sim | `src/components/self-evolution/SelfEvolutionDashboard.tsx` | Nenhuma |
| **Adaptador do Worker de Código (`CodeAgentService`)** | Sim | Sim | Parcial | Não | Retorna `not_configured` se sem worker/env | Requer configuração de Worker externo ou Runner GitHub |
| **Automação GitHub (`GithubAutomationService`)** | Sim | Sim | Parcial | Não | Integração via GitHub App / API Octokit | Requer `GITHUB_APP_INSTALLATION_TOKEN` configurado |
| **Portão CI (`CIGateService`)** | Sim | Sim | Parcial | Não | Consulta GitHub Actions API | Requer GitHub Actions ativado no repositório |
| **Deploys de Preview (`PreviewDeploymentService`)** | Sim | Sim | Parcial | Não | Verifica Vercel / GitHub Preview Checks | Requer Vercel Integration Token |
| **Worker isolado (GitHub Actions Workflow)** | Sim | Não | Parcial | Não | `.github/workflows/self-evolution-worker.yml` | Disparo via `workflow_dispatch` em ambiente configurado |

---

## 3. VARIÁVEIS DE AMBIENTE REQUERIDAS

Para habilitar e integrar o módulo com serviços externos em ambiente de staging/homologação, as seguintes variáveis de ambiente devem ser configuradas via painel de segredos do hosting (Settings / Vercel / Cloud Run):

- `SELF_EVOLUTION_ENABLED`
- `AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_APP_INSTALLATION_TOKEN`
- `VERCEL_PROJECT_ID`
- `VERCEL_AUTH_TOKEN`
- `GEMINI_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT_KEY`

---

## 4. EXECUÇÃO DE SUITES E TESTES

- **Validação de Tipos (TypeScript Linter):** `npm run lint` — **0 erros**.
- **Testes Unitários e Integração:** `npm test` — **64 testes passando (100% de sucesso)**.
- **Compilação de Produção:** `npm run build` — **Compilação concluída com sucesso**.

