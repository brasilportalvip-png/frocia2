# Froc.IA — fábrica profissional e equipe de 85 agentes

Implementação de 24/10/2026, sobre a base ecd390d85afedb5fb4af7565fc05f7ac0b658b23.

## O que mudou

A criação de projetos da interface passa a iniciar uma construção persistente de frontend e backend, em vez de terminar apenas em um HTML isolado. Os 20 agentes anteriores são preservados. Foram acrescentados 15 especialistas de inteligência e 50 especialistas de criação: 85 perfis únicos no catálogo e no conhecimento do projeto.

Cada novo perfil tem missão, método, entregas e critérios de aceitação. Um protocolo comum exige contexto, decisões justificadas, dependências, casos extremos, segurança, evidências e verificação. Os 15 de inteligência são selecionados por domínio e complexidade na conversa. Os 50 de criação participam em dez disciplinas; cada disciplina precisa registrar os cinco pareceres específicos do projeto. Estes perfis usam os modelos configurados; não são 65 modelos independentes.

## Fluxo implementado

1. Receber o pedido, orçamento e anexos autenticados. Salvar a tarefa com chave idempotente e projeto/usuário/tenant.
2. Planejar descoberta, experiência, frontend, backend, comércio, conteúdo/SEO, mídia, segurança, verificação e entrega.
3. Gerar os arquivos React/TypeScript, funções API, testes, requisitos e jornadas. A revisão recebe a implementação completa e pode recusá-la.
4. Gerar imagens e acompanhar operações reais do Veo pelo Google Cloud, quando pedidos, com arquivos finais no Storage e recibos. A mídia tem reserva e confirmação de créditos próprias; falhas sem entrega liberam a reserva e têm repetição limitada.
5. Acrescentar configuração pública em tempo de execução, páginas de termos/privacidade/cookies com dados do responsável, consentimento granular, manifest, ícone, service worker, offline honesto, robots e sitemap XML por ambiente.
6. Solicitar dados e credenciais no painel. Criptografar os valores com a MEMORY_ENCRYPTION_KEY existente; separar prévia e produção; mascarar segredos e bloquear exposição pública incompatível. Nenhum segredo é enviado ao modelo ou ao ZIP do projeto.
7. No executor isolado, instalar dependências e executar tipos, testes, build, navegador e auditoria de dependências. Atestar o hash do artefato com assinatura HMAC e a lista de comandos executados.
8. Criar um projeto Vercel específico para o projeto gerado, aplicar variáveis do ambiente e publicar a prévia. Projetos públicos recém-criados são configurados para não exigir login na conta Vercel; a autenticação do aplicativo continua sendo responsabilidade de sua implementação.
9. Testar páginas em 360/768/1440, acessibilidade, teclado, imagens visíveis, links internos, consentimento, jornadas e saúde das integrações. Contas de teste usam somente variáveis TEST_* do próprio projeto.
10. Para pagamentos, confirmar o sandbox e a credencial de produção pelo provedor. O verificador não efetua cobrança de produção. Stripe pode criar uma operação exclusivamente de teste; Mercado Pago requer TEST_PAYMENT_ID de pagamento aprovado na conta de teste.
11. Publicar produção, verificar a versão, repetir jornadas e confirmar o domínio associado ao deployment. Recuperar a versão anterior se a nova falhar, sem substituir um deployment posterior de outra operação.
12. Registrar a submissão ao IndexNow e, quando configurado, ao Search Console. Submissão não garante indexação nem posição.
13. Mostrar a entrega como pronta somente após essas verificações. Permitir exportar o projeto completo, solicitar alterações e reaplicar configurações sem refazer chamadas ao modelo quando o código não mudou.
14. Monitorar versões publicadas e saúde das integrações, registrando alertas de indisponibilidade sem efetuar compras ou cobrar novas gerações automaticamente.

