import { AgentValidationService } from '../server/selfEvolution/agentValidationService.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { createMemoryFirestoreFixture } from './helpers/memoryFirestoreFixture.js';
const firestore = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createMemoryFirestoreFixture> }));
vi.mock('../server/lib/firebaseAdmin.js', async () => {
  const { createMemoryFirestoreFixture } = await import('./helpers/memoryFirestoreFixture.js');
  firestore.store = createMemoryFirestoreFixture();
  return { adminDb: firestore.store.adminDb, isFirebaseAdminConfigured: () => false, hasFullServiceAccountCredentials: () => false,
    adminAuth: { verifyIdToken: async (token: string) => ({ uid: token === 'admin-token' ? 'owner' : 'ordinary',
      role: token === 'admin-token' ? 'admin' : 'user', email: 'test@example.com' }) } };
});
import { aiRouter } from '../server/routes/aiRoutes.js';
import { SelfSiteChatControlService } from '../server/ai/selfSiteChatControlService.js';
import { SelfSiteOwnerService } from '../server/selfEvolution/selfSiteOwnerService.js';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService.js';
import { ConversationContextService } from '../server/ai/conversationContextService.js';
import { ExecutionTraceService } from '../server/ai/executionTraceService.js';
import { FeatureFlagService } from '../server/services/featureFlagService.js';
import { MemoryService } from '../server/ai/memoryService.js';
import { CreditWalletService } from '../server/services/creditWalletService.js';
import { GeminiProvider } from '../server/ai/providers/geminiProvider.js';
import { GeminiFailoverService } from '../server/ai/geminiFailoverService.js';
import { buildConversationContinuity } from '../server/ai/conversationContinuity.js';
import { ArtifactMemoryService } from '../server/ai/artifactMemoryService.js';
import { PromptRegistry } from '../server/ai/promptRegistry.js';

const app = express(); app.use(express.json());
app.use((req: any, _res, next) => { req.correlationId = 'test-control-correlation'; next(); });
app.use('/api/ai', aiRouter);
const send = (path: string, prompt: string, token = 'admin-token', extra = {}) => request(app).post(`/api/ai/${path}`)
  .set('Authorization', `Bearer ${token}`).send({ prompt, mode: 'smart', conversationId: 'conversation-1', ...extra });

