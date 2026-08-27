# Evidências — memória privada e execução durável

Data: 27/08/2026  
Commit de implementação: `fd57c51`  
Base: `origin/main` em `3083ef2`

## Escopo implementado

### Memória, privacidade e contexto

- Isolamento de memória por usuário, tenant, projeto e conversa, com tenant derivado de claim autenticada.
- Consentimento explícito, finalidade, sensibilidade, retenção, validade, origem, confiança e escopo.
- Bloqueio de credenciais, tokens, chaves privadas, JWT e dados completos de cartão.
- Criptografia de aplicação AES-256-GCM para memória pessoal quando `MEMORY_ENCRYPTION_KEY` está configurada.
- Falha fechada: memória pessoal não é persistida se a chave de criptografia estiver ausente.
- Memória pessoal não pode ser compartilhada no escopo da organização.
- Consulta relevante por escopo e termos, com motivo de recuperação e auditoria sem conteúdo sensível.
- Visualização, correção, pausa, exportação, exclusão individual e exclusão total pelo usuário.
- Resumo extrativo de conversas longas, preservando decisões e referências às mensagens originais.
- Corte explícito de histórico, memória e RAG para respeitar limite de contexto; a requisição falha fechada se nem a mensagem atual couber.
- Acesso direto do cliente às coleções de memória, auditoria e execução durável negado pelas regras do Firestore.

### Execução durável

- Máquina com estados `created`, `validated`, `authorized`, `resources_reserved`, `running`, `result_received`, `result_persisted`, `resources_committed`, `verified`, `completed`, `failed`, `cancelled`, `compensation_pending` e `external_blocker`.
- Identidade determinística do job por tenant, usuário, operação e chave de idempotência.
- Reserva de recurso antes do efeito oneroso e confirmação somente depois da persistência do resultado.
- Owner token, lease e fencing token monotônico; worker antigo não conclui após perder o lease.
- Histórico imutável de transições.
- Outbox idempotente, marcada como entregue somente após sucesso do consumidor.
- Compensação segura e bloqueio externo quando o resultado de uma mutação fica incerto.
- Reconciliação de jobs presos por endpoint interno autenticado.
- Coleções duráveis incluídas no inventário de recuperação portátil.

## Testes e gates

Comandos finais do pacote:

```text
npm run typecheck
npm run test:memory-durable
npm test
npm run build
node --import tsx scripts/validate-requirement-tracker.ts
npm audit --audit-level=high
git diff --check
```

Testes específicos cobrem:

- bloqueio de segredos e classificação de dados pessoais;
- persistência pessoal somente cifrada e com consentimento;
- isolamento entre usuários e tenants;
- proibição de dados pessoais no escopo da organização;
- expiração de memórias antigas sem TTL;
- redução explícita de contexto, preservação de decisões e falha fechada;
- sequência completa da máquina de estados;
- falha de reserva antes do efeito oneroso;
- mutação incerta sem repetição automática;
- compensação que falha;
- worker antigo bloqueado por fencing token;
- outbox idempotente;
- identidade do job incluindo tenant, usuário, operação e idempotência;
- reconciliação de job preso.

## Limites e riscos residuais

- A variável `MEMORY_ENCRYPTION_KEY` ainda precisa ser configurada na Vercel; sem ela, dados pessoais falham fechados e não são salvos.
- Memórias legadas comuns continuam legíveis; não foi feita migração automática de eventual conteúdo pessoal legado para ciphertext.
- A gravação é explícita e controlada pelo usuário; a extração seletiva automática depois de cada resposta ainda não existe.
- A relevância de memória é lexical; indexação vetorial/semântica ainda permanece parcial.
- O isolamento por tenant foi aplicado à memória e ao contexto de conversa, mas ainda não foi comprovado em todas as coleções e fluxos da plataforma.
- As novas regras do Firestore, a chave AES e o comportamento cifrado ainda precisam ser confirmados no preview/produção.
- A máquina durável existe e foi testada como serviço, mas pagamentos, publicações e geração de mídia ainda não foram todos migrados para ela.
- O endpoint de reconciliação existe, porém ainda não há evidência de agendamento recorrente executado em produção.
- Não houve teste de corrida distribuída no Firestore Emulator nem revisão independente.
- A vulnerabilidade alta transitiva de `nanoid` foi corrigida com `3.3.18`; permanecem seis alertas moderados transitivos de `uuid` na árvore do Firebase Admin, sem correção segura disponível sem downgrade forçado.
- Por esses motivos, nenhum requisito deste bloco é marcado como `VERIFIED`.
