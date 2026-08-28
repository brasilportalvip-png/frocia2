# Evidência — pesquisa agêntica Gemini e memória semântica — 2026-08-28

## Escopo entregue

Esta fase amplia o modo **Pesquisa** usando somente o Gemini já configurado no projeto:

- coordenador durável próprio da Froc.IA, sem chave, assinatura ou faturamento OpenAI;
- planejamento de três a quatro subconsultas independentes;
- uma etapa limitada de Google Search Grounding por subconsulta, persistida antes de continuar;
- combinação com APIs sociais oficiais e auditoria de site quando solicitadas e autorizadas;
- contexto recente, resumo e segmentos semanticamente relevantes de conversas anteriores;
- trajetória auditável com ações `search`, `open_page` e etapa de síntese;
- URLs HTTPS resolvidas, fontes enumeradas e marcadores `[S1]` ligados aos trechos sustentados;
- avaliação fail-closed de fontes, domínios independentes, recuperação de páginas e cobertura de afirmações;
- job no Firestore com proprietário autenticado, prompt/contexto criptografados, lease por etapa, idempotência, reserva/estorno/confirmação de créditos, cancelamento e retomada depois de recarregar;
- progresso visível no chat;
- memória extensa com vetor semântico Gemini quando disponível e fallback lexical explícito quando o embedding falha;
- benchmark versionado com 100 casos, 10 categorias, 50 cenários de alto risco e 10 cenários que exigem evidência social;
- readiness e catálogo de capacidades sem transformar configuração em homologação.

## Arquitetura aplicada

O job não depende de um processo residente na Vercel. Cada consulta autenticada ao estado do job reivindica um lease curto, executa apenas uma etapa e persiste o resultado antes de liberar a próxima etapa:

1. planejar subconsultas;
2. pesquisar uma subconsulta com Gemini + Google Search Grounding;
3. repetir até o limite de quatro consultas;
4. sintetizar somente a partir do caderno e das fontes enumeradas;
5. validar evidência, citações, créditos, mensagens e telemetria.

Se a aba for fechada, o job permanece no Firestore e continua quando o usuário retoma o polling. Requisições concorrentes não executam a mesma etapa enquanto o lease estiver válido.

## Arquivos principais

- `server/ai/researchJobService.ts`
- `server/ai/researchQualityService.ts`
- `server/ai/researchBenchmarkCatalog.ts`
- `server/ai/providers/geminiProvider.ts`
- `server/ai/longTermConversationMemoryService.ts`
- `server/routes/aiRoutes.ts`
- `server/routes/healthRoutes.ts`
- `server/services/capabilityRegistryService.ts`
- `src/App.tsx`
- `src/components/ChatCentral.tsx`
- `firestore.rules`

Commits de implementação: `7ba5d9b` e hotfix `5966d79`.

## Gates reproduzíveis

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
- integridade de produção: 161 arquivos aprovados;
- tracker: 563 requisitos e 563 IDs únicos;
- auditoria de produção: 6 vulnerabilidades moderadas transitivas, 0 altas e 0 críticas;
- whitespace/diff: aprovado.

## Segurança, privacidade e custo

- Nenhuma variável `OPENAI_API_KEY` existe no runtime, modelo, readiness ou exemplo de ambiente.
- A pesquisa reutiliza `GEMINI_API_KEY`, Firebase e os conectores sociais já configurados no projeto; não exige fornecedor adicional.
- O uso do Gemini continua sujeito ao custo e à cota da conta Gemini existente. O limite de quatro subconsultas reduz execução acidentalmente ilimitada.
- Jobs e segmentos de memória são backend-only nas regras do Firestore.
- Prompt, contexto de conversa e evidência auxiliar são criptografados em repouso com AES-256-GCM.
- URLs não HTTPS, loopback e endereços não públicos são rejeitados pelo normalizador de citações.
- Conteúdo externo é evidência não confiável, nunca instrução.
- Falha ou cancelamento libera a reserva interna de créditos.

## Limites e risco residual

Estado correto: **implementado e testado localmente, ainda não verificado independentemente**.

- O benchmark de 100 casos foi validado estruturalmente, mas ainda precisa de execução ao vivo completa e avaliação independente.
- O preview deve ser reimplantado e a pesquisa real deve ser testada antes do merge.
- Redes sociais continuam limitadas às APIs, credenciais, planos, escopos e conteúdo público/autorizado de cada plataforma.
- Login, CAPTCHA, paywall, conteúdo privado, removido ou bloqueado não são contornados; “acesso a tudo” não é uma alegação verdadeira nem permitida.
- A busca semântica depende da API de embedding; quando indisponível, o sistema registra a limitação e preserva a recuperação lexical.
- Uma pesquisa em várias etapas consome mais tokens Gemini do que uma única resposta, embora não crie uma nova assinatura externa.
