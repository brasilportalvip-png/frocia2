# Chat e desenvolvimento de projetos existentes

Alvo desta alteração: `brasilportalvip-png/frocia2`. A Marketing Engine é usada somente como origem pública de aceitação, em uma cópia. Não há merge ou deploy automático nesta entrega.

## Roteamento e recibos

Ordens explícitas de engenharia têm prioridade sobre catálogo, memória e homologação. Negação, citações e o alvo da ordem são considerados. Um repositório externo não vira manutenção da plataforma apenas porque a IA foi chamada de Froc.IA. Uma ordem P0 dirigida à própria Froc.IA pode citar outro repositório como teste.

O controle próprio continua exigindo papel administrativo verificado pelo servidor. Anexos são dados; não impedem uma ordem explícita no texto e não concedem autorização. A rota de controle é executada antes do antigo importador de referências parciais.

Pedidos são persistidos com hash, identificador, alvo, instrução de até 60 mil caracteres, idempotência estável e exclusividade de dispatch. Mesmo pausado, o pedido recebe identificador. Workflow desabilitado, dispatch aceito e job executado são estados distintos. O dispatch HTTP 204 não comprova início ou conclusão do job. Recibos novos não herdam falhas de outra tarefa.

Pedidos do proprietário criados por esse fluxo têm `deliveryPolicy=pull_request_only`. A geração e as validações autorizadas continuam automáticas; a liberação automática é recusada para esses pedidos. Os outros candidatos existentes conservam suas políticas.

## Importação integral e interface

O chat comum aceita URL de repositório público; o modal de importação também aceita ZIP e pasta, conforme suporte do navegador. Projetos salvos podem ser convertidos a partir de seus arquivos da fábrica, HTML integral ou origem GitHub. O caminho de conexão anterior possui botão para migrar o conteúdo ao editor.

GitHub público não exige GitHub App nem workflow no repositório do cliente. Metadados identificam uma versão; o ZIP dessa versão fornece os bytes. Não se usa o JSON resumido como workspace. A árvore completa possui SHA-256 por arquivo e digest global, incluindo binários, backend e lockfile. A raiz de transporte do GitHub é removida. ZIPs com uma única pasta de projeto registram o prefixo removido.

Uploads e downloads usam partes de 384 KiB com checksums e retomada. ZIPs e seus arquivos não são executados na importação. O workspace é privado, persistente e acessível apenas ao usuário/tenant verificado. Firestore armazena os arquivos em partes; nenhuma credencial do GitHub é enviada ao browser para essa operação.

A faixa global “Variáveis e entrega do projeto” foi removida a pedido do proprietário. Os controles ficam em “Projeto”, na barra da prévia, e no painel dos arquivos. Um projeto importado sem prévia exibe uma mensagem de estado e botão para abrir os arquivos, em lugar de iframe vazio.

## Execução isolada

O usuário confirma a instrução e um orçamento de até 50 créditos. O servidor registra o pedido, reserva o limite e solicita o workflow central `project-development.yml` da própria plataforma. Esse workflow atende projetos de usuários sem instalar workflows neles. Reutiliza os secrets administrativos do executor existentes: `FIREBASE_SERVICE_ACCOUNT_KEY` e `GEMINI_API_KEY`, além do modelo configurado em variável. A instalação da plataforma precisa de Actions:write para solicitar o workflow central.

O runner usa Docker por projeto. Não existe fallback de produção para executar código de cliente no servidor Node ou na Vercel. Restrições conferidas por `docker inspect`: rede none, usuário 10001, raiz somente leitura, sem capabilities, sem socket Docker, sem privilégios adicionais, 1 CPU, 2 GiB, 256 processos e volumes temporários limitados. Credenciais da plataforma e arquivos de segredos do projeto não são montados no container. Os segredos originais permanecem no ZIP privado, sem entrar no modelo.

