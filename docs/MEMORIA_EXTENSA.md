# Memoria extensa e continuidade da Froc.IA

O arquivo de conversas nao tem um teto total de mensagens definido no codigo.
Ele cresce em documentos separados no Firestore, sujeito a capacidade, cotas
e armazenamento do projeto. Isso nao torna infinita a janela do modelo nem
garante lembranca perfeita de todo fato em toda resposta.

## Comportamento

- O texto completo, apos remocao de credenciais, e dividido em partes de ate
  12 mil caracteres. Mensagens longas nao ficam reduzidas aos primeiros
  1.200 caracteres. Emojis nao sao divididos no meio.
- O arquivo e cifrado com AES-256-GCM, vinculado ao usuario e ao tenant.
  Sem chave configurada, nao ha fallback para salvar o arquivo em texto aberto.
- Ha busca semantica nos segmentos recentes e um indice lexical privado no
  acervo antigo. O indice utiliza HMAC por conta, sem palavras em texto aberto.
  As buscas sao independentes: uma consulta indisponivel nao apaga os resultados
  da outra. Os documentos sao conferidos antes da descriptografia.
- O estado cifrado da conversa preserva assunto, objetivos, preferencias,
  decisoes, restricoes e atualizacoes com o ID da mensagem de origem. Respostas
  curtas como "feito" e "acabei de fazer alteracoes" mantem o assunto anterior.
  Declaracoes antigas nao concedem permissoes nem executam comandos novamente.
- A migracao do historico usa paginas de 200 mensagens e cursor persistente.
  Cada chamada arquiva no maximo oito segmentos novos por lote; o restante
  continua pendente para a proxima consulta. O cursor avanca somente depois
  do arquivamento. As origens multipartes so sao marcadas na ultima parte.
- O carregamento normal preserva a janela recente e busca ate 12 segmentos
  relevantes. O orcamento do modelo continua controlado. O limite de contexto
  nao elimina o texto integral ja preservado no arquivo.
- Historicos antigos ainda precisam existir em `messages` para recuperar o
  texto que a versao anterior nao arquivou. Nao e possivel reconstruir um texto
  que ja tenha sido apagado de todas as origens.
- A exclusao da memoria extensa tambem limpa a continuidade derivada da conta.
  As conversas originais continuam sujeitas ao controle de exclusao de conversas.

## Configuracao e verificacao

O servidor publicado precisa de `MEMORY_ENCRYPTION_KEY`, secreta, estavel e de
alta entropia nas variaveis da Vercel. Uma secret existente somente no GitHub
Actions nao configura o servidor. Nao substitua uma chave ja usada: trocar a
chave sem uma migracao de criptografia torna o arquivo anterior ilegivel.

Se a chave nao existir, este comando no CMD gera uma nova chave aleatoria e
a coloca somente na area de transferencia do proprio computador:

```cmd
powershell -NoProfile -Command "$b=New-Object byte[] 32; $r=[Security.Cryptography.RandomNumberGenerator]::Create(); $r.GetBytes($b); $r.Dispose(); Set-Clipboard -Value ([Convert]::ToBase64String($b)); Write-Host 'Nova chave copiada. Use somente se nao existir uma chave anterior.'"
```

Cole como valor de `MEMORY_ENCRYPTION_KEY` em Settings > Environment Variables
do projeto `frocia2` na Vercel, para Production, e publique um novo deploy.
Nao envie a chave ao chat nem a grave no repositorio.

Com a conta administradora autenticada, a pergunta "Como esta a memoria da
Froc IA?" consulta a configuracao real do servidor sem gerar uma resposta
do modelo. A consulta nao prova que todo o historico ja foi migrado.

`GET /api/memories/long-term/stats`, autenticado, informa estatisticas e politica.
O resumo de estatisticas sinaliza `resultCapped` quando atinge 20 mil documentos
na consulta; esse limite de leitura nao limita o tamanho do arquivo.

## Controle pelo chat

Perguntas de acesso e ordens explicitas de manutencao da Froc.IA utilizam o
mesmo controle de servidor nas rotas SSE e sem streaming, antes de reservar
creditos ou chamar o modelo. As respostas mostram o recibo real, as credenciais
ausentes, o estado dos agentes e os bloqueios registrados. Elas nao prometem
um deploy apenas porque um pedido foi aceito.

O papel administrativo vem da sessao verificada pelo servidor. O texto "sou
o dono", mensagens anteriores e campos enviados no corpo nao concedem esse
papel. O acesso de escrita do executor e a credencial do servidor do chat
sao conferidos separadamente. Os fluxos normais dos demais usuarios continuam
no caminho de geracao da IA.

## Validacao e homologacao

Os testes locais cobrem texto de mais de 180 mil caracteres, emojis nas
fronteiras, interrupcao e retomada, 450 mensagens em paginas, fato anterior aos
mil segmentos recentes, isolamento entre contas, continuidade apos 500
atualizacoes curtas, estado cifrado fora da janela de 400 mensagens e controle
real das duas rotas HTTP com fixtures de Firestore/GitHub.

Esses testes nao utilizam credenciais de producao. A chave publicada, o login
administrativo, os indices ja existentes e as consultas reais do Firestore
precisam ser confirmados no ambiente publicado depois da aplicacao.
