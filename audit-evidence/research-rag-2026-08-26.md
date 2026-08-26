# Evidência — pesquisa verificável e RAG versionado

Data: 26/08/2026  
Base: `origin/main` no commit `2341717`  
Commit de implementação: `862a31d`

## Escopo implementado

- Google Search grounding continua sendo a ferramenta real de pesquisa do provedor.
- URLs de citação são aceitas somente quando usam HTTPS público, sem credenciais e sem destino literal privado, loopback ou link-local.
- Citações são sanitizadas, deduplicadas, numeradas, persistidas e exibidas no chat como links seguros.
- Pesquisa que exige fontes passa a falhar de forma fechada quando o provedor não retorna evidência verificável.
- Pesquisa de saúde, jurídico ou finanças com apenas um domínio é marcada como evidência limitada.
- Pesquisa e RAG em streaming são armazenados em buffer até a avaliação de evidência terminar.
- Nenhuma base privada é consultada sem seleção explícita no chat.
- A recuperação RAG revalida usuário, base, estado do documento, revisão ativa e expiração antes de usar cada trecho.
- Documentos textuais passam a registrar nome, hash, versão, revisão, vigência, expiração e URL de origem opcional.
- A API e a interface permitem reindexar uma nova revisão sem ativá-la antes da indexação terminar.
- Revisões antigas deixam de participar da recuperação e são removidas depois da ativação da nova revisão.
- Conteúdo duplicado é detectado pelo hash também depois de uma reindexação.
- Quando a base selecionada não sustenta a resposta, o runtime substitui a conclusão por uma mensagem explícita de ausência de evidência.

## Comandos e resultados

```text
npm run typecheck
Resultado: aprovado, zero erros TypeScript.

npm run test:research-rag
Resultado: 1 arquivo, 12/12 testes aprovados.

npx vitest run tests/knowledgeBaseRag.test.ts tests/phase3_ai_engine.test.ts tests/aiRequestOrchestrator.test.ts
Resultado: 3 arquivos, 25/25 testes aprovados.

npm test
Resultado: 24 arquivos, 185/185 testes aprovados.

npm run build
Resultado: Vite e bundle do servidor aprovados.

git diff --check
Resultado: aprovado.

node --import tsx scripts/validate-requirement-tracker.ts
Resultado: Tracker válido: 563 requisitos, 563 IDs únicos.
```

O comando `npm run validate:tracker` encontrou `EPERM` ao tentar criar o canal IPC interno do `tsx` em `/tmp` neste executor. A mesma rotina foi executada pelo carregador direto `node --import tsx`, sem alterar o código do validador, e aprovou os 563 IDs. O instalador do Windows e o CI continuam usando o comando oficial do projeto.

## Testes adversariais adicionados

- bloqueio de `http`, credenciais na URL, `localhost`, IPv4 privado, metadata endpoint e loopback IPv6;
- remoção de fonte insegura e deduplicação da mesma URL;
- resposta temporal sem fonte não entrega o fato inventado;
- pesquisa sensível com um domínio recebe aviso de evidência limitada;
- pesquisa sensível com dois domínios distintos é aceita pela política;
- trecho de outro usuário, outra base ou revisão antiga é rejeitado;
- documento expirado ou ainda em processamento é rejeitado;
- RAG não é executado quando nenhuma base foi selecionada;
- ausência de trecho documental gera resposta fail-closed;
- citação RAG preserva nome e ID do documento;
- a reindexação e a renderização das fontes estão ligadas ao fluxo real da aplicação.

## Limites e risco residual

Este bloco não implementa nem declara concluídos:

- abertura direta de páginas pela infraestrutura própria, redirecionamentos e defesa completa contra DNS rebinding;
- conferência determinística da data de publicação e da data do acontecimento;
- comparação semântica automática de afirmações conflitantes;
- integrações autenticadas com redes sociais e seus escopos OAuth;
- ingestão persistente de PDF, DOCX, XLSX, páginas web ou OCR de PDF escaneado;
- extração confiável de página, seção e tabelas em formatos binários;
- reranking por segundo modelo e avaliação independente em produção;
- citações inseridas ao lado de cada afirmação individual; nesta fase, as fontes numeradas aparecem imediatamente abaixo da resposta.

Por esses limites e pela ausência de revisor independente, nenhum requisito foi marcado como `VERIFIED`.
