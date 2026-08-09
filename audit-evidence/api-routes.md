# Mapa de Rotas e Endpoints da API (Backend Server)

Abaixo estão listadas todas as rotas ativas no servidor Express (`server.ts`):

## 1. Rotas de Gerenciamento do Assistente e Geração de IA

### `POST /api/generate-site`
- **Descrição:** Processa a criação inicial de um site/aplicativo com base no prompt do usuário, categoria e paleta de cores.
- **Autenticação:** Opcional / Token Bearer se autenticado.
- **Payload de Entrada:**
  ```json
  {
    "prompt": "Criar landing page SaaS para aplicativo de IA",
    "category": "Landing Page SaaS",
    "colorPalette": "Cyber Purple & Gold",
    "tone": "Profissional",
    "features": ["Menu Mobile Responsivo", "Formulário de Contato"]
  }
  ```
- **Resposta de Sucesso (200 OK):**
  ```json
  {
    "html": "<!DOCTYPE html>...",
    "title": "SaaS AI App Landing",
    "description": "Site gerado pela Froc.IA"
  }
  ```

### `POST /api/refine-site`
- **Descrição:** Aplica refinamento contínuo em um código/artefato HTML existente.
- **Payload de Entrada:**
  ```json
  {
    "currentHtml": "<html>...</html>",
    "instruction": "Adicione um botão de suporte no canto inferior direito"
  }
  ```
- **Resposta de Sucesso (200 OK):**
  ```json
  {
    "html": "<html>... (HTML atualizado)</html>"
  }
  ```

### `POST /api/chat/assistant`
- **Descrição:** Interação em linguagem natural com o consultor de UX/código da Froc.IA.
- **Payload de Entrada:**
  ```json
  {
    "message": "Como posso otimizar a velocidade de carregamento de um projeto React?",
    "siteContext": "Aplicação React + Tailwind",
    "model": "gemini-3.6-flash"
  }
  ```
- **Resposta de Sucesso (200 OK):**
  ```json
  {
    "text": "Para otimizar o carregamento no React, utilize Code Splitting com React.lazy()..."
  }
  ```

---

## 2. Rotas do Painel Administrativo e Governança

### `GET /api/admin/dashboard/overview`
- **Descrição:** Retorna agregação em tempo real de usuários ativos, receita, projetos criados e taxa de sucesso.
- **Resposta de Sucesso (200 OK):**
  ```json
  {
    "timestamp": "2026-08-05T13:50:00.000Z",
    "activeUsers": 4280,
    "totalRevenueBrl": 84500.0,
    "generatedProjects": 14920,
    "routerSuccessRate": "99.96%",
    "creditsSold": 154000,
    "creditsConsumed": 112400,
    "uptimePercentage": "99.99%",
    "dataSource": "Firestore Aggregations & MercadoPago Real Webhooks"
  }
  ```

### `GET /api/admin/dashboard/system-health`
- **Descrição:** Verifica a latência e estado operacional de todos os microserviços e integrações ativas.
- **Resposta de Sucesso (200 OK):**
  ```json
  {
    "timestamp": "2026-08-05T13:50:00.000Z",
    "services": [
      { "name": "Froc.IA Web App", "status": "operacional", "latencyMs": 12 },
      { "name": "Google Gemini 3.6 Flash", "status": "operacional", "latencyMs": 240 },
      { "name": "Firebase Firestore", "status": "operacional", "latencyMs": 35 }
    ]
  }
  ```

### `POST /api/admin/grant-credits`
- **Descrição:** Concede créditos manualmente a um usuário com registro auditado.
- **Payload de Entrada:**
  ```json
  {
    "userEmail": "cliente@exemplo.com",
    "amount": 250
  }
  ```
- **Resposta de Sucesso (200 OK):**
  ```json
  {
    "success": true,
    "userEmail": "cliente@exemplo.com",
    "amountGranted": 250,
    "auditLogId": "audit-178593021",
    "timestamp": "2026-08-05T13:50:00.000Z"
  }
  ```
