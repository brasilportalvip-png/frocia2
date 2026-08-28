# Evidência — auditor verificável de sites públicos

Data: 28/08/2026  
Branch: `feat/prompt-master-full-site-auditor-20260827`  
Commit de implementação: `02bd544`

## Escopo entregue

- Auditoria manual autenticada em `POST /api/site-audits`, com limite selecionável de 10, 20 ou 40 páginas.
- Acionamento automático pelo chat quando a solicitação contém uma URL e intenção explícita de auditar, analisar ou verificar o site.
- Descoberta por `robots.txt`, sitemap, sitemap index e links internos do mesmo origin.
- Respeito a `Allow`, `Disallow`, curingas, final `$` e `crawl-delay` do `robots.txt`.
- Estados honestos `complete`, `partial` e `blocked`, com páginas lidas, falhas, limites e motivos.
- Evidência por página: URL solicitada/final, instante da leitura, SHA-256, título, trechos inertes, cabeçalhos e achados.
- Verificações de HTTPS, HSTS, CSP, `nosniff`, Referrer Policy, formulários inseguros, título, meta description, canonical, `noindex`, H1, idioma, alt de imagens, conteúdo escasso, duplicações e provável dependência de JavaScript.
- Citações HTTPS geradas somente a partir de páginas realmente retornadas.
- Conteúdo externo rotulado como não confiável e impedido de substituir instruções do sistema.
- Proteções de SSRF para loopback, IPs privados, link-local e destinos internos, além de revalidação de cada redirecionamento.
- Limites de 900 KB por resposta, 100 links por página, 2.000 URLs descobertas, 8 sitemaps, tempo total e cota durável de 3 auditorias a cada 5 minutos por usuário/empresa.

## Integração real

- `server/services/siteAuditService.ts`: descoberta, crawl, análise, hashes, estados e limites.
- `server/services/externalImportService.ts`: leitura pública segura e sinais HTML/HTTP.
- `server/routes/siteAuditRoutes.ts`: rota autenticada, rate limit e resposta anexável.
- `server/ai/siteAuditPolicyService.ts`: cota persistente e compartilhada entre rota e chat.
- `server/ai/requestClassifier.ts`, `requestOrchestrator.ts`, `toolRegistry.ts`: classificação e contrato da ferramenta.
- `server/ai/aiExecutionService.ts` e `server/routes/aiRoutes.ts`: execução síncrona e streaming com contexto/citações.
- `src/components/UrlImporterModal.tsx`: aba “Site inteiro” e seleção do limite.
- `src/components/IntegrationsPage.tsx`: capacidade e limitações visíveis.

## Testes executados

```text
npm run typecheck
APROVADO

npm run test:site-audit
2 arquivos, 25 testes aprovados

npm test
31 arquivos, 296 testes aprovados

npm run build
APROVADO — Vite e bundle do servidor

npm audit --omit=dev --audit-level=high
0 vulnerabilidades high/critical; 6 moderadas transitivas em uuid/@google-cloud/storage/firebase-admin
```

## Limites e risco residual

- O auditor cobre conteúdo público retornado por HTTP/HTTPS. Não contorna login, CAPTCHA, paywall, bloqueios da plataforma ou conteúdo privado de terceiros.
- HTML dependente de JavaScript é identificado, mas não é renderizado por um navegador headless nesta fase.
- A validação DNS antes de cada request bloqueia endereços privados conhecidos e redirecionamentos são revalidados, mas proteção completa contra DNS rebinding exige conexão com resolução fixada; `PM-06-022` permanece `IN_PROGRESS`.
- As verificações de acessibilidade e SEO são sinais automatizados, não uma certificação WCAG nem uma auditoria humana completa.
- Nenhum requisito recebe `VERIFIED` sem revisor independente e evidência de preview/produção.
