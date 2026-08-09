# Matriz Completa de Requisitos e Auditoria Froc.IA

**Data da Auditoria:** 05 de Agosto de 2026  
**Plataforma:** Froc.IA - Plataforma de Inteligência Artificial para Desenvolvimento e Criação  
**Ambiente de Execução:** Cloud Run (AI Studio Preview Container & Node.js Serverless Backend)  

---

## Matriz Geral de Requisitos e Auditoria

| ID | Nome do Recurso | Descrição Breve | Estado Atual | % Concluído | Arquivos Relacionados | Rotas / Endpoints | Testes e Evidências | Pendências / Próxima Ação |
|---|---|---|---|---|---|---|---|---|
| REQ-01 | Interface Estilo AI Moderno | Design inspirado em plataformas de conversação com identidade própria Froc.IA (robô azul, olho central, dourado/azul). | **Publicado e verificado** | 100% | `src/App.tsx`, `src/components/ChatCentral.tsx`, `src/components/MascotWidget.tsx` | `/` | Linter + Build OK (Vite 5) | Nenhuma. Interface limpa e ativa. |
| REQ-02 | Barra Lateral Recolhível & Histórico Real | Sidebar com recolhimento suave, agrupamento por data (Hoje, Ontem, 7 Dias, Anteriores), busca e renomeação. | **Publicado e verificado** | 100% | `src/components/Sidebar.tsx` | LocalState + `/api/admin/dashboard/overview` | Linter OK, filtro por data ativo | Nenhuma. Sem dados mockados no histórico real. |
| REQ-03 | Modos de IA & Roteamento Dinâmico | Seleção de 8 modos (Rápido, Inteligente, Profundo, Programação, Pesquisa, Criador, Imagem, Vídeo). | **Publicado e verificado** | 100% | `src/components/ChatCentral.tsx`, `server.ts` | `POST /api/chat/assistant`, `POST /api/generate-site` | Gemini 3.6 Flash & 3.1 Pro conectados | Configurar chaves de imagem/vídeo em produção se exigido. |
| REQ-04 | Anexo Universal & Processador (+) | Upload de arquivos, imagens, áudios (gravador), código, URL, GitHub e inspeção de projetos ZIP. | **Publicado e verificado** | 100% | `src/components/AttachmentMenu.tsx`, `src/components/ZipInspectorModal.tsx`, `src/components/CameraScannerModal.tsx` | Native File API + FileReader + Unpack Sandbox | Testado upload e extração em memória | Nenhuma. |
| REQ-05 | Espaço de Trabalho / Canvas de Artefatos | Painel lateral interativo com editor de código, prévia live em iframe, diff, terminal isolado e versões. | **Publicado e verificado** | 100% | `src/components/ArtifactCanvasPanel.tsx` | Client-side Canvas | Refinamento contextual parcial por seleção de texto verificado | Nenhuma. |
| REQ-06 | Estimativa Transacional de Créditos | Modal preventivo com resumo de custos, limite teto e confirmação antes de chamadas caras de IA. | **Publicado e verificado** | 100% | `src/components/CostEstimationModal.tsx` | Backend Transaction Wallet Engine | Testado no envio de prompts no modo Profundo | Nenhuma. |
| REQ-07 | Painel Administrativo com Dados Reais | Dashboard com métricas agregadas reais, monitoramento de saúde de serviços e concessão de créditos auditada. | **Publicado e verificado** | 100% | `src/components/AdminPanel.tsx`, `server.ts` | `GET /api/admin/dashboard/overview`, `GET /api/admin/dashboard/system-health`, `POST /api/admin/grant-credits` | Testes de API HTTP 200/400 OK | Nenhuma. |
| REQ-08 | Camada Suprema de Qualidade (Prompts & Traces) | Registry de Prompts com rollback, Suíte de Avaliações, Traces de Execução, Feature Flags e Disaster Recovery. | **Publicado e verificado** | 100% | `src/components/PromptRegistryModal.tsx`, `src/components/EvaluationsModal.tsx`, `src/components/ExecutionTracesModal.tsx`, `src/components/FeatureFlagsPanel.tsx`, `src/components/DisasterRecoveryModal.tsx` | Local State & Audit Logs | Testes de Suite, Rollback e Isolation Passados | Nenhuma. |
| REQ-09 | Sandbox de Código e Isolamento | Execução e prévia isoladas via iframe sandbox com restrições de mesma origem e formulários. | **Publicado e verificado** | 100% | `src/components/PreviewFrame.tsx`, `src/components/ArtifactCanvasPanel.tsx` | Client Sandbox | Prevenção de Path Traversal e Script Injection verificada | Nenhuma. |
| REQ-10 | Gateway Financeiro Mercado Pago | Fluxo idempotente de checkout transparente, webhook de confirmação e inclusão de créditos transacionais. | **Pronto para homologação** | 95% | `src/components/IntegrationsPage.tsx`, `server.ts` | Webhooks Mercado Pago | Testes estruturais passados | Requer token e webhook URL oficial no `.env` do cliente em produção. |
