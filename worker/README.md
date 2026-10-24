# Froc.IA Engineering Worker

Worker separado da aplicação web para gerar patches, executar a certificação e
homologar previews. Ele não deve ser implantado dentro do processo da Vercel.

## Garantias implementadas

- autenticação Bearer e respostas assinadas por HMAC;
- repositório HTTPS fixado pelo operador, sem credencial embutida na URL;
- arquivos limitados aos caminhos aprovados e a novos testes;
- comandos sem shell, ambiente mínimo e execução sob UID/GID 10001;
- instalação, TypeScript, lint, testes, E2E, auditoria, integridade, build e `git diff --check`;
- hashes de stdout/stderr, workspace e diff;
- `git reset`, limpeza e verificação de rollback;
- Playwright em desktop, tablet e celular, teclado, Axe, links internos, console, rede e sessão;
- diretório temporário removido ao final.
- descoberta automática de arquivos, imports, dependentes e testes relacionados;
- TypeScript Language Service real para definições, referências e diagnósticos;
- histórico Git dos arquivos selecionados incorporado ao plano de engenharia;
- digest SHA-256 do contexto técnico usado para decidir a alteração.
- ciclo autônomo limitado de diagnóstico, restauração, nova correção e recertificação;
- nenhuma tentativa é selecionada sem passar por todos os comandos obrigatórios.

## Geracao estruturada e recuperacao

O worker solicita `responseJsonSchema` com arquivos completos e mensagem de
commit, alem do MIME JSON. Confere o `finishReason` antes de interpretar o texto;
uma resposta `MAX_TOKENS` e descartada mesmo se seu prefixo for JSON valido.
Nao completa aspas/chaves nem aplica trechos de uma resposta interrompida.

A primeira tentativa permite 32.768 tokens de saida; as seguintes permitem ate
65.536, dentro do limite do modelo padrao `gemini-3.1-pro-preview`. Cada chamada
tem timeout de tres minutos e uma unica tentativa no SDK. O ciclo coordena as
novas geracoes, com tres tentativas por padrao e teto de cinco. Nao e preciso
criar variaveis novas para esta recuperacao.

Erros de JSON, resposta incompleta e formato/caminho invalido ficam registrados
na etapa `generation`. Antes da proxima tentativa, a baseline e restaurada e o
diagnostico e enviado ao modelo, sem reutilizar o texto incompleto. Falhas de
autenticacao/autorizacao e bloqueios do provedor encerram o ciclo sem repeticao.
Falhas de geracao nao executam a aplicacao nem a certificacao do patch. Uma
resposta valida continua dependendo de todos os comandos obrigatorios e rollback.

Os logs de geracao mostram somente tentativa, motivo de termino, quantidade de
caracteres/tokens e limite de saida. O codigo gerado e as credenciais nao entram
nesses logs. Se todas as tentativas falharem, o recibo assinado conserva o motivo
da ultima geracao e os testes nao sao apresentados como aprovados.

## Implantação obrigatória

1. Construa `docker build -t frocia-engineering-worker ./worker`.
2. Execute o contêiner em serviço privado separado, com CPU/memória/tempo limitados.
3. Aplique política de saída real no provedor: permita somente GitHub, registro npm,
   APIs Gemini e previews autorizados. `SANDBOX_NETWORK_POLICY=restricted` é uma
   declaração verificada pelo protocolo, não cria firewall sozinho.
4. Use filesystem efêmero e não monte Docker socket, chaves SSH, diretórios do host
   ou credenciais de produção.
5. Configure segredos no cofre do provedor; não os entregue aos subprocessos.
6. Configure uma conta E2E exclusiva e sem privilégios para validar login/sessão.
7. Publique o HTTPS privado e configure URL, token e segredo HMAC na aplicação.

O workspace em `/tmp` precisa de montagem executável:
`--tmpfs /tmp:rw,exec,nosuid,nodev,size=2g`. O Docker acrescenta `noexec` por
padrão em tmpfs; apenas omitir essa palavra não libera os binários instalados
por npm, como esbuild. O `exec` explícito libera sua execução dentro do
contêiner. As demais restrições de UID, capacidades, rede e raiz somente
leitura continuam aplicadas.

Antes de chamar os agentes, execute o preflight no contêiner com as mesmas
restrições da operação: `node /worker/sandbox-preflight.mjs`. Ele cria um
projeto descartável, copia um ELF real para o workspace, executa esse arquivo
como UID 10001 e roda `npm ci --offline` com um instalador que usa
`execFileSync` sobre esse ELF. Assim, a verificação testa a mesma classe de
permissão exigida pelo instalador do esbuild, além de Git, teste e rollback.
Esse fixture não instala todas as dependências da aplicação.

O preflight também abre o Chromium instalado na imagem, cria uma página e
confere um clique real no DOM como UID 10001. O SDK Playwright do worker deve
ter a mesma versão exata do `@playwright/test` no lock do projeto. Antes de
construir a imagem, execute `node scripts/validate-worker-browser-version.mjs`
na raiz do repositório. O CI e o workflow externo fazem essa conferência.
Ao atualizar Playwright, sincronize a dependência exata, os overrides do
worker e os dois locks; cada versão exige sua própria revisão de navegador.

Falhas dos comandos conservam um trecho sanitizado de stdout e stderr nos
logs e na resposta assinada. Um aviso em stderr não substitui o erro dos
testes que foi escrito em stdout.

Sem firewall de saída e isolamento do provedor, a capacidade deve permanecer
desativada. O sistema falha fechado e não apresenta execução simulada como real.

## Limite importante

O isolamento por UID e contêiner reduz exposição, mas código hostil deve ser
executado em microVM/pod descartável por job para uma fronteira mais forte. Essa
camada depende da infraestrutura escolhida e não pode ser criada apenas pelo ZIP.
