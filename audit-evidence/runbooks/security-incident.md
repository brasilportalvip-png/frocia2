# Runbook de incidente de segurança

Este procedimento não transforma um alerta em incidente resolvido automaticamente. Incidentes `high` e `critical` permanecem abertos até uma transição autenticada no endpoint administrativo.

## Cross-site

1. Localize o `correlationId`, origem e rota em `security_events`.
2. Confirme `APP_URL` e `TRUSTED_ORIGINS`; não libere curingas.
3. Revogue sessões afetadas quando houver indício de uso indevido.
4. Contenha, repita o teste adversarial e registre a evidência.

## Input

1. Preserve o payload somente em ambiente isolado e sem dados pessoais.
2. Identifique chave proibida, profundidade ou tipo de conteúdo.
3. Não reduza limites sem análise de risco.

## Abuse

1. Agrupe por fingerprint, usuário, tenant e rota.
2. Aplique bloqueio temporário e investigue automação maliciosa.
3. Não inclua tokens, cookies nem corpo integral no incidente.

## Identity

1. Verifique revogação ou desativação no Firebase Auth.
2. Revogue sessões e claims indevidas antes de reabrir acesso.
3. Confirme isolamento do tenant afetado.

## Prompt injection

1. Isole a fonte externa e preserve apenas digest e URL.
2. Confirme que o conteúdo não alcançou instruções do sistema.
3. Adicione o caso à suíte adversarial antes de resolver.

## Secrets

1. Revogue a credencial no provedor imediatamente.
2. Gere novo segredo e atualize apenas o gerenciador de ambiente.
3. Inspecione logs e histórico Git; remova o segredo exposto sem destruir evidências.

## Provider

1. Bloqueie retry de operações mutáveis com resultado incerto.
2. Consulte o recibo diretamente no provedor.
3. Reconcilie antes de liberar cobrança, publicação ou entitlement.

Um incidente só pode receber `resolved` com resumo concreto da causa, contenção e validação posterior.
