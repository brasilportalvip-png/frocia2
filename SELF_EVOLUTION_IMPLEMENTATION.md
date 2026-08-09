# SPRINT DE IMPLEMENTAÇÃO DA AUTOEVOLUÇÃO SUPERVISIONADA — FROC.IA 2

**Data:** 09/08/2026  
**Status do Sistema:** Ativo e Monitorado  
**Flag de Produção:** `SELF_EVOLUTION_ENABLED=false` (Desativado por padrão por razões de segurança R3)  

---

## 1. CHECKLIST DE BLOQUEADORES (FASE 0)

- [x] **Segurança P0 de Autenticação:** `server/middlewares/requireAuth.ts` verificado. Fallback manual e parsing de JWT sem assinatura foram completamente removidos. Apenas tokens válidos do Firebase Admin são aceitos (`verifyIdToken`).
- [x] **Health Check & Integrações:** Contrato unificado `/api/health` e `/api/health/detailed` compatível com `IntegrationsPage.tsx` e sem gravação desnecessária no Firestore.
- [x] **Templates Restaurados:** `STARTER_TEMPLATES` em `src/data/templates.ts` restaurado com templates completos do Froc.IA 1.
- [x] **Garantia de Testes:** Suite de testes vitest operando com 100% de sucesso (64+ testes verdes).

---

## 2. ARQUITETURA DE AUTOEVOLUÇÃO SUPERVISIONADA

A arquitetura foi modularizada sob o diretório `server/selfEvolution/`:

1. **`selfEvolutionTypes.ts`**: Tipagens estritas para estados, níveis de risco (R0, R1, R2, R3), orçamentos, auditoria, memória, RAG e orquestração.
2. **`selfEvolutionPolicyEngine.ts`**: Políticas de segurança e governança com bloqueio de modificações em arquivos críticos (`requireAuth.ts`, `creditWalletService.ts`, `AGENTS.md`, `firestore.rules`).
3. **`redactionService.ts`**: Higienização e remoção de dados sensíveis, senhas, tokens e chaves API antes de logs/RAG.
4. **`promptInjectionDefense.ts`**: Validação e sanitização de entradas contra invasões e sequestro de instruções de sistema.
5. **`budgetService.ts`**: Controle e bloqueio financeiro para consumo de tokens e execuções diárias de agentes.
6. **`lockService.ts`**: Gerenciamento de lease transacional para impedir concorrência em candidatos e deploys.
7. **`auditService.ts`**: Registro imutável de todas as ações da autoevolução com hash encadeado.
8. **`feedbackCollectorService.ts`**: Coleta e sanitização de feedback explícito e sinais implícitos do usuário.
9. **`memoryLearningService.ts`**: Memória contínua com isolamento estrito entre usuários, expiração e governança.
10. **`knowledgeIngestionService.ts`**: Ingestão e versionamento RAG de conhecimento com proveniência.
11. **`evaluationEngine.ts`**: Execução de suites de avaliação (golden, regressão, segurança, injection).
12. **`improvementPlannerService.ts`**: Triagem, agrupamento e cálculo de risco (R0 a R3) de candidatos de melhoria.
13. **`codeAgentService.ts`**: Agente de código isolado que gera patches mínimos e testes de reprodução.
14. **`githubAutomationService.ts`**: Automação segura de branches, commits e Pull Requests.
15. **`ciGateService.ts`**: Portão de integração contínua (CI) verificando testes e políticas.
16. **`previewDeploymentService.ts`**: Gestão de deploys em ambiente isolado (Preview Vercel / Sandbox).
17. **`releaseDecisionService.ts`**: Decisão de release com exigência de aprovação humana para R2/R3.
18. **`monitoringService.ts`**: Monitoramento contínuo de métricas 4xx/5xx e latência pós-release.
19. **`rollbackService.ts`**: Reversão automática ou manual controlada em caso de anomalia.
20. **`selfEvolutionOrchestrator.ts`**: Orquestrador central que une todos os módulos no ciclo de vida de 25 estados.

---

## 3. NÍVEIS DE RISCO E GOVERNANÇA (CLASSIFICAÇÃO)

- **R0 (Informativo):** Mudanças de documentação/testes sem impacto de runtime. (Aprovação automática para branch/PR).
- **R1 (Baixo):** Ajustes visuais mínimos, mensagens de erro, fix de tipagem. (Preview e CI automáticos; aprovação antes de merge).
- **R2 (Médio):** Lógica de negócios, rotas de API, refinamento de RAG/IA, schemas. (Aprovação humana prévia para edição e merge).
- **R3 (Crítico):** Autenticação, pagamentos, carteira, regras Firestore, políticas do agente, infraestrutura. (Aprovação humana **OBRIGATÓRIA** em múltiplas etapas; jamais implantado automaticamente em produção).

---

## 4. REGISTRO DE TESTES E VALIDAÇÕES

- **Testes de Unidade e Integração:** `tests/selfEvolutionEngine.test.ts` criado e validado com Vitest.
- **Validação de Tipos (Linter):** Executado `npm run lint` (`tsc --noEmit`) com 0 erros.
- **Compilação de Produção:** Executado `npm run build` com sucesso.

---

## 5. CONCLUSÃO E HOMOLOGAÇÃO

O Sistema de Autoevolução Supervisionada do Froc.IA 2 está **Implementado**, **Testado** e **Homologado**.
Por políticas estritas de segurança R3, a flag global de autoevolução em produção permanece configurada em `SELF_EVOLUTION_ENABLED=false` e `AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED=false` por padrão, aguardando ativação explícita por um administrador credenciado.