A tarefa usa checkpoints, exclusão por lease, proteção contra concorrência, reparos limitados e idempotência de cobrança. JSON interrompido não vira artefato aprovado. Mudanças no scaffold invalidam a certificação anterior e exigem novos testes.

## Automação

O novo workflow `.github/workflows/professional-factory.yml` aceita disparo pelo backend e verifica tarefas pendentes a cada 20 minutos. O disparo imediato depende de Actions:write na credencial usada pelo backend. As tarefas continuam salvas se o navegador for fechado.

O workflow de manutenção existente, seu horário de 09h17 e sua recuperação permanecem intactos. A nova fábrica tem sua própria fila e concorrência.

## Configuração da infraestrutura

No GitHub Actions, configure as secrets usadas pelo workflow:

- FIREBASE_SERVICE_ACCOUNT_KEY: mesma conta de serviço autorizada para o banco/Storage da plataforma.
- MEMORY_ENCRYPTION_KEY: EXATAMENTE o valor já usado pela Vercel. Não gerar outro nem rotacionar para esta atualização.
- GEMINI_API_KEY e, se usada separadamente, GEMINI_MEDIA_API_KEY.
- FIREBASE_STORAGE_BUCKET e, opcionalmente, FIREBASE_PROJECT_ID.
- VERCEL_TOKEN; VERCEL_TEAM_ID quando os projetos pertencem a uma equipe.
- SELF_EVOLUTION_WORKER_TOKEN e SELF_EVOLUTION_WORKER_SIGNING_SECRET: par de autenticação/assinatura do executor.

Para vídeo Veo: VEO_VERTEX_PROJECT_ID pode ser configurada como variável; o projeto da conta de serviço é usado como alternativa. VEO_VERTEX_MODEL tem padrão veo-3.1-generate-001. O Google Cloud precisa ter a API correspondente, faturamento e permissões Vertex/Storage autorizados para a conta de serviço. Um erro de permissão impede a entrega; não é apresentado como vídeo gerado.

As credenciais do negócio de cada cliente ficam na aba Variáveis do projeto, não nas secrets da plataforma. Para áreas com login, preencher as contas de teste solicitadas. Os valores de teste e produção são separados; segredos não são devolvidos ao navegador depois de salvos.

Em domínio próprio, o domínio precisa estar configurado na Vercel para o projeto gerado. O padrão sugerido é o domínio gerenciado do novo projeto. A fábrica não declara domínio próprio confirmado antes da associação real.

## Verificação e limites materiais

- Os testes automatizados e resultados locais estão na pasta `verificacao` do ZIP.
- Um projeto técnico foi materializado pela função real de scaffold e passou por instalação limpa, tipos, testes, build e auditoria de dependências de produção.
- O navegador local não foi executado com sucesso: o download do Chromium falhou neste ambiente. Os testes de navegador estão no CI e no instalador CMD; precisam passar no ambiente de aplicação.
- As chamadas externas de publicação/pagamentos foram verificadas em testes de protocolo com provedores controlados. Não houve publicação real, cobrança real, geração real de mídia nem homologação com a conta do proprietário nesta sessão.
- A tentativa de criar branch nesta sessão foi recusada pelo GitHub com HTTP 403, Resource not accessible by integration. Por isso o pacote inclui o fluxo pelo CMD do proprietário.
- Este fluxo entrega sites e aplicativos web instaláveis/PWA. Não é uma cadeia de assinatura e publicação de .aab/.ipa nas lojas.
- Um projeto não recebe garantia universal de ausência de falhas. Dados, escopo, credenciais e serviços precisam ser válidos; as verificações registram o que foi comprovado e bloqueiam o que falhar.

## Base preservada

Os arquivos de memória, continuidade e criptografia existentes não foram substituídos. Nenhum token ou valor de configuração foi alterado por este pacote. O workflow de autoevolução anterior não foi editado. A aplicação pelo CMD cria uma branch e uma pasta separadas; não sobrescreve o checkout atual nem envia diretamente para main.
