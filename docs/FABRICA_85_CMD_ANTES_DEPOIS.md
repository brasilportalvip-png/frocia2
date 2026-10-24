# Arquivos, antes/depois e CMD

Execute o instalador na pasta extraída do novo pacote:

```cmd
APLICAR_FABRICA_85.cmd
```

O instalador pede a pasta do repositório, verifica a base, cria um worktree separado, aplica o patch, instala dependências e roda tipos, testes e build. Uma falha interrompe o processo. O envio da branch fica no comando separado `ENVIAR_BRANCH_85.cmd`, após a conferência dos resultados. Não há push direto para main nem merge automático.

| Arquivo | Antes | Depois |
| --- | --- | --- |
| shared/advancedAgentCatalog.ts | Ausente | 15 perfis de inteligência + 50 de criação, com missões, método, entregas e aceitação |
| shared/agentExecutionProtocol.ts | Ausente | Direcionamento comum e contrato específico de cada disciplina |
| server/agents/intelligenceTeamService.ts | Ausente | Seleção das perspectivas pertinentes à conversa |
| server/ai/requestOrchestrator.ts | Política anterior de domínio | Acrescenta direções sem remover roteamento ou ferramentas existentes |
| server/siteFactory/professionalBuildService.ts | Ausente | Etapas persistentes, 50 pareceres, geração, revisão, cobrança, retomada e certificação |
| server/siteFactory/professionalContract.ts | Ausente | Contrato de arquivos, variáveis, jornadas e cobertura; hash estável do artefato |
| server/siteFactory/professionalScaffold.ts | Ausente | Projeto executável, configuração, políticas, cookies, PWA, robots, sitemap e testes |
| server/siteFactory/professionalAdapters.ts | Ausente | Executor assinado, pagamentos, prévia, produção, domínio, recuperação e busca |
| server/siteFactory/professionalMediaService.ts | Ausente | Imagens e operações Veo com entrega e créditos verificáveis |
| server/siteFactory/professionalMonitoringService.ts | Ausente | Saúde dos projetos publicados e alertas |
| server/siteFactory/projectVariableService.ts | Ausente | Cofre por projeto/usuário/tenant e ambiente, com controle de revisão |
| server/routes/professionalFactoryRoutes.ts | Ausente | Criar, acompanhar, retomar, cancelar, alterar, reconfigurar e exportar |
| server/routes/projectVariableRoutes.ts | Ausente | Leitura mascarada e gravação autenticada das variáveis |
| worker/professional-factory.mjs | Ausente | Comandos isolados e verificação real por navegador |
| scripts/professional-factory-runner.ts | Ausente | Retomada da fila e monitoramento |
| .github/workflows/professional-factory.yml | Ausente | Workflow próprio da fábrica |
| src/components/ProfessionalBuildPanel.tsx | Ausente | Progresso, configurações, resultados e entrega |
| src/components/ProjectConfigurationPanel.tsx | Ausente | Abas de variáveis, agentes e certificação |
| src/App.tsx | Criador termina em HTML | Criador inicia a fábrica e acompanha o projeto completo |
| src/components/PreviewFrame.tsx | Prévia HTML | Abre o endereço real quando o projeto profissional está publicado |
| src/components/SandboxedSiteFrame.tsx | Sandbox HTML local | Preserva o legado e apresenta o projeto publicado para uso completo fora do sandbox |
| src/services/apiClient.ts | Download de imagem/vídeo | Acrescenta download ZIP sem converter bytes em texto |
| server/routes/projectRoutes.ts | Lista anterior | Acrescenta identificação da construção e URL publicada |
| server/selfEvolution/selfSiteKnowledgeService.ts | 20 agentes | 85 perfis únicos |
| server/selfEvolution/githubAutomationService.ts | Disparo da manutenção | Acrescenta disparo específico da fábrica |
| server/services/portableRecoveryService.ts | Backup anterior | Acrescenta filas, cofre, mídias e alertas da fábrica |
| firestore.rules | Regras anteriores | Protege as coleções novas e marcadores de entrega gerenciados pelo backend |
| server/ai/providers/geminiProvider.ts | Opções anteriores | Acrescenta limite de saída/esquema opcional sem mudar o stream existente |
| server.ts | Rotas anteriores | Monta as APIs novas |
| src/components/self-evolution/SelfEvolutionDashboard.tsx | Catálogo anterior | Exibe os 85 e suas direções |

Exemplos de comandos para abrir os arquivos na pasta de revisão:

```cmd
notepad server\siteFactory\professionalBuildService.ts
notepad server\siteFactory\professionalAdapters.ts
notepad shared\advancedAgentCatalog.ts
notepad shared\agentExecutionProtocol.ts
notepad .github\workflows\professional-factory.yml
notepad docs\EQUIPE_85_ESTADO_REAL.md
```

O arquivo `ALTERACOES.patch` contém o antes/depois integral. A pasta `frocia2-completo` contém a cópia do código-fonte completo, sem dependências instaladas, credenciais ou histórico Git.
