# Controle da autoevolução diária

O painel administrativo, na aba Autoevolução, oferece o controle **Ligar / Desligar**. Ele consulta e salva o estado do servidor; não depende da sessão do navegador.

- **Ligar** habilita o workflow de autoevolução no GitHub e, após confirmar o estado, libera a manutenção no aplicativo. Isso permite a rodada diária e suas retomadas, sem iniciar uma rodada imediatamente.
- **Desligar** salva primeiro a pausa no aplicativo, desabilita o workflow no GitHub e solicita o cancelamento das execuções existentes desse workflow. Outros workflows, o site e o chat continuam disponíveis.
- Se o GitHub recusar a ativação, a manutenção permanece pausada. Se o desligamento no GitHub ou algum cancelamento não for confirmado, o painel informa a pendência e oferece concluir o desligamento.
- A Parada de Emergência usa o mesmo controle persistente e o mesmo desligamento externo.
- O gerador de código e os revisores de IA verificam a pausa antes de enviar uma nova solicitação. Chamadas já enviadas a um provedor podem terminar e ser cobradas; o controle não estorna cobranças anteriores.

As mudanças exigem um administrador autenticado. O registro mantém autor, horário, motivo e o retorno do GitHub. O GitHub App ou token já configurado na Vercel precisa de Actions com escrita. A confirmação depende das operações reais; uma chave configurada, por si só, não prova o desligamento.

A leitura do estado não mantém uma pausa antiga em cache depois que outra instância confirma a retomada. Se não for possível confirmar a configuração persistente, os caminhos pagos permanecem bloqueados. A checagem de conexão com o GitHub também recebe um limite de dois minutos para evitar o bloqueio prolongado observado na execução #72.

O orçamento em créditos do painel não é uma medição da fatura em reais do provedor. Este controle atua sobre a manutenção e a autoevolução; o consumo normal do chat e outros serviços tem controles próprios.

Validação local: 1.056 testes passaram em 139 arquivos, incluindo cliques reais no botão, autorização administrativa, persistência, bloqueio dos caminhos pagos e respostas simuladas da API do GitHub. Nenhum modelo pago foi chamado nos testes. A confirmação em produção depende de instalar a alteração e observar o retorno do controle no painel.
