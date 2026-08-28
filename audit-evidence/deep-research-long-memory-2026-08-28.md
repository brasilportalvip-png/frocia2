# Pesquisa profunda e memória extensa — 2026-08-28

## Escopo entregue

- Pesquisa já existente na web, em URLs e em sites inteiros foi preservada.
- Pesquisa social oficial passou a cobrir YouTube, X, Reddit, Instagram,
  Facebook, TikTok e Bluesky; LinkedIn continua explicitamente indisponível
  para busca pública genérica sem produto e caso de uso aprovados.
- Pedidos com intenção de pesquisa profunda usam até 10 resultados por rede e
  são classificados como evidência limitada quando não alcançam duas fontes
  independentes.
- Histórico longo passou a ser convertido incrementalmente em segmentos
  criptografados AES-256-GCM, sempre vinculados ao usuário, tenant, conversa e
  projeto.
- Cada segmento preserva os IDs das mensagens originais; os textos originais
  continuam na coleção de mensagens até exclusão explícita da conversa.
- Até 250 segmentos recentes são avaliados por solicitação e somente os seis
  mais relevantes podem entrar no contexto. Isso aumenta a memória persistente
  sem ultrapassar silenciosamente a janela do modelo.
- A criação de uma conversa compacta a conversa anterior, inclusive quando ela
  ainda não possuía mensagens antigas suficientes para o resumo incremental.
- O painel de memórias exibe quantidade de segmentos, conversas e mensagens
  preservadas e permite excluir a memória compactada.
- Padrões de credenciais são removidos antes da compactação, e a coleção de
  segmentos permanece inacessível diretamente pelo cliente.

## Evidência técnica

- Commit de implementação: `67221bb`.
- Branch: `feat/prompt-master-universal-research-long-memory-20260828`.
- Base: `origin/main` no merge `63aa219`.
- Arquivos específicos de teste: 4 aprovados, 39 testes aprovados.
- Suíte completa: 33 arquivos aprovados, 306 testes aprovados.
- TypeScript: aprovado com `tsc --noEmit`.
- Build: Vite e bundle do servidor aprovados.
- Integridade de produção: 157 arquivos aprovados, sem catch vazio, mocks,
  execução dinâmica ou segredos hardcoded.
- Tracker: 563 requisitos e 563 IDs únicos.
- Dependências de produção: nenhuma vulnerabilidade alta ou crítica; seis
  moderadas transitivas em `uuid` pela cadeia do Firebase Admin. O reparo
  sugerido por `npm audit --force` rebaixaria o Firebase Admin com breaking
  change e não foi aplicado.

## Testes adversariais relevantes

- Segmentação determinística de históricos grandes e referência às mensagens.
- Mensagem já arquivada não é duplicada.
- Credenciais são removidas antes da criptografia.
- Recuperação prioriza conversa e projeto atuais e exige relevância para outra
  conversa.
- Contexto identifica memória recuperada como dado não confiável.
- Persistência contém somente ciphertext AES-GCM, nunca o texto aberto.
- Bluesky usa AppView público oficial, preserva autor, data, métricas e
  permalink.
- Pesquisa profunda com uma única origem termina como limitada, sem promessa
  de cobertura integral.

## Limites e bloqueadores honestos

- Não existe acesso literal a toda a internet. Login de terceiros, CAPTCHA,
  paywall, conteúdo privado, apagado ou negado pelos termos da plataforma não
  são contornados.
- X, Instagram/Facebook, Reddit e TikTok continuam dependendo de credenciais,
  plano, escopos e aprovação do provedor. Configuração não equivale a
  homologação ao vivo.
- YouTube Data API fornece metadados e resultados públicos; transcrição de todo
  vídeo de terceiros não é garantida pela API de pesquisa.
- LinkedIn não oferece busca pública genérica para qualquer aplicativo e
  permanece indisponível sem produto aprovado.
- A memória persistente pode crescer com o histórico, mas cada resposta ainda
  respeita a janela de contexto do modelo. Recuperação é seletiva, não a
  injeção de todo o banco em uma única chamada.
- Segmentos anteriores à implantação exigem uma nova interação ou criação de
  conversa para iniciar a compactação; uma migração integral de históricos
  antigos ainda não foi executada.
- Não há revisão independente nem homologação em preview/produção nesta branch;
  por isso nenhum requisito foi marcado como `VERIFIED`.

## Hotfix após homologação do preview

O primeiro teste vivo do PR confirmou o grounding web, mas também revelou três
falhas que impediam o merge: o AppView público `public.api.bsky.app` respondeu
403, as fontes web eram exibidas como redirecionamentos do Google e uma falha
de cota do Gemini aparecia como JSON bruto. O hotfix corrige esses pontos sem
transformar bloqueios externos em sucesso:

- Bluesky consulta primeiro `api.bsky.app`, host oficial funcional para leitura
  pública, e mantém o segundo AppView apenas como fallback.
- Chamadas sociais enviam `Accept` e um `User-Agent` identificável.
- Redirecionamentos de grounding são resolvidos com limite de tempo e saltos;
  cada destino é revalidado como HTTPS público antes de entrar na resposta.
- Destinos privados, loopback e HTTP são recusados e o redirecionamento original
  permanece visível quando não pode ser resolvido com segurança.
- A execução tenta toda a cadeia deduplicada de modelos de fallback e registra
  todos os modelos realmente tentados.
- Erros de cota, autorização e timeout do Gemini são convertidos em mensagens
  públicas controladas, sem devolver o JSON interno do provedor.

Evidência local do hotfix: 45 testes específicos aprovados, 312/312 testes da
suíte completa aprovados, tipagem aprovada, build de produção aprovado e
tracker preservado com 563 requisitos e 563 IDs únicos. O YouTube continua
dependendo da variável externa `YOUTUBE_DATA_API_KEY` habilitada em Production
e Preview; as demais redes autenticadas continuam dependendo dos planos,
credenciais e aprovações descritos acima.

## Correção complementar da rota usada pela interface

O teste vivo seguinte mostrou que a interface usa streaming e que o resolvedor
de URLs ainda estava conectado somente à execução síncrona. Também revelou que
o texto completo das instruções era enviado como consulta às APIs sociais. A
correção complementar:

- aplica o resolvedor seguro de URLs também ao fluxo SSE usado pelo chat;
- extrai o assunto solicitado antes de consultar YouTube e Bluesky;
- aceita `YOUTUBE_DATA_API_KEY`, `YOUTUBE_API_KEY` ou
  `GOOGLE_YOUTUBE_API_KEY`, sem registrar o valor;
- adiciona cabeçalhos compatíveis com o AppView do Bluesky e permite fallback
  autenticado opcional por senha de aplicativo;
- documenta `BLUESKY_IDENTIFIER` e `BLUESKY_APP_PASSWORD` sem exigir nem
  armazenar a senha principal da conta.

Evidência local complementar: 29 testes direcionados aprovados, 315/315 testes
da suíte completa aprovados, tipagem e build aprovados, integridade validada em
158 arquivos e tracker preservado com 563 IDs únicos.
