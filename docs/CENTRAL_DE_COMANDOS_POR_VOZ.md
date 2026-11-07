# Central de Comandos do Site (voz e texto)

A Froc.IA agora opera o site inteiro por voz. Ligue o microfone no chat e fale normalmente
(com ou sem "Ok Froc"). Diga **"ajuda"** a qualquer momento para ver a lista completa na tela.

## Como funciona

1. A frase é interpretada no próprio navegador (`shared/siteCommandCatalog.ts`) — rápido e sem custo.
2. Se parecer uma ordem que não foi reconhecida, a IA do servidor escolhe o comando certo
   (`POST /api/site-commands/interpret`, só para usuários logados, com catálogo filtrado pelo papel).
3. O barramento (`src/services/siteCommandBus.ts`) executa a ação na tela correta, abrindo antes
   a tela necessária (ex.: painel admin → registro de prompts).
4. A Froc.IA fala o resultado e volta a ouvir. Um aviso aparece na tela.
5. Se não for um comando, a frase segue para a conversa normal com a IA (como antes).

O estúdio permanece montado (oculto) nas outras páginas para a escuta continuar ativa em todo o site.

## Segurança

- **Funções de administrador** (painel admin, métricas, prompts, avaliações, rastros, observabilidade,
  feature flags, backups/recuperação, autoevolução) só funcionam para conta admin. Para usuário comum
  elas nem aparecem na ajuda e a IA do servidor não as recebe no catálogo. As APIs continuam exigindo admin no servidor.
- **Exclusões e saída da conta** pedem confirmação falada: diga "confirmar" ou "cancelar" (vale por 45 s).

## Exemplos

| Área | Diga |
|---|---|
| Navegação | "abrir preços", "abrir integrações", "abrir meu painel", "voltar" |
| Conversas | "nova conversa", "abrir a conversa sobre vendas", "abrir a segunda conversa", "excluir esta conversa", "apagar todas as conversas", "quais são minhas conversas", "parar a resposta", "modo pesquisa" |
| Ferramentas | "abrir a câmera", "abrir gravador", "importar do github", "importar de url", "colar código", "abrir base de conhecimento", "abrir anexos" |
| Projetos | "novo site", "abrir o projeto loja", "excluir este projeto", "exportar o site", "favoritar", "abrir configurações do projeto" |
| Visualização | "mostrar o código", "ver a prévia", "ver no celular", "tela cheia", "modo claro" |
| Menu | "abrir o menu", "mostrar meus projetos", "abrir modelos prontos", "abrir suporte" |
| Conta | "trocar o modelo", "abrir memórias", "trocar minha foto", "fazer login", "sair da conta" |
| Admin | "abrir o painel admin", "abrir métricas", "abrir registro de prompts", "abrir feature flags", "abrir backups", "abrir autoevolução" |
| Sistema | "fechar", "fechar tudo", "recarregar a página", "verificar o site", "ajuda" |

"**verificar o site**" testa na hora se cada comando está ligado, se o servidor responde, a sessão,
o acesso admin e o microfone. Para auditoria profunda do código, diga "audite o site" (fluxo existente).

## Para desenvolvedores

- Nova ação: adicione no catálogo (`SITE_COMMANDS`) e registre com `useSiteCommand('id', handler)` no componente dono do estado.
- O teste `tests/siteCommandCenter.test.ts` falha se algum comando do catálogo não tiver ação registrada.
- Automação/testes no navegador: `await window.frocSiteCommand('abrir preços')`.
