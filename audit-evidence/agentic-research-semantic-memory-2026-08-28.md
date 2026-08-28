# Evidência — pesquisa agêntica e memória semântica — 2026-08-28

## Escopo entregue

Esta fase adiciona uma segunda estratégia real ao modo **Pesquisa** sem remover o caminho Gemini existente:

- OpenAI Responses API em `background=true`, com busca web obrigatória, limite configurável de chamadas e polling de estado;
- trajetória auditável com ações `search`, `open_page` e `find_in_page`;
- citação HTTPS com título, domínio, índices inicial/final e trecho exato sustentado;
- avaliação fail-closed de quantidade de fontes, domínios independentes, abertura de páginas e cobertura de afirmações;
- job persistido no Firestore, proprietário autenticado, prompt criptografado, reserva/estorno/confirmação de créditos, cancelamento e recuperação de finalização presa;
- idempotência determinística por usuário e chave de execução;
- progresso visível no chat e retomada depois de recarregar a página;
- fallback automático para a pesquisa Gemini quando a estratégia OpenAI não está configurada ou está temporariamente indisponível;
- memória extensa com vetor semântico real do Gemini quando disponível e fallback lexical explícito quando o embedding falha;
- benchmark versionado com 100 casos, 10 categorias, 50 cenários de alto risco e 10 cenários que exigem evidência social;
- registro público de capacidade e readiness de configuração, sem apresentar configuração como homologação real.

## Referência arquitetural oficial

A implementação foi baseada exclusivamente na documentação oficial da OpenAI:

- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search): ferramenta de busca integrada, fontes retornadas e citações de URL.
- [Deep research](https://developers.openai.com/api/docs/guides/deep-research): pesquisa multi-etapas, ações de busca/abertura/localização, citações inline, `max_tool_calls` e execução longa.
- [Background mode](https://developers.openai.com/api/docs/guides/background): criação assíncrona, polling, estados terminais e cancelamento.

## Arquivos principais

- `server/ai/providers/openAIResearchProvider.ts`
- `server/ai/researchJobService.ts`
- `server/ai/researchQualityService.ts`
- `server/ai/researchBenchmarkCatalog.ts`
- `server/ai/longTermConversationMemoryService.ts`
- `server/routes/aiRoutes.ts`
- `src/App.tsx`
- `src/components/ChatCentral.tsx`
- `firestore.rules`

Commit de implementação: `7ba5d9b`.

## Gates reproduzíveis

Comandos:

```text
npm run typecheck
npm run test:agentic-research
npm test
npm run build
npm run validate:production-integrity
npm run validate:tracker
npm audit --omit=dev --audit-level=high
git diff --check
```

Resultados locais em Node `24.19.0` e npm `11.9.0`:

- tipagem: aprovada;
- testes específicos: 5 arquivos, 17 testes aprovados;
- suíte completa: 39 arquivos, 326 testes aprovados;
- build Vite + servidor esbuild: aprovado;
- integridade de produção: 162 arquivos aprovados;
- tracker: 563 requisitos e 563 IDs únicos;
- auditoria de produção: 6 vulnerabilidades moderadas transitivas, 0 altas e 0 críticas;
- whitespace/diff: aprovado.

## Segurança e privacidade

- A chave OpenAI permanece apenas no servidor e nunca entra no corpo, resposta ou frontend.
- Jobs e segmentos de memória são backend-only nas regras do Firestore.
- O prompt do job é criptografado em repouso com a mesma política AES-256-GCM das memórias pessoais.
- Memórias privadas e documentos privados não são enviados automaticamente ao provedor OpenAI nesta fase.
- URLs não HTTPS, loopback e endereços não públicos são rejeitados pelo normalizador de citações.
- Conteúdo externo é tratado como evidência não confiável, nunca como instrução.
- O usuário pode interromper a pesquisa; a reserva é liberada em falha/cancelamento.

## Limites e risco residual

Estado correto: **implementado localmente, ainda não verificado independentemente**.

- `OPENAI_API_KEY` e `OPENAI_RESEARCH_ENABLED=true` não estavam disponíveis neste ambiente; portanto, os contratos HTTP foram testados com respostas controladas, mas nenhuma pesquisa OpenAI paga foi homologada ao vivo.
- O benchmark de 100 casos foi validado estruturalmente e possui critérios de aprovação, porém ainda não foi executado ao vivo contra o provedor nem comparado por avaliador independente.
- Preview, produção e custos reais permanecem sem evidência nesta branch.
- Redes sociais continuam limitadas às APIs, credenciais, planos, escopos e conteúdo público/autorizado de cada plataforma.
- Login, CAPTCHA, paywall, conteúdo privado, removido ou bloqueado não são contornados; “acesso a tudo” não é uma alegação verdadeira nem tecnicamente permitida.
- A busca semântica depende da API de embedding; quando indisponível, o sistema registra a limitação e preserva a recuperação lexical, sem criar pseudo-vetor em produção.
