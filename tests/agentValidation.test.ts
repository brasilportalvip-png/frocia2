import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ store: null as any, configured: true }));
vi.mock('../server/lib/firebaseAdmin.js', async () => {
  const { createMemoryFirestoreFixture } = await import('./helpers/memoryFirestoreFixture.js');
  state.store = createMemoryFirestoreFixture();
  return { adminDb: state.store.adminDb, isFirebaseAdminConfigured: () => state.configured };
});
import { AgentValidationService, agentValidationIntent, requestsAgentValidation, formatAgentValidation } from '../server/selfEvolution/agentValidationService.js';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService.js';
import { installedSelfSiteAgentInventory } from '../server/selfEvolution/selfSiteKnowledgeService.js';
import { SelfSiteOwnerService } from '../server/selfEvolution/selfSiteOwnerService.js';

describe('evidências e solicitação de validação pelo proprietário', () => {
  beforeEach(() => { state.store.reset(); state.configured = true;
    vi.spyOn(GithubAutomationService, 'agentValidationRun').mockImplementation(async (_id, dispatch) => dispatch
      ? { status: 'dispatch_accepted', httpStatus: 204 } : { status: 'queued', runId: 42 });
  });
  afterEach(() => vi.restoreAllMocks());
  it('reconhece a continuação real sem confundir contagem com homologação', () => {
    expect(agentValidationIntent('execute uma homologação completa nesta consulta.', [{ role: 'user', content: 'Quais são seus 85 agentes?' }])).toBe(true);
    expect(agentValidationIntent('Quantos agentes você tem?')).toBe(false);
    expect(agentValidationIntent('Os seus agentes estão integrados e funcionando?')).toBe(true);
    expect(agentValidationIntent('Homologue outro projeto, https://example.com', [{ role: 'user', content: 'Froc' }])).toBe(false);
  });
  it.each(['Não execute uma homologação', 'Como execute uma homologação?', 'Consulte os registros dos agentes sem iniciar testes', 'Explique: "execute uma homologação"'])('não transforma consulta ou citação em dispatch: %s', text => {
    expect(requestsAgentValidation(text)).toBe(false);
  });
  it('aplica autorização antes de ler registros e disparar testes', async () => {
    const result = await SelfSiteOwnerService.control({ role: 'user', userId: 'intruder', prompt: 'Execute uma homologação dos seus agentes.' });
    expect(result).toMatchObject({ status: 'blocked', code: 'administrator_required' });
    expect(state.store.queries).toHaveLength(0);
    expect(GithubAutomationService.agentValidationRun).not.toHaveBeenCalled();
  });
  it('exige trace concluído e política aplicada; filtra outra conta e contribuição ausente', async () => {
    for (const [id, extra] of Object.entries({ good: { status: 'completed', specialistPolicyApplied: true }, failed: { status: 'failed', specialistPolicyApplied: true }, missing: { status: 'completed' }, other: { status: 'completed', specialistPolicyApplied: true, userId: 'other' } }))
      state.store.documents.set('ai_executions/' + id, { userId: 'owner', specialistAgentIds: ['intelligence-reasoning'], createdAt: '2026-10-24T00:00:00Z', ...extra });
    const data = await AgentValidationService.evidence('owner');
    expect(data.agents.find(a => a.id === 'intelligence-reasoning')?.evidence.map(e => e.recordId)).toEqual(['good']);
    expect(data.agents.find(a => a.kind === 'creation')?.evidence).toEqual([]);
    expect(JSON.stringify(data)).not.toContain('ai_executions/other');
  });
  it('registra contribuição de criação sem declarar produção aprovada', async () => {
    state.store.documents.set('site_factory_builds/build-1', { userId: 'owner', status: 'failed', reports: [{ contributions: [{ agentId: installedSelfSiteAgentInventory().agents.find(a => a.kind === 'creation')!.id }] }] });
    const data = await AgentValidationService.evidence('owner');
    expect(data.agents.find(a => a.kind === 'creation')?.evidence).toEqual([expect.objectContaining({ recordId: 'build-1', status: 'failed', kind: 'contribution_recorded' })]);
    expect(data.limitations.join(' ')).toContain('não comprovam');
    expect(formatAgentValidation(data)).toContain('sem comprovação');
    expect(GithubAutomationService.agentValidationRun).not.toHaveBeenCalled();
  });
  it('dispara uma vez por janela, conserva recibo e consulta execução correspondente', async () => {
    await AgentValidationService.respond('owner', 'Execute uma homologação dos seus agentes');
    const second = await AgentValidationService.respond('owner', 'Execute uma homologação dos seus agentes');
    expect(vi.mocked(GithubAutomationService.agentValidationRun).mock.calls.filter(c => c[1] === true)).toHaveLength(1);
    expect(second.request).toMatchObject({ status: 'dispatch_accepted' });
    expect(second.run).toMatchObject({ status: 'queued', runId: 42 });
    expect(formatAgentValidation(second)).toContain('dispatch_accepted');
    expect(second.scope).toContain('Não cria projetos pagos');
  });
  it('não esconde falha de infraestrutura e não transforma ausência em sucesso', async () => {
    state.configured = false;
    const result = await AgentValidationService.respond('owner', 'Execute uma homologação dos agentes');
    expect(result.request).toMatchObject({ status: 'blocked' });
    expect(GithubAutomationService.agentValidationRun).not.toHaveBeenCalled();
  });
});