Os arquivos e o cache entram nos tmpfs por fluxo tar em `docker exec -i`, como usuário 10001 e com `--no-same-owner`. Isso evita a limitação de `docker cp` sobre tmpfs, sem liberar escrita na raiz, rede ou privilégios. Binários e permissões de execução são preservados. Falhas informam fase, destino, exit code e um trecho redigido do erro; o tar temporário é removido também em falha/cancelamento. Referência: [Docker cp — corner cases](https://docs.docker.com/reference/cli/docker/container/cp/#corner-cases).

O downloader de dependências aceita tarballs do registro npm oficial e verifica a integridade SHA-512 do lockfile. O cache é preparado sem lifecycle scripts. `npm ci` e os scripts do cliente rodam dentro do container sem rede, com cache offline. Dependências que precisam de downloads externos durante instalação são diagnosticadas como bloqueio, sem liberar rede nem pedir tokens ao usuário.

Ferramentas do agente: listar, ler por SHA, buscar literalmente, substituir trecho único, criar, alterar, remover e validar. Alterações usam comparação de versão; texto descritivo não conta como edição. Secrets, workflows e configuração da Vercel são protegidos. Remover testes, reduzir asserções ou acrescentar skip/supressões é recusado. Alterar scripts de certificação é recusado, com uma exceção estrita: trocar `tsx --test` por `node --import tsx --test`, mantendo os mesmos argumentos e arquivos, para ambientes sem IPC. Isso não pula testes.

Projetos npm usam `npm ci`, `npm run typecheck`, `npm test` e `npm run build`, conforme seus scripts. Projetos estáticos possuem recibo de integridade próprio, sem alegação de testes npm. Alterações inesperadas em fonte durante comandos bloqueiam a entrega. Logs têm limite de 2 MiB por comando, exit code, duração e hashes; o modelo recebe trechos, enquanto o artefato privado preserva os logs limitados e redigidos.

Checkpoint após cada alteração, lease renovável e controles persistentes permitem retomar. Cancelamento/pausa interrompem processos e removem o container. Orçamento permanece limitado ao autorizado; reservas de dispatch recusado são liberadas. A liquidação é idempotente e recuperável após falha.

O editor possui pausa por projeto e controle global administrativo. Ao habilitar o controle global, até 20 pedidos pausados são retomados, respeitando pausas locais e orçamento já autorizado. Uma fila maior exige novas varreduras; não há promessa de retomada ilimitada em uma única requisição.

## Artefatos e publicação

Uma conclusão exige diff real e validações aprovadas na mesma versão. São preservados o ZIP integral, diff Git real, checksums, comandos e a versão de origem. Builds estáticos com `dist/index.html` podem gerar uma prévia portátil, com assets locais, sem acesso ao backend de produção. A prévia usa iframe opaco e bloqueia integrações externas. Uma adaptação de rotas/storage em memória é aplicada somente ao artefato de prévia; o código entregue não é reescrito para isso.

Caso o framework não gere uma prévia estática compatível, o estado é `validated`, com diagnóstico de adaptador pendente; não é declarado `ready`. Renderização e navegação real no browser são verificadas separadamente pela CI.

Entregar por GitHub é opcional e requer confirmação explícita, conta/instalação do dono com escrita e o mesmo repositório de origem. São criados blobs binários/textuais, árvore incremental, commit, branch exclusiva e PR em rascunho. O SHA da branch original precisa permanecer igual ao importado. Configuração da Vercel e branch principal não são sobrescritas; nenhum endpoint de merge ou deploy é chamado.

## Limites explícitos e implantação

- ZIP até 50 MiB, expansão até 250 MiB, arquivo até 20 MiB, até 20 mil entradas e armazenamento persistido até 250 MiB por usuário/tenant.
- Job até 30 minutos, 30 turnos do agente e orçamento confirmado. Código pode ser editado em arquivos de até 1 MiB por operação; leitura e busca são paginadas/limitadas.
- ZIP64, volumes, caminhos ambíguos, arquivos especiais e symlinks são recusados. Git LFS e submódulos ainda não têm resolução integral; o projeto é bloqueado com diagnóstico em vez de importado parcialmente.
- Executor npm requer lockfile v2/v3 e scripts originais typecheck/test/build. Outros gerenciadores, backends e frameworks exigem adaptadores adicionais.
- Importação pública usa a branch padrão. Reconciliar uma origem que avançou não é automático; a entrega para GitHub é bloqueada para preservar o código.
- Quotas e logs são persistentes. Limpeza/retention e aumento de quotas precisam de política operacional antes de escala ampla.
- Não foram provisionados serviços pagos nem alteradas configurações privadas da Vercel nesta sessão.

## Evidência e homologação

`scripts/project-development-acceptance.ts` importa a Marketing Engine real, confere todos os blobs da árvore Git, lê e edita o código original, executa validações e gera ZIP/prévia. Seu agente é uma fixture determinística de ferramentas, sem gasto com provedor. O modo normal exige Docker. A opção explícita `--trusted-native-acceptance` serve exclusivamente à verificação local autorizada da cópia pública; não está ligada ao produto nem constitui homologação do isolamento.

Nesta sessão o teste local encontrou EPERM no IPC do CLI tsx. A fixture reparou somente o carregador de testes, mantendo os 92 testes originais. Typecheck, testes e build foram aprovados. O modal de autenticação recebeu nome acessível por associação ao título. `vercel.json`, lockfile e assets foram preservados.

O ambiente desta sessão não fornece Docker; o teste de isolamento real é executado pela CI `development-isolation.yml`. A instalação local do Chromium também falhou no download. Nenhum desses checks é apresentado como aprovado localmente. A CI tem passos de isolamento real, aceitação do repositório e smoke em iframe opaco.

Critérios ainda pendentes até receber evidência remota: dispatch/job real do chat atualizado, chamadas reais do modelo no executor, isolamento Docker, navegação em Chromium e CI do commit da PR. Testes unitários verdes ou geração deste pacote não encerram a ordem P0.