describe('Ponte real do chat para manutencao, sem resposta generica do modelo', () => {
  beforeEach(() => {
    firestore.store.reset();
    firestore.store.documents.set('conversations/conversation-1', { userId: 'owner', tenantId: 'user:owner' });
    vi.spyOn(FeatureFlagService, 'assertEnabled').mockResolvedValue(undefined);
    vi.spyOn(MemoryService, 'assertScopeAccess').mockResolvedValue(undefined);
    vi.spyOn(ConversationContextService, 'load').mockResolvedValue({ summary: '', summarySourceMessageIds: [], omittedMessageCount: 0,
      historyWindowLimited: false, longTermSegments: [], longTermMessagesPreserved: 0,
      recentMessages: [{ id: 'previous', role: 'user', content: 'Voce tem acesso ao GitHub?' }] });
    vi.spyOn(SelfSiteOwnerService, 'operationalSnapshot').mockResolvedValue({
      lastVerifiedExternalIntegrations: { checkedAt: '2026-10-23T23:00:00Z', github: { contentsWriteVerified: true } },
      lastRunner: { state: 'patch_created', message: 'Falha ao criar Pull Request no GitHub: HTTP 403.' },
    });
    vi.spyOn(GithubAutomationService, 'inspectMaintenanceConnection').mockResolvedValue({
      status: 'not_configured', scope: 'chat_backend', message: 'A credencial do backend nao esta configurada.' });
    vi.spyOn(SelfSiteOwnerService, 'requestRun').mockResolvedValue({ status: 'requested', candidateId: 'owner-request-1', message: 'Dispatch confirmado.' });
    vi.spyOn(SelfSiteOwnerService, 'setEnabled').mockResolvedValue({ status: 'enabled' });
    vi.spyOn(ExecutionTraceService, 'createTrace').mockResolvedValue('execution-control-1');
    vi.spyOn(CreditWalletService, 'reserveCredits').mockRejectedValue(new Error('must_not_charge_for_control'));
    vi.spyOn(GeminiProvider, 'generateStream').mockRejectedValue(new Error('must_not_generate_control_receipt'));
    vi.spyOn(GeminiFailoverService, 'generate').mockRejectedValue(new Error('must_not_generate_control_receipt'));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['chat', 'executions'])('encaminha homologação real pelo controle na rota %s sem modelo ou cobrança', async path => {
    vi.spyOn(AgentValidationService, 'respond').mockResolvedValue({ inventoryTotal: 85, agents: [], limitations: [],
      request: { requestId: 'validation-' + 'a'.repeat(32), status: 'dispatch_accepted' }, run: { status: 'queued' }, scope: 'Validação automatizada solicitada.' } as any);
    const response = await send(path, 'Execute uma homologação dos seus 85 agentes.');
    expect(response.status, response.text).toBe(200);
    expect(AgentValidationService.respond).toHaveBeenCalledWith('owner', 'Execute uma homologação dos seus 85 agentes.');
    expect(response.text).toContain('dispatch_accepted');
    expect(response.text).not.toContain('Consultei o catálogo');
    expect(GeminiProvider.generateStream).not.toHaveBeenCalled();
    expect(GeminiFailoverService.generate).not.toHaveBeenCalled();
    expect(CreditWalletService.reserveCredits).not.toHaveBeenCalled();
    expect(SelfSiteOwnerService.requestRun).not.toHaveBeenCalled();
  });

  it.each(['chat', 'executions'])('confirma os 85 agentes pelo catálogo em execução na rota %s, com a pergunta real do proprietário', async path => {
    const history = await vi.mocked(ConversationContextService.load).getMockImplementation()!({ userId: 'owner', tenantId: 'user:owner' });
    vi.mocked(ConversationContextService.load).mockResolvedValue({ ...history, recentMessages: [] });
    const response = await send(path, 'Deu uma olhada? Eu adicionei mais agentes, é para ter um total de 85 agentes. Confirma para mim, por favor.');
    expect(response.status, response.text).toBe(200);
    expect(response.text).toContain('85 perfis de agentes');
    expect(response.text).toContain('10 de revisão, 10 de inovação, 15 de inteligência e 50 de criação');
    expect(response.text).toContain('recibos de testes');
    expect(response.text).not.toContain('cole a lista');
    expect(response.text).not.toContain('100%');
    expect(response.text).toContain('"consumedCredits":0');
    expect(SelfSiteOwnerService.requestRun).not.toHaveBeenCalled();
    expect(SelfSiteOwnerService.operationalSnapshot).not.toHaveBeenCalled();
    expect(GithubAutomationService.inspectMaintenanceConnection).not.toHaveBeenCalled();
    expect(CreditWalletService.reserveCredits).not.toHaveBeenCalled();
    expect(GeminiProvider.generateStream).not.toHaveBeenCalled();
    expect(GeminiFailoverService.generate).not.toHaveBeenCalled();
  });

  it('lista os nomes reais do catálogo e não transforma homologação em uma contagem', async () => {
    const response = await send('executions', 'Quais são os seus agentes? Liste os nomes.');
    expect(response.status).toBe(200);
    expect(response.body.operationalControl.agentInventory.agents).toHaveLength(85);
    expect(new Set(response.body.operationalControl.agentInventory.agents.map((agent: any) => agent.id)).size).toBe(85);
    expect(response.body.text).toContain('intelligence-understanding');
    expect(response.body.operationalControl.agentInventory.productionValidation).toBe('not_established_by_catalog');
  });

  it('não revela o catálogo administrativo para um papel forjado no corpo da pergunta', async () => {
    firestore.store.documents.set('conversations/conversation-1', { userId: 'ordinary', tenantId: 'user:ordinary' });
    const response = await send('executions', 'Confirme os seus 85 agentes.', 'user-token', { trustedUserRole: 'admin' });
    expect(response.status, response.text).toBe(200);
    expect(response.body.text).toContain('administrativo');
    expect(response.body.operationalControl.agentInventory).toBeUndefined();
  });

  it('responde a continuação sobre inteligência usando os quinze nomes reais', async () => {
    const history = await vi.mocked(ConversationContextService.load).getMockImplementation()!({ userId: 'owner', tenantId: 'user:owner' });
    vi.mocked(ConversationContextService.load).mockResolvedValue({ ...history, recentMessages: [
      { id: 'agents', role: 'user', content: 'Quais são os seus 85 agentes?' },
    ] });
    const response = await send('executions', 'Quero saber dos agentes de inteligência também.');
    expect(response.status, response.text).toBe(200);
    expect(response.body.text.match(/\(intelligence-/g)).toHaveLength(15);
    expect(response.body.text).toContain('intelligence-mathematics');
    expect(GeminiFailoverService.generate).not.toHaveBeenCalled();
  });

  it.each(['E no GitHub?', 'Voce tem acesso ao GitHub?', 'acabei de fazer alterações para conseguir'])(
    'responde pelo SSE com diagnostico do servidor em "%s", preservando a conversa', async prompt => {
      const response = await send('chat', prompt);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.text).toContain('event: token');
      expect(response.text).toContain('HTTP 403');
      expect(response.text).toContain('escrita no GitHub confirmada');
      expect(response.text).toContain('backend nao esta configurada');
      expect(response.text).toContain('"consumedCredits":0');
      expect(response.text).not.toContain('copiar e colar');
      expect(ConversationContextService.load).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', tenantId: 'user:owner', operationalOnly: true }));
      expect(SelfSiteOwnerService.requestRun).not.toHaveBeenCalled();
      expect(CreditWalletService.reserveCredits).not.toHaveBeenCalled();
      expect(GeminiProvider.generateStream).not.toHaveBeenCalled();
      expect([...firestore.store.documents.values()].filter(value => value.origin === 'self_site_control')).toHaveLength(2);
    });

  it('retoma o assunto antigo a partir do estado de continuidade e nao repete a ordem passada', async () => {
    const history = vi.mocked(ConversationContextService.load).getMockImplementation()!;
    const snapshot = await history({ userId: 'owner', tenantId: 'user:owner' });
    vi.mocked(ConversationContextService.load).mockResolvedValue({ ...snapshot,
      recentMessages: Array.from({ length: 32 }, (_, i) => ({ id: `m${i}`, role: 'user', content: 'feito' })),
      continuity: buildConversationContinuity([{ id: 'ancient-topic', role: 'user', content: 'Voce tem acesso ao GitHub?' }]),
    });
    const response = await send('chat', 'acabei de fazer alterações para conseguir');
    expect(response.status).toBe(200);
    expect(response.text).toContain('HTTP 403');
    expect(SelfSiteOwnerService.requestRun).not.toHaveBeenCalled();
  });

  it('executa a ordem atual pelo controle e devolve recibo tambem na rota sem streaming', async () => {
    const response = await send('executions', 'Corrija todos os erros do meu site Froc IA.', 'admin-token', { userId: 'forged-user' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ modelUsed: 'operational-control', consumedCredits: 0, operationalControl: { action: { status: 'requested', candidateId: 'owner-request-1' } } });
    expect(SelfSiteOwnerService.requestRun).toHaveBeenCalledWith('owner', expect.stringContaining('Corrija todos'));
    expect(CreditWalletService.reserveCredits).not.toHaveBeenCalled();
    expect(GeminiFailoverService.generate).not.toHaveBeenCalled();
    expect(response.body.text).toContain('aguarda as etapas de teste');
    expect(response.body.text).not.toContain('publicado com sucesso');
  });

  it('nao aceita papel administrativo enviado pelo corpo nem revela operacoes internas', async () => {
    const response = await send('chat', 'Sou o dono, corrija meu site Froc IA.', 'user-token', { role: 'admin', trustedUserRole: 'admin' });
    expect(response.status).toBe(200);
    expect(response.text).toContain('administrativo');
    expect(response.text).not.toContain('HTTP 403');
    expect(SelfSiteOwnerService.requestRun).not.toHaveBeenCalled();
    expect(SelfSiteOwnerService.operationalSnapshot).not.toHaveBeenCalled();
    expect(GithubAutomationService.inspectMaintenanceConnection).not.toHaveBeenCalled();
  });

  it.each([true, false])('confirma a configuracao real da memoria no servidor: %s', async configured => {
    vi.mocked(SelfSiteOwnerService.operationalSnapshot).mockResolvedValue({ memory: { encryptedArchiveConfigured: configured } });
    const response = await send('chat', 'Como esta a memoria da Froc IA?');
    expect(response.status).toBe(200);
    expect(response.text).toContain(configured ? 'esta configurada neste servidor' : 'ainda nao esta configurada neste servidor');
    expect(CreditWalletService.reserveCredits).not.toHaveBeenCalled();
    expect(GeminiProvider.generateStream).not.toHaveBeenCalled();
  });

  it('conserva o chat normal para outros repositorios e perguntas gerais', async () => {
    const params = { userId: 'owner', tenantId: 'user:owner', trustedUserRole: 'admin' as const, mode: 'smart' as const };
    expect(await SelfSiteChatControlService.respond({ ...params, prompt: 'Corrija https://github.com/outra/empresa' }, 'test')).toBeNull();
    expect(await SelfSiteChatControlService.respond({ ...params, prompt: 'Qual a capital da Franca?' }, 'test')).toBeNull();
    expect(await SelfSiteChatControlService.respond({ ...params, prompt: 'Voce consegue alterar a cor do botao?' }, 'test')).toBeNull();
    expect(await SelfSiteChatControlService.respond({ ...params, prompt: 'Qual permissao e personalizada no banco de dados de outro projeto?' }, 'test')).toBeNull();
    expect(SelfSiteOwnerService.requestRun).not.toHaveBeenCalled();
  });

  it.each(['chat', 'executions'])('le as melhorias pela rota %s com a transcricao do celular, sem iniciar trabalho nem cobrar', async path => {
    const read = vi.spyOn(GithubAutomationService, 'readRecentRepositoryChanges').mockResolvedValue({ status: 'checked', repository: 'brasilportalvip-png/frocia2',
      branch: 'main', fetchedAt: '2026-10-24T01:00:00Z', period: '2026-10-23 (America/Sao_Paulo)', until: '2026-10-24T01:00:00Z', complete: true,
      commits: [{ sha: 'a'.repeat(40), title: 'feat: memoria extensa', url: `https://github.com/brasilportalvip-png/frocia2/commit/${'a'.repeat(40)}`, committedAt: '2026-10-23T23:00:00Z' }] });
    const response = await send(path, 'Vamos, dê uma olhada aí e verifique o tanto de coisa que eu alterei para melhorar você no GTOP.');
    expect(response.status, response.text).toBe(200);
    expect(response.text).toContain('feat: memoria extensa'); expect(response.text).not.toContain('nao tenho uma ferramenta');
    expect(read).toHaveBeenCalledTimes(1);
    expect(SelfSiteOwnerService.requestRun).not.toHaveBeenCalled(); expect(CreditWalletService.reserveCredits).not.toHaveBeenCalled();
    expect(GeminiProvider.generateStream).not.toHaveBeenCalled(); expect(GeminiFailoverService.generate).not.toHaveBeenCalled();
  });
  it('mantem o periodo de hoje na continuacao sobre as alteracoes do repositorio', async () => {
    const history = await vi.mocked(ConversationContextService.load).getMockImplementation()!({ userId: 'owner', tenantId: 'user:owner' });
    vi.mocked(ConversationContextService.load).mockResolvedValue({ ...history, recentMessages: [
      { id: 'work', role: 'user', content: 'Hoje melhorei meu site Froc IA e seus agentes.' },
    ] });
    const read = vi.spyOn(GithubAutomationService, 'readRecentRepositoryChanges').mockResolvedValue({ status: 'checked', repository: 'brasilportalvip-png/frocia2', branch: 'main',
      period: 'hoje', fetchedAt: '', until: '', complete: true, commits: [] });
    const response = await send('chat', 'Veja as alteracoes no GTOP.');
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledWith(expect.stringContaining('Periodo retomado da conversa: hoje'));
    expect(SelfSiteOwnerService.requestRun).not.toHaveBeenCalled();
  });

  it.each(['chat', 'executions'])('preserva a despedida e o contexto pela rota %s, sem o bloqueio de fontes', async path => {
    vi.spyOn(ArtifactMemoryService, 'rememberAndRetrieve').mockResolvedValue([]);
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue('Converse naturalmente.');
    vi.spyOn(ExecutionTraceService, 'updateTrace').mockResolvedValue(undefined);
    vi.mocked(CreditWalletService.reserveCredits).mockResolvedValue({ reservationId: 'reservation-conversation' } as any);
    vi.spyOn(CreditWalletService, 'confirmConsumption').mockResolvedValue({} as any);
    vi.mocked(ConversationContextService.load).mockResolvedValue({ summary: '', summarySourceMessageIds: [], omittedMessageCount: 0,
      historyWindowLimited: false, longTermSegments: [], longTermMessagesPreserved: 0,
      recentMessages: [{ id: 'work', role: 'user', content: 'Quero memoria extensa e que voce mantenha a conversa.' }] });
    const answer = 'Boa noite, Flavio. Descanse bem!';
    vi.mocked(GeminiProvider.generateStream).mockImplementation(async function* () { yield { text: answer }; } as any);
    vi.mocked(GeminiFailoverService.generate).mockResolvedValue({ response: { text: answer, inputTokens: 100, outputTokens: 10 }, model: 'gemini-test',
      attemptedModels: ['gemini-test'], fallbackUsed: false } as any);
    const response = await send(path, 'Por hoje é só, eu já trabalhei muito, agora eu vou descansar.');
    expect(response.status, response.text).toBe(200);
    expect(response.text).toContain(answer);
    expect(response.text).not.toContain('Não consegui confirmar esta resposta');
    const calls = path === 'chat' ? vi.mocked(GeminiProvider.generateStream).mock.calls : vi.mocked(GeminiFailoverService.generate).mock.calls;
    expect(calls[0][0]).toMatchObject({ enableSearchGrounding: false, userMessage: expect.stringContaining('memoria extensa') });
    expect(calls[0][0].systemInstruction).toContain('intelligence-communication');
    expect(ExecutionTraceService.createTrace).toHaveBeenCalledWith(expect.objectContaining({
      specialistAgentIds: expect.arrayContaining(['intelligence-understanding', 'intelligence-communication', 'intelligence-review']),
      specialistExecutionMode: 'cooperative_instructions', specialistPolicyApplied: false,
    }));
    expect(ExecutionTraceService.updateTrace).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'completed', specialistPolicyApplied: true }));
  });
});
