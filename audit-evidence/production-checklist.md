# Checklist de Produção Froc.IA

## Checklist de Prontidão Operacional

- [x] **01. Inexistência de Mocks ou Chaves Fictícias no Core**: Todos os componentes consomem estado vivo e endpoints `/api/*`.
- [x] **02. Compilação e Linter Limpos**: `npm run lint` executa sem erros com exit 0 (`tsc --noEmit`); `compile_applet` compila 100% OK.
- [x] **03. Isolamento e Segurança (Sandbox)**: CSP endurecida em produção (sem `unsafe-eval`), iframe de prévia opera isolado.
- [x] **04. Atribuição do Gemini SDK**: Cliente oficial `@google/genai` configurado no backend em `server.ts`.
- [x] **05. Gestão de Erros Transacionais**: Fallback e repasse transparente de erros com devolução e liberação atômica de créditos.
- [x] **06. Responsividade Visual**: Layout adaptável testado em resoluções Desktop, Tablet e Mobile.
- [x] **07. Feature Flags e Emergency Kill-Switch**: Painel administrativo capacitado para pausar serviços instantaneamente.
- [x] **08. Registro de Auditoria Administrativa**: Concessões e alterações de saldo registram log único imutável.
- [x] **09. Segredos de Produção Fortes**: `INTERNAL_CRON_SECRET` e webhook secrets são obrigatórios, sem fallbacks previsíveis em produção.
- [x] **10. Sincronização de Dependências**: `package.json` e `package-lock.json` alinhados (`froc-ia@1.0.0`).
- [x] **11. Pipeline de CI/CD**: Workflow GitHub Actions configurado em `.github/workflows/ci.yml`.
- [x] **12. Code Splitting & Lazy Loading**: Modais e páginas secundárias importados via `React.lazy` e `Suspense`.
