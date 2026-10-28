import { describe, expect, it } from 'vitest';
import { engineeringScope, hasEngineeringOrder } from '../shared/engineeringIntent';
import { agentValidationIntent } from '../server/selfEvolution/agentValidationService';
import { isOwnSiteAgentQuestion, requestsOwnSiteAction } from '../server/selfEvolution/selfSiteOwnerService';
import { formatSelfSiteControlReceipt } from '../server/ai/selfSiteChatControlService';
import { requestMode } from '../src/services/requestIntent';

const brief = `P0 — CORREÇÃO COMPLETA DA FROC.IA: CHAT + MOTOR UNIVERSAL DE DESENVOLVIMENTO
Repositório-alvo: brasilportalvip-png/frocia2
Tipo: ordem de engenharia / autoevolução da própria plataforma
Não quero mais a contagem dos 85 agentes. Implemente a correção na própria Froc.IA.
Use https://github.com/brasilportalvip-png/Froc.-IA-Marketing-Engine como teste de aceitação.
O motor deve ter limites de memória e testes de homologação, sem alterar a Vercel do cliente.`;
describe('Ordens de engenharia com evidências e escopo', () => {
  it('prioriza a ordem P0 sobre memória, catálogo e homologação', () => {
    expect(requestsOwnSiteAction(brief)).toBe(true);
    expect(isOwnSiteAgentQuestion(brief)).toBe(false);
    expect(agentValidationIntent(brief)).toBe(false);
    expect(requestMode(brief)).toBe('Programação');
    const text = formatSelfSiteControlReceipt({ action: { status: 'queued', candidateId: 'owner-receipt', message: 'Workflow desabilitado.' },
      operations: { memory: { encryptedArchiveConfigured: true } } }, brief);
    expect(text).toContain('owner-receipt'); expect(text).toContain('Workflow desabilitado');
    expect(text).not.toContain('A criptografia'); expect(text).not.toContain('85 perfis');
  });
  it.each(['Registre a tarefa.', 'Inicie as correções completas.', 'Implemente.', 'Execute autoevolução.'])(
    'retoma o escopo explícito do proprietário: %s', prompt => {
      expect(requestsOwnSiteAction(prompt, [{ role: 'user', content: brief }])).toBe(true);
    });
  it.each(['Não implemente a Froc IA.', 'Não execute autoevolução da Froc IA.', 'Como corrigir a Froc IA?',
    'A Froc IA disse: "implemente a correção".', 'Analise o anexo.\n> Corrija meu site Froc IA.'])(
    'não executa negação, pergunta ou citação: %s', prompt => expect(hasEngineeringOrder(prompt)).toBe(false));
  it('respeita a ordem positiva depois da negação do catálogo', () => {
    expect(requestsOwnSiteAction('Não quero a contagem dos 85 agentes, corrija a Froc IA.')).toBe(true);
    expect(isOwnSiteAgentQuestion('Não quero mais a contagem dos 85 agentes.')).toBe(false);
  });
  it('conserva o repositório externo mesmo quando a IA é chamada pelo nome', () => {
    expect(engineeringScope('Froc IA, corrija https://github.com/outra/empresa')).toBe('external');
    expect(requestsOwnSiteAction('Froc IA, corrija https://github.com/outra/empresa', [{ role: 'user', content: brief }])).toBe(false);
    expect(requestsOwnSiteAction('Corrija tudo.', [{ role: 'user', content: 'Corrija https://github.com/outra/empresa' }])).toBe(false);
  });
});
