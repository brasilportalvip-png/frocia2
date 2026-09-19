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

Sem firewall de saída e isolamento do provedor, a capacidade deve permanecer
desativada. O sistema falha fechado e não apresenta execução simulada como real.

## Limite importante

O isolamento por UID e contêiner reduz exposição, mas código hostil deve ser
executado em microVM/pod descartável por job para uma fronteira mais forte. Essa
camada depende da infraestrutura escolhida e não pode ser criada apenas pelo ZIP.
