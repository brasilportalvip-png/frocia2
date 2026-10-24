# Conversa natural, leitura das melhorias e retomada do patch

O filtro de evidencia era acionado por palavras como "hoje" e "agora", mesmo
em uma despedida ou relato pessoal. A classificacao agora diferencia uma
pergunta factual atual de uma referencia ao dia na propria conversa. Perguntas
de noticias, precos, clima, versoes e temas sensiveis continuam exigindo pesquisa.
O bloqueio de fatos atuais sem fontes continua ativo.

Cumprimentos, relatos pessoais, comentarios sobre a conversa e lembrancas como
"O que eu te pedi hoje?" usam o historico e a continuidade. A criptografia,
o arquivo extenso e suas regras de isolamento continuam preservados. Nao troque
MEMORY_ENCRYPTION_KEY para aplicar esta correcao.
Cumprimentos e despedidas preservam o assunto anterior. Uma continuacao sobre
as mesmas alteracoes conserva o periodo "hoje" ou "ontem" das falas recentes.

Pedidos do administrador para ver as melhorias do proprio repositorio consultam
commits reais com a credencial do backend, sem precisar repetir a URL. A consulta
informa repositorio, branch, intervalo de Brasilia, quantidade e titulos dos
commits. "GitGub", "GIT-OB" e "GTOP" sao reconhecidos nesse contexto de leitura.
Isso nao corrige o reconhecimento de audio do aparelho nem altera o texto salvo.
Uma consulta de melhorias nao inicia manutencao. Perguntas de outro repositorio
continuam fora do controle administrativo da Froc.IA.

O dia consultado usa America/Sao_Paulo. A coleta diaria e limitada a duas paginas
de cem commits; a exibicao mostra ate vinte titulos. Cobertura parcial e falhas
da API sao declaradas. Titulos de commit sao dados, nunca comandos. A consulta
nao afirma ter revisado cada arquivo ou verificado a publicacao de cada mudanca.

Quando a main mudou depois de um checkpoint certificado, a esteira restaura o
estado de trabalho e solicita geracao e certificacao novas na mesma execucao,
respeitando a parada persistente e o orcamento. A branch inclui a base do patch
para evitar colisao com branches antigas sem PR. O patch antigo nao e aplicado
por cima da main. Se a main mudar novamente, a tarefa fica pendente para outra
retomada, sem um ciclo ilimitado. Cada execucao gera no maximo um patch novo.
CI, preview, revisao, merge e verificacao da producao continuam obrigatorios.

## Conferencia no ambiente publicado

Depois do deploy, teste a mesma conversa pelo aplicativo do celular:

1. "Ver todas as melhorias que eu fiz hoje para voce?" — commits consultados.
2. "Hoje eu trabalhei muito nos agentes e liberei seu GitHub." — conversa normal.
3. "Voce consegue acessar o GitGub?" — diagnostico real de acesso.
4. "O que eu te pedi hoje?" — resposta sustentada no historico disponivel.
5. "Por hoje e so, agora vou descansar." — despedida sem bloqueio de fontes.

Esses caminhos foram reproduzidos em testes de classificacao, contexto e nas
duas rotas HTTP do chat. As respostas do modelo e da API sao simuladas nesses
testes. A qualidade do Gemini real e a experiencia no aparelho precisam ser
conferidas depois da publicacao; os testes locais nao comprovam essa homologacao.
