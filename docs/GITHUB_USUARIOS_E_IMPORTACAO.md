# GitHub na Froc.IA criadora

Esta alteração pertence a `brasilportalvip-png/frocia2`. Não modifica nem moderniza o Marketing Engine.

## Comportamento entregue

- Conectar, reconectar e desconectar a conta GitHub, com autorização de usuário do GitHub App.
- Escolher conta/organização e repositório na criação, na importação e na configuração do projeto.
- Criar um repositório pessoal, quando a permissão do GitHub App permitir.
- Gerar em repositório novo ou contendo somente README/licença/gitignore. A fábrica recusa usar esse fluxo sobre código existente.
- Depois da certificação da fábrica, enviar o código gerado para uma branch dedicada e abrir PR em rascunho. Isso não significa publicação na Vercel.
- Conectar repositório existente sem recriar o site: listar a árvore completa e ler arquivos por versão, preservando backend e configuração original.
- Diferenciar essa conexão da opção anterior de anexar uma referência pública parcial.
- Preservar pedido/anexos no formulário quando login, confirmação de orçamento ou erro impedem iniciar a construção; salvar rascunho da criação na sessão do navegador.
- Usar uma classificação comum para pedidos de site/app com imagens e vídeos.

## Configuração única do administrador

Reutilizar o mesmo GitHub App. No backend/Vercel da **Froc.IA criadora**, conferir:

- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`: configuração de instalação já existente.
- `GITHUB_APP_CLIENT_ID` e `GITHUB_APP_CLIENT_SECRET`: credenciais OAuth do mesmo GitHub App. Não são o App ID nem a chave PEM.
- `GITHUB_APP_STATE_SECRET`: segredo aleatório com pelo menos 32 caracteres, estável entre instâncias. Protege as credenciais armazenadas; alterar o segredo exige reconectar os usuários.
- `APP_URL`: URL oficial da criadora, por exemplo `https://frocia2.vercel.app`.

No cadastro desse App no GitHub, cadastrar a Callback URL `https://frocia2.vercel.app/?github=callback` (ou o domínio oficial configurado em APP_URL). Se houver Setup URL, usar `https://frocia2.vercel.app/?view=integrations`. O retorno OAuth da instalação também é aceito, com estado de sessão de uso único.

Permissões conforme a operação: Contents read/write, Pull requests write; Actions read para consultar CI. Criar repositório via `/user/repos` exige Administration write no endpoint correspondente. Modificar workflows exige Workflows write; esta entrega não altera workflows importados. Usuário e App precisam ter acesso ao destino. Uma instalação não concede a todos os usuários da Froc.IA o acesso do proprietário do App.

Configurar TTL opcional no campo `deleteAfter` da coleção `github_oauth_states` para remover estados expirados. A expiração já é validada no código, independentemente do TTL. Credenciais ficam criptografadas no servidor e são renovadas com concessão de exclusividade quando necessário; não são retornadas ao frontend.

Ausência dessas configurações é exibida como pendência administrativa, nunca como conexão operacional. A sessão desta correção não tem acesso às configurações privadas da Vercel para preenchê-las ou homologá-las.

## Limite explícito da importação

A conexão permite consultar a árvore e os arquivos reais, inclusive `server/`, `shared/` e a configuração Capacitor. Ela não afirma ter clonado todo o repositório num executor nem ter editado/testado/publicado as alterações do projeto importado.

A edição automática completa de um projeto existente continua dependendo de um executor dedicado com checkout integral, aplicação de diffs, testes originais e PR. A fábrica de novos projetos não é utilizada como substituto desse executor. Não aplicar seu scaffold ou trocar a Vercel de um projeto existente.

O escopo de modernização do Marketing Engine continua sendo um trabalho separado, em seu próprio repositório.

## Validação e publicação desta correção

Testes cobrem PKCE, estados expirados/repetidos, isolamento de usuário/tenant, criptografia, renovação concorrente, permissão de escrita, paginação, importação idempotente, árvore com 100 arquivos e leitura do backend por SHA, interface de seleção e roteamento de pedidos.

Rodar `npm run typecheck`, `npm test`, `npm run build`, os validadores do repositório e `npm audit --omit=dev`. A execução local usa provedores simulados nos testes de OAuth e não substitui a homologação com a instalação real após configurar as credenciais.

A PR desta correção deve ser revisada e passar pelo CI antes do merge. Não há merge nem deploy automático executado por este pacote.
