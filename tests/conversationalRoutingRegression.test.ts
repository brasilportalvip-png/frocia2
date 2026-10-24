import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIRequestOrchestrator } from '../server/ai/requestOrchestrator.js';
import { ResearchEvidenceService } from '../server/ai/researchEvidenceService.js';
import { ContextBuilder } from '../server/ai/contextBuilder.js';
import { PromptRegistry } from '../server/ai/promptRegistry.js';
import { MemoryService } from '../server/ai/memoryService.js';
import { buildConversationContinuity } from '../server/ai/conversationContinuity.js';
import { isOwnSiteCapabilityQuestion, isOwnSiteChangesQuestion, requestsOwnSiteAction } from '../server/selfEvolution/selfSiteOwnerService.js';

describe('Regressao da conversa do Flavio no celular', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    'conversar com você hoje, hein, prof. Tudo que você fala aqui não foi possível verificar. Tá difícil, hein?',
    'OK, Frank, boa noite. Tudo bem?',
    'Hoje eu trabalhei muito nos agentes para deixar você bem afiado e na liberação sua para o GIT-OB.',
    'Por hoje é só, eu já trabalhei muito, agora eu vou descansar.',
    'O dia hoje foi pesado.', 'Acabei de fazer as alterações agora.',
    'O que eu te pedi hoje?', 'Você lembra o que conversamos ontem?',
  ])('mantem a fala e a memoria na conversa sem exigir fontes web: %s', prompt => {
    const plan = AIRequestOrchestrator.plan({ mode: 'smart', prompt });
    expect(plan.classification.requiresSearch).toBe(false);
    expect(plan.tools.map(tool => tool.name)).not.toContain('web_search');
    const result = ResearchEvidenceService.finalize({ text: 'Resposta baseada nesta conversa.', citations: [],
      requiresSearch: plan.classification.requiresSearch, sensitivity: plan.classification.sensitivity,
      knowledgeBaseRequested: false, ragChunksUsed: [] });
    expect(result.text).toBe('Resposta baseada nesta conversa.');
    expect(result.researchStatus).toBe('not_requested');
  });

  it.each([
    'Qual é o preço atual do dólar?', 'Quem é o presidente hoje?', 'Qual o placar do jogo de hoje?',
    'Boa noite, qual a versão atual da API Gemini?', 'Oi, como está o clima hoje?',
    'Boa noite, quero notícias de hoje.', 'Bom dia, a API do Gemini está disponível agora?',
    'Hoje trabalhei muito. Pesquise as notícias atuais sobre inteligência artificial.',
    'Qual dose desse medicamento devo tomar hoje?', 'Lembra o que te pedi? Consulte a cotação atual do dólar.',
  ])('preserva a pesquisa para a pergunta factual real: %s', prompt => {
    const plan = AIRequestOrchestrator.plan({ mode: 'smart', prompt });
    expect(plan.classification.requiresSearch).toBe(true);
    const result = ResearchEvidenceService.finalize({ text: 'Fato sem fonte.', citations: [], requiresSearch: true,
      sensitivity: plan.classification.sensitivity, knowledgeBaseRequested: false, ragChunksUsed: [] });
    expect(result.researchStatus).toBe('unsupported');
    expect(result.text).not.toContain('Fato sem fonte');
  });

  it('leva os objetivos e a conversa anteriores ao modelo mesmo depois da despedida', async () => {
    vi.spyOn(PromptRegistry, 'getActivePrompt').mockResolvedValue('Converse com precisao.');
    vi.spyOn(MemoryService, 'getActiveMemories').mockResolvedValue([]);
    const recentMessages = [
      { id: 'work', role: 'user', content: 'Hoje eu trabalhei nos agentes e liberei o GitHub da Froc IA.' },
      { id: 'goal', role: 'user', content: 'Quero memoria extensa e que voce continue a conversa.' },
      { id: 'bye', role: 'user', content: 'Por hoje é só, eu já trabalhei muito, agora eu vou descansar.' },
    ];
    const prompt = 'O que eu te pedi hoje?';
    const plan = AIRequestOrchestrator.plan({ mode: 'smart', prompt });
    const context = await ContextBuilder.assemble({ userId: 'owner', mode: plan.effectiveMode, prompt,
      requestPolicy: plan.systemPolicy, recentMessages,
      conversationSummary: { continuity: buildConversationContinuity(recentMessages), summary: '', summarySourceMessageIds: [], omittedMessageCount: 0, historyWindowLimited: false } });
    expect(context.userMessage).toContain('liberei o GitHub');
    expect(context.userMessage).toContain('memoria extensa');
    expect(context.userMessage).toContain(prompt);
    expect(context.systemInstruction).toContain('nao exige fontes externas');
  });

  it.each([
    'ver todas as melhorias que eu fiz ao dia de hoje para você?',
    'Dê uma olhada hoje no GitHub e verifica o tanto de coisas que eu fiz alterações para você.',
    'Vamos, dê uma olhada aí e verifique o tanto de coisa que eu alterei para melhorar você no GTOP.',
  ])('reconhece leitura das melhorias, sem iniciar manutencao: %s', prompt => {
    const history = [{ role: 'user', content: 'Meu site Froc IA esta conectado ao GitHub.' }];
    expect(isOwnSiteChangesQuestion(prompt, history)).toBe(true);
    expect(requestsOwnSiteAction(prompt, history)).toBe(false);
  });
  it('reconhece GitGub como pergunta de acesso e nao adivinha outro repositorio', () => {
    expect(isOwnSiteCapabilityQuestion('Você consegue acessar o GitGub?')).toBe(true);
    expect(isOwnSiteChangesQuestion('Veja as alteracoes de https://github.com/outra/empresa para voce')).toBe(false);
  });
  it('a despedida preserva o assunto do trabalho para a proxima continuacao', () => {
    const previous = buildConversationContinuity([{ id: 'project', role: 'user', content: 'Quero melhorar a memoria e os agentes do meu site Froc IA.' }]);
    const next = buildConversationContinuity([{ id: 'bye', role: 'user', content: 'Por hoje é só, agora vou descansar.' }], previous);
    expect(next.activeTopic?.messageId).toBe('project');
    expect(next.latestUpdates.at(-1)?.messageId).toBe('bye');
  });
  it('recupera o assunto quando a versao anterior ja tinha salvo a despedida como topico', () => {
    const previous = buildConversationContinuity([{ id: 'project', role: 'user', content: 'Quero melhorar a memoria e os agentes do meu site Froc IA.' }]);
    previous.activeTopic = { messageId: 'old-bye', content: 'Por hoje é só, agora vou descansar.', createdAt: '2026-10-24T02:00:00Z' };
    const next = buildConversationContinuity([{ id: 'continue', role: 'user', content: 'feito' }], previous);
    expect(next.activeTopic?.messageId).toBe('project');
  });
});
