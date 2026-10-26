# Reparo de patches com contexto da tentativa anterior

Base de produção: commit `298300f604123b145a77bac2e7d0fc3945d62a31`, PR #104.

## Falha observada

A rodada #93, tentativa 2, confirmou acesso pelo GitHub App, escrita de objetos Git e acesso à Vercel. O Gemini respondeu em três tentativas. O novo teste `tests/indexHtmlSeoContent.test.ts` falhou sucessivamente com tipos de `mimeType`, `ImportType` e aridade de função. Nenhum patch foi certificado, nenhum PR foi criado e nada dessa rodada foi publicado.

O feedback dos comandos chegava ao modelo. Entretanto, o worker restaurava a base antes de gerar novamente e não enviava o patch reprovado à próxima tentativa. Um teste novo ainda não existe no repositório original. Portanto, seu conteúdo desaparecia do contexto de reparo.

## Alteração

- O ciclo mantém em memória uma cópia do último patch reprovado e a fornece ao reparo após restaurar a sandbox.
- O worker envia um contexto limitado com arquivos anteriores, tipos e assinaturas das dependências locais importadas e versões de TypeScript, Vitest e tipos do Node.
- O feedback inclui até 20 diagnósticos TypeScript distintos, limitados e sem segredos, além do trecho de saída do comando. Isso evita mostrar somente a primeira falha quando existem outras no mesmo teste.
- O contexto inclui aliases privados como `ImportType`, interfaces como `ExternalImportResult` e métodos públicos mesmo quando sua implementação está no final de um arquivo grande.
- Os imports são analisados com o parser TypeScript, sem executar os módulos. Há limites de arquivos, leituras e caracteres, remoção de segredos e recusa de symlinks que escapem do repositório.
- Um reparo que descarta todos os testes do patch anterior é recusado antes da aplicação e da certificação. Um teste substituto continua permitido.
- A restauração da base e as verificações completas continuam a cada tentativa. O snapshot é contexto, não aprovação do patch anterior.
- O diagnóstico do GitHub exige também `GITHUB_APP_SLUG`, como o serviço realmente publicado. O nome usado no Actions é `FROC_GITHUB_APP_SLUG`, valor `froc-ia`.
- O diagnóstico do gerador distingue o nível de raciocínio solicitado da quantidade de tokens informada pelo provedor. `thinkingTokens: null` representa metadado ausente; não comprova que o raciocínio estava desligado.

## Conselho da Claude

1. **Tipos e assinaturas reais:** aplicado ao contexto de reparo, inclusive para imports introduzidos pelo próprio teste novo.
2. **Preservar a tentativa anterior:** aplicado como snapshot em memória. A sandbox permanece restaurada para certificar cada patch contra a mesma base.
3. **Última tentativa com Pro:** não foi habilitado automaticamente um modelo diferente ou mais caro. O worker já solicita raciocínio `LOW` para a família Gemini 3. A escolha de modelo continua seguindo a configuração existente.
4. **Descartar testes com erro:** essa mudança não foi aplicada. O mecanismo pede o reparo ou substituição do teste e recusa sua remoção total para obter aprovação.
5. **Limitar retomadas:** já existem três tentativas por chamada ao worker. A recuperação persistente permite uma retomada automática e até três manuais por versão/dia, respeitando orçamento e parada. `requiresResume` indica pendência, não autorização para repetir sem limite. A tarefa não foi marcada como abandonada nem excluída.

## Evidência e limites

Um teste novo reproduziu a perda do patch anterior e falhou antes da correção. A regressão passou depois. Outro teste usa o compilador TypeScript real para detectar TS2322 e TS2554, limpar a sandbox, enviar o contexto ao provedor simulado e certificar uma resposta reparada, preservando a mudança no produto e o teste.

Esses testes validam os contratos do executor. Não prometem que o Gemini produzirá código correto em toda tentativa. Nenhuma chamada a modelo pago ou publicação foi feita nesta validação local. A confirmação do ciclo externo completo continua dependendo de CI, preview, revisão, merge e verificação da produção após instalar esta alteração.

Validação concluída: 1.073 testes em 141 arquivos; TypeScript; build; integridade de 242 arquivos; inicialização nativa da API com `/api/live` 200 e rotas privadas 401. A instalação limpa e os testes de navegador do container deverão ser confirmados pelo CI da nova versão. O instalador Windows foi revisado neste ambiente Linux e não foi executado aqui. Diretórios temporários `.serverless-runtime-*` da validação são ignorados pelo Git para evitar que resíduos da verificação interrompam a retomada ou sejam incluídos no commit.
