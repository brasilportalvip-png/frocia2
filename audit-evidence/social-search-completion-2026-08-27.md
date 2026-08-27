# Evidência — pesquisa oficial em redes e leitura externa segura

## Escopo

Commit de implementação: `a0aa91f0c15a0a49d72ce7c04eb01e73b88183d4`.

Este bloco adiciona pesquisa por APIs oficiais do YouTube, X, Reddit, Instagram, Facebook e TikTok, com classificação automática da solicitação, registro da ferramenta, autenticação isolada, rate limit durável, timeout, normalização dos resultados, permalinks, citações sociais e integração no contexto da IA. Resultados externos entram como dados não confiáveis e nunca como instruções.

O LinkedIn permanece fail-closed: o catálogo oficial não oferece um produto geral de busca pública de posts para qualquer aplicativo. A aplicação não faz scraping e não simula acesso. As demais plataformas somente são chamadas quando todas as configurações mínimas estão presentes.

## APIs e limites oficiais considerados

| Plataforma | Operação | Limite declarado pela implementação |
|---|---|---|
| YouTube | YouTube Data API v3 `search.list` | Somente vídeos públicos indexados; exige chave e cota. |
| X | API v2 recent search | Janela, operadores e volume dependem do plano contratado. |
| Reddit | Data API via OAuth | Somente conteúdo acessível ao token; comunidades privadas e conteúdo removido ficam indisponíveis. |
| Instagram | Instagram Graph API, busca por hashtag e mídia recente | Exige conta profissional, permissões e aprovação da Meta; não acessa perfis privados. |
| Facebook | Meta Graph API, busca de Páginas públicas | Conteúdo exige Page Public Content Access e escopos aplicáveis. |
| TikTok | Research API, video query | Exige aprovação para Research Tools e janela máxima de 30 dias. |
| LinkedIn | Nenhuma operação geral habilitada | Sem produto oficial de busca pública genérica; status `unsupported`. |

Documentação primária usada:

- https://developers.google.com/youtube/v3/docs/search/list
- https://docs.x.com/x-api/posts/search/introduction
- https://www.reddit.com/dev/api/oauth/
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search
- https://developers.facebook.com/docs/features-reference/page-public-content-access/
- https://developers.tiktok.com/doc/research-api-specs-query-videos/
- https://developer.linkedin.com/product-catalog

## Evidências executadas antes do fechamento

```text
npm run test:social-search
2 arquivos, 29 testes — aprovados.

npm exec vitest run tests/attachmentImportSecurity.test.ts
1 arquivo, 13 testes — aprovados.

npm run typecheck
tsc --noEmit — aprovado.

npm run validate:production-integrity
153 arquivos — aprovados sem catch vazio, mocks de produção, execução dinâmica ou segredos hardcoded.

npm test
30 arquivos, 284 testes — aprovados.

npm run build
Vite: 1735 módulos transformados; bundle do servidor: 725.0 kB — aprovado.

npm audit --omit=dev --audit-level=high
Sem vulnerabilidade high/critical; 6 vulnerabilidades moderadas transitivas em uuid/gaxios/storage permanecem porque o fix sugerido faria downgrade incompatível do firebase-admin.
```

Os testes cobrem classificação de intenção, seleção da plataforma, chamadas oficiais simuladas, OAuth, segregação de identificadores, permalinks, datas, métricas, ausência de credenciais, recusa de escopo, não vazamento de tokens, cota por usuário/tenant, citações seguras e bloqueio de alegações falsas.

A leitura externa também foi validada para bloqueio de loopback, revalidação de redirecionamento, limite durante o streaming, timeout, allowlist do GitHub, rejeição de binários e remoção de scripts, iframes e outros elementos executáveis do HTML.

## Configuração externa necessária

- `YOUTUBE_DATA_API_KEY`
- `X_BEARER_TOKEN`
- `REDDIT_USER_AGENT` e `REDDIT_ACCESS_TOKEN`, ou credenciais OAuth de aplicação
- `META_ACCESS_TOKEN`, `META_GRAPH_API_VERSION` e `INSTAGRAM_USER_ID`
- `TIKTOK_RESEARCH_ACCESS_TOKEN`

Credencial configurada não equivale a integração homologada. A tela de integrações e o endpoint de capacidades informam separadamente `configured`, modo de acesso, requisitos e limitações.

## Limites e bloqueadores reais

- Nenhuma conta externa ou credencial social foi disponibilizada nesta execução local; por isso não houve consulta ao vivo nem recibo de produção das plataformas.
- Meta, X, TikTok e Reddit podem exigir plano, App Review, aprovação do caso de uso ou escopos adicionais.
- A busca social pública não inclui conteúdo privado, fechado, removido ou indisponível.
- A proteção contra DNS rebinding continua `IN_PROGRESS`: o host é resolvido e revalidado antes de cada requisição, mas o `fetch` padrão não fixa o socket ao endereço previamente validado.
- Nenhum requisito recebeu `VERIFIED`, pois não há revisor independente registrado.

Esses limites permanecem explícitos no rastreador e impedem qualquer declaração de conclusão integral ou homologação das redes.
