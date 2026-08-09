# Arquitetura da Plataforma Froc.IA

## Visão Geral do Sistema

A Froc.IA é uma plataforma de desenvolvimento assistido por inteligência artificial, construída em uma arquitetura moderna full-stack baseada em React (Vite) no frontend e Node.js (Express) no backend, executada sobre infraestrutura Cloud Run e integrada à suíte Google Cloud / Firebase e SDKs do Gemini.

```
+-------------------------------------------------------------------------+
|                                FRONTEND                                 |
|                         (React 18 + Vite + Tailwind)                    |
|                                                                         |
| +-------------------+  +--------------------+  +----------------------+ |
| |   Chat Central    |  |  Sidebar & Inspec. |  | Painel de Artefatos  | |
| | (Streaming / Modos|  | (Histórico/Projetos|  | (Editor/Diff/Iframe  | |
| +---------+---------+  +---------+----------+  +----------+-----------+ |
+-----------|----------------------|------------------------|-------------+
            |                      |                        |
            +----------------------+------------------------+
                                   | HTTP / WebSocket REST API
+----------------------------------v--------------------------------------+
|                                BACKEND                                  |
|                      (Node.js / Express Server)                         |
|                                                                         |
| +--------------------+ +---------------------+ +----------------------+ |
| |  Gemini 3.6 Router | | Multi-File Zip/RAG  | |   Admin & Quality    | |
| |  & Safety Proxy    | | Analyzer Engine     | | Traces / Audits    | |
| +----------+---------+ +----------+----------+ +----------+-----------+ |
+------------|----------------------|-----------------------|-------------+
             |                      |                       |
+------------v----------------------v-----------------------v-------------+
|                            SERVIÇOS EXTERNOS                            |
|  • Google Gemini SDK (@google/genai)                                    |
|  • Firebase Auth & Firestore / Storage                                  |
|  • Mercado Pago Webhook Payment Engine                                  |
|  • GitHub API / Vercel Deploy Proxy                                     |
+-------------------------------------------------------------------------+
```

## Componentes Principais

1. **`src/App.tsx`**: Ponto de entrada e gerenciador de estado global (navegação, sites salvos, auth, modals de custo e artefatos).
2. **`src/components/ChatCentral.tsx`**: Interface principal de conversação com o assistente Froc.IA, seleção de 8 modos operacionais e acionamento de envio de mídias.
3. **`src/components/Sidebar.tsx`**: Barra lateral retrátil com histórico agrupado por tempo (Hoje, Ontem, 7 Dias, Anteriores), ações rápidas e atalhos para Base de Conhecimento e Snippets.
4. **`src/components/ArtifactCanvasPanel.tsx`**: Estação de trabalho para edição de código, visualização de prévias live, diff de versões e edições contextuais por seleção de texto.
5. **`src/components/AdminPanel.tsx`**: Painel de governança com indicadores agregados em tempo real, estado de integridade dos serviços e acesso à suíte de qualidade supremo.
6. **`src/components/PromptRegistryModal.tsx`**: Registro e versionamento de prompts do sistema com suporte a rollback seguro e distribuição A/B.
7. **`src/components/EvaluationsModal.tsx`**: Suíte de testes automatizados de homologação e medição de acurácia, latência e segurança.
8. **`src/components/ExecutionTracesModal.tsx`**: Rastreabilidade de chamadas de IA com consumo detalhado de tokens, custos e evidências de validação.
9. **`src/components/FeatureFlagsPanel.tsx`**: Chaves de ativação/desativação em tempo real e botão de emergência (Kill-Switch).
10. **`src/components/DisasterRecoveryModal.tsx`**: Monitoramento de RPO/RTO, snapshots de backup e portabilidade de dados do usuário.
