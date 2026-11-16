# Auditoria da Froc.IA — 16/11/2026

## Como foi feita (e o limite dela)

- O código tem cerca de 90 mil linhas (servidor, telas e testes). A revisão foi por ordem de risco:
  1. segurança das rotas;
  2. dinheiro;
  3. o "cérebro" da conversa;
  4. as telas principais;
  5. a comparação com o Claude.
- **Revisado a fundo:**
  - todas as 30 famílias de rotas da API (login, dono do projeto, admin, rotas internas);
  - o webhook do Mercado Pago;
  - a reserva e devolução de créditos na conversa e no criador;
  - as regras do Firestore e do Storage;
  - a montagem do contexto da IA (instruções, memória, histórico);
  - o fluxo da conversa com pesquisa e verificação;
  - o novo criador de sites.
- **Revisado por amostragem:** o painel admin, a auto-evolução e as mídias (imagem e vídeo).
- **Não foi possível neste ambiente:**
  - abrir a Froc.IA no ar;
  - rodar a suíte inteira de testes, que roda no instalador e no GitHub.

## O que está bom (nível profissional)

- **Rotas protegidas.** Toda rota de dados exige login. As rotas de admin exigem papel de admin. Leituras de conversas e projetos conferem o dono.
- **Pagamentos.** O webhook do Mercado Pago:
  - confere a assinatura (HMAC) com prazo de validade;
  - consulta o pagamento oficial de novo;
  - compara valor e moeda;
  - credita uma vez só (sem crédito em dobro);
  - trata estorno e chargeback.
- **Créditos.** São reservados antes, confirmados só no sucesso e devolvidos na falha. Reservas abandonadas expiram por rotina interna.
- **Firestore e Storage.** Tudo fechado por padrão. Cada pessoa só lê os próprios arquivos.
- **Contexto da IA.**
  - Conteúdo de páginas, documentos e memória é tratado como "dado não confiável", o que protege contra injeção de instruções.
  - Há corte de contexto controlado e as mensagens mais recentes são preservadas.
- **Checagens automáticas no GitHub.** Rodam a cada mudança: integridade (sem catch vazio, sem segredo no código), tipagem, inicialização da API, testes e build.

## Problemas encontrados e corrigidos neste pacote

| # | Gravidade | Problema | Correção |
|---|---|---|---|
| 1 | Alta (segurança) | As rotas internas (`/api/internal/*`: backups, migrações, expirar reservas, reconciliar pagamentos) aceitavam um segredo padrão que está escrito no código público, caso a `INTERNAL_CRON_SECRET` não estivesse configurada na Vercel. | Em produção, esse segredo padrão nunca vale. Sem segredo de verdade, as rotas ficam fechadas. |
| 2 | Alta (qualidade) | A IA não recebia a data e a hora atuais. Por isso errava "que dia é hoje", idades e prazos, e nunca sabia se devia dizer bom dia, boa tarde ou boa noite (a instrução dela pedia isso). | Toda conversa recebe a data, a hora de Brasília e o período do dia. |
| 3 | Média (qualidade) | Faltava um padrão de resposta no nível do Claude. | Nova seção de qualidade, que pede para: começar pela resposta; ajustar o tamanho ao pedido; não bajular; corrigir com gentileza; reconhecer erros; conferir contas; código completo; cuidado em saúde, dinheiro e leis (com o CVV 188 em risco de vida); recusar ajudar a causar dano. |
| 4 | Média (honestidade) | A instrução dizia que a Froc "faz tudo", o que empurra a IA a prometer o que não faz. | Trocado pela lista real do que ela faz. A regra de nunca recusar imagem, vídeo e site continua. |
| 5 | Média (experiência) | Quando a resposta precisava de pesquisa ou conferência, a tela ficava só em "Processando com raciocínio profundo" por 10 a 40 segundos, sem dizer o que acontecia. | A tela agora mostra a etapa real: "Pesquisando na internet e conferindo as fontes…", "Lendo o repositório no GitHub…", "Analisando o site…", "Conferindo a resposta antes de mostrar…". |
| 6 | Média (dinheiro e confiança) | O criador de sites cobrava créditos sem mostrar o valor antes. | Abaixo da caixa de texto aparece "Criar o site: 95 créditos" ou "Cada alteração: 30 créditos", com o aviso de que voltam se der erro. |

## Comparação: Claude x Froc.IA

| Recurso | Claude | Froc.IA hoje | Situação |
|---|---|---|---|
| Conversa natural, tom e honestidade | Sim | Sim, com política própria | Reforçado nesta auditoria |
| Saber a data e a hora atuais | Sim | **Não tinha** | Corrigido |
| Pesquisa na internet com fontes | Sim, em várias etapas | Sim (pesquisa do Google com fontes conferidas) | Bom |
| Usar ferramentas em sequência (pesquisar, ler, pesquisar de novo) | Sim | Parcial: decide as ferramentas antes de responder, numa etapa só | Recomendação 1 |
| Fazer contas e analisar planilhas executando código | Sim | Não | Recomendação 2 |
| Ler arquivos (PDF, imagem, ZIP, GitHub) | Sim | Sim | Bom |
| Memória entre conversas | Sim | Sim, criptografada | Bom |
| Criar sites e apps com prévia ao vivo | Sim | Sim (novo criador) | Bom |
| Publicar com link | Sim | Sim, na Vercel de cada pessoa | Bom |
| Criar imagem e vídeo | Sim | Sim | Bom |
| Voz | Sim | Sim (voz neural) | Bom |
| Gerar documentos e planilhas para baixar | Sim | Parcial (ZIP de código e artefatos) | Recomendação 3 |
| Mostrar o que está fazendo enquanto pensa | Sim | **Não mostrava** | Corrigido |

## Próximas melhorias recomendadas (por prioridade)

1. **Ferramentas em sequência.** Deixar a IA pedir uma ferramenta no meio da resposta (pesquisar de novo, abrir outro link, ler outro arquivo) e continuar depois. É o que mais aproxima a Froc do Claude em perguntas difíceis.
2. **Execução de código para contas e planilhas.** Ligar a execução de código do Gemini quando a pergunta envolver cálculo ou dados. Acaba com erro de conta.
3. **Exportar resposta como documento.** Botão para baixar a resposta em Word ou PDF.
4. **Painel admin.**
   - Mostrar num só lugar a saúde das variáveis obrigatórias: `INTERNAL_CRON_SECRET`, `CRON_SECRET`, `MEMORY_ENCRYPTION_KEY`, Mercado Pago, Gemini.
   - Mostrar o custo de IA por dia.

## Variáveis que precisam estar na Vercel da Froc.IA

- **`INTERNAL_CRON_SECRET`:** pelo menos 16 caracteres. Sem ela, as rotinas internas ficam fechadas.
- **`CRON_SECRET`:** pelo menos 32 caracteres. É usada pelos agendamentos da Vercel.
- **`MEMORY_ENCRYPTION_KEY`:** necessária para a memória e para conectar a Vercel de cada pessoa.
- **Mercado Pago:** `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET`.
- **Gemini:** `GEMINI_API_KEY`.
