import { agentValidationIntent, formatAgentValidation } from '../selfEvolution/agentValidationService.js';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';
import { SelfSiteOwnerService, isEvolutionRequest, isOwnSiteAccessFollowUp, isOwnSiteCapabilityQuestion, isOwnSiteAgentQuestion,
  isOwnSiteRequest, isOwnSiteChangesQuestion, requestedOwnSiteToggle, requestsOwnSiteAction } from '../selfEvolution/selfSiteOwnerService.js';
import { RedactionService } from '../selfEvolution/redactionService.js';
import { ConversationContextService } from './conversationContextService.js';
import { ExecutionTraceService } from './executionTraceService.js';
import { MemoryService } from './memoryService.js';
import type { ExecutionParams } from './types/ai.js';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const safe = (value: unknown) => typeof value === 'string' ? RedactionService.redactSensitiveData(value).slice(0, 2000) : '';

export function formatSelfSiteControlReceipt(control: Record<string, unknown>, prompt = ''): string {
  if (control.status === 'blocked') return safe(control.message) || 'Nao foi possivel confirmar o controle administrativo nesta sessao.';
  if (control.agentValidation) return formatAgentValidation(object(control.agentValidation));
  const inventory = object(control.agentInventory);
  if (inventory.source === 'running_server_catalog') {
    const agents = Array.isArray(inventory.agents) ? inventory.agents.map(object) : [];
    const total = agents.length;
    const groups = ['review', 'innovation', 'intelligence', 'creation'].map(kind => agents.filter(agent => agent.kind === kind).length);
    if (total !== inventory.total || new Set(agents.map(agent => agent.id)).size !== total)
      return 'Encontrei uma inconsistência no catálogo de agentes deste servidor. A contagem precisa ser corrigida.';
    const paragraphs = [
      `Consultei o catálogo carregado nesta versão da Froc.IA: são ${total} perfis de agentes, com ${total} identificadores únicos.`,
      `Composição: ${groups[0]} de revisão, ${groups[1]} de inovação, ${groups[2]} de inteligência e ${groups[3]} de criação de sites e aplicativos web.`,
      'Os especialistas de inteligência são selecionados para a conversa. Os 50 de criação participam em dez disciplinas, com cinco contribuições registradas por disciplina na construção profissional.',
      'Esta contagem vem do código em execução, sem precisar que você cole arquivos. Ela confirma os perfis instalados; a aprovação de produção de cada projeto depende dos recibos de testes, integrações e publicação. Não executei uma homologação completa nesta consulta.',
    ];
    const intelligenceOnly = /intelig[eê]ncia/i.test(prompt);
    if (intelligenceOnly || /\b(?:liste|listar|quais|nomes)\b/i.test(prompt)) paragraphs.push(agents
      .filter(agent => !intelligenceOnly || agent.kind === 'intelligence')
      .map(agent => `- ${safe(agent.name)} (${safe(agent.id)})`).join('\n'));
    if (/^[a-f0-9]{40}$/i.test(safe(inventory.deploymentCommitSha))) paragraphs.push(`Versão consultada: ${safe(inventory.deploymentCommitSha)}.`);
    return paragraphs.join('\n\n');
  }
  const action = object(control.action);
  const connection = object(control.connection);
  const operations = object(control.operations);
  const integrations = object(operations.lastVerifiedExternalIntegrations);
  const requested = safe(operations.requestedCandidateId);
  const taskOutcome = object(operations.taskOutcome);
  const currentDispatch = safe(object(control.action).dispatchId);
  const staleOutcome = Boolean(requested && currentDispatch && taskOutcome.dispatchId !== currentDispatch);
  const runner = requested ? staleOutcome ? {} : taskOutcome : object(operations.lastRunner);
  const paragraphs: string[] = [];
  const changes = object(control.repositoryChanges);
  if (changes.status) {
    if (changes.status !== 'checked') return `Nao consegui concluir a leitura atual dos commits de ${safe(changes.repository)}. ${safe(changes.message)} O estado dos agentes nao comprova quais alteracoes foram feitas hoje.`;
    const commits = Array.isArray(changes.commits) ? changes.commits.map(object) : [];
    const escape = (text: string) => text.replace(/[\\`*_{}\[\]<>#|!]/g, '\\$&');
    paragraphs.push(`Consultei agora os commits de ${safe(changes.repository)}, branch ${safe(changes.branch)}, no periodo ${safe(changes.period)}.`);
    paragraphs.push(`Encontrei ${commits.length} commit(s)${changes.complete === true ? ' no intervalo consultado' : ' na leitura limitada'}.`);
    if (commits.length) paragraphs.push(commits.slice(0, 20).map(commit =>
      `- ${safe(commit.sha).slice(0, 7)}: ${escape(safe(commit.title))}`).join('\n'));
    if (commits.length > 20 || changes.complete !== true) paragraphs.push('A lista exibida e parcial. Esta consulta nao afirma que todos os arquivos foram revisados ou que as mudancas ja foram publicadas.');
    if (commits.length && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/[a-f0-9]{40}$/i.test(safe(commits[0].url))) paragraphs.push(`Commit mais recente consultado: ${safe(commits[0].url)}`);
    return paragraphs.join('\n\n');
  }
  if (/mem[oó]ria/i.test(prompt)) {
    const memory = object(operations.memory);
    paragraphs.push(memory.encryptedArchiveConfigured === true
      ? 'A criptografia do arquivo extenso esta configurada neste servidor. O historico pode crescer sem um teto total de mensagens no codigo; a recuperacao usa trechos relevantes e a continuidade da conversa. O arquivamento antigo e retomado em lotes.'
      : memory.encryptedArchiveConfigured === false
        ? 'A chave de criptografia da memoria extensa ainda nao esta configurada neste servidor. O historico recente continua disponivel; o arquivo extenso protegido depende da configuracao de MEMORY_ENCRYPTION_KEY na Vercel e de novo deploy.'
        : 'Nao consegui confirmar a configuracao da memoria extensa nesta consulta.');
    return paragraphs.join('\n\n');
  }
  const states: Record<string, string> = {
    requested: 'Registrei o pedido e o GitHub aceitou a solicitacao de execucao.',
    already_requested: 'Esse pedido ja esta registrado. Consultei o estado sem criar outra tarefa.',
    queued: 'Registrei o pedido na fila. O inicio imediato pelo chat nao foi confirmado.',
    paused: 'A manutencao esta pausada.', enabled: 'A manutencao foi habilitada pelo controle persistente.',
    blocked: 'Nao foi possivel confirmar a solicitacao.',
  };
  if (action.status) {
    paragraphs.push(states[String(action.status)] || 'Consultei o recibo do pedido.');
    if (safe(action.candidateId)) paragraphs.push(`Tarefa: ${safe(action.candidateId)}.`);
    if (safe(action.message)) paragraphs.push(safe(action.message));
    const dispatch = object(action.dispatch);
    if (safe(dispatch.message)) paragraphs.push(safe(dispatch.message));
  } else paragraphs.push('Consultei o acesso real desta sessao e o estado registrado dos agentes.');
  if (connection.status) paragraphs.push(`Ligacao do chat com o GitHub: ${safe(connection.message) || safe(connection.status)}.`);
  if (safe(connection.repository)) paragraphs.push(`Repositorio consultado: ${safe(connection.repository)}.`);
  if (safe(connection.credentialEnvironment)) paragraphs.push(`Credencial usada na Vercel: ${safe(connection.credentialEnvironment)}.`);
  if (connection.credential === 'github_app') {
    const id = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : 'nao informado';
    paragraphs.push(`App confirmado pelo GitHub: ${safe(connection.appSlug) || 'slug nao informado'} (ID ${id(connection.appId)}); instalacao ${id(connection.installationId)}.`);
    const permissions = object(connection.permissions);
    paragraphs.push(`Permissoes efetivas: ${['actions', 'contents', 'pull_requests'].map(name => `${name}=${safe(permissions[name]) || 'nao confirmado'}`).join(', ')}.`);
  }
  if (safe(connection.selectionNotice)) paragraphs.push(safe(connection.selectionNotice));
  if (safe(connection.workflowState)) paragraphs.push(`Estado do workflow: ${safe(connection.workflowState)}.`);
  if (safe(connection.deploymentCommitSha)) paragraphs.push(`Versao do chat na Vercel: ${safe(connection.deploymentCommitSha)}.`);
  if (object(integrations.github).contentsWriteVerified === true) {
    paragraphs.push(`Executor externo: escrita no GitHub confirmada na verificacao registrada${safe(integrations.checkedAt) ? ` em ${safe(integrations.checkedAt)}` : ''}.`);
  }
  if (runner.state || runner.status) {
    paragraphs.push(`${requested ? 'Resultado desta tarefa' : 'Última execução global registrada'}${safe(runner.recordedAt) ? ` em ${safe(runner.recordedAt)}` : ''}: ${safe(runner.state) || safe(runner.status)}.${safe(runner.message) ? ` ${safe(runner.message)}` : ''}`);
  }
  if (staleOutcome && (taskOutcome.state || taskOutcome.status)) paragraphs.push(`Há um registro anterior desta tarefa: ${safe(taskOutcome.state) || safe(taskOutcome.status)}${safe(taskOutcome.recordedAt) ? ` em ${safe(taskOutcome.recordedAt)}` : ''}. Ele não confirma o resultado do disparo atual.`);
  if (/^https:\/\/github\.com\/brasilportalvip-png\/frocia2\/actions\/runs\/\d+$/.test(safe(runner.runUrl))) paragraphs.push(`Execução desta tarefa: ${safe(runner.runUrl)}`);
  if (requested && !runner.state && !runner.status) paragraphs.push('Esta tarefa ainda não tem resultado correlacionado; erros de outra tarefa não foram associados a este pedido.');
  if (action.status === 'requested' || action.status === 'queued') paragraphs.push('Este pedido aguarda as etapas de teste, revisao e verificacao da publicacao.');
  return paragraphs.join('\n\n');
}

/** Consultas de acesso e comandos administrativos retornam o recibo do servidor,
 * sem gerar uma resposta com o modelo nem reservar creditos de conversa. */
export class SelfSiteChatControlService {
  static async respond(params: ExecutionParams, correlationId: string) {
    if (params.attachments?.length) return null;
    const potential = isEvolutionRequest(params.prompt) || /homologa[cç][aã]o|homologar|evid[eê]ncias|registros de execu[cç][aã]o/i.test(params.prompt) || isOwnSiteAgentQuestion(params.prompt) || isOwnSiteCapabilityQuestion(params.prompt) || isOwnSiteAccessFollowUp(params.prompt) || isOwnSiteChangesQuestion(params.prompt) ||
      /\bagentes?\b/i.test(params.prompt) ||
      /\b(?:melhorias|altera[cç][oõ]es|mudan[cç]as|commits|github|gitgub|gtop|git[ -]+ob)\b/i.test(params.prompt) ||
      /\b(?:corrija|corrige|conserte|conserta|arrume|arruma|repare|resolva|audite|varra|faca|faça|execute|inicie|rode|aplique|ative|retome|habilite|desative|pause|pare|quero|pode)\b/i.test(params.prompt);
    if (!potential) return null;
    const tenantId = params.tenantId || `user:${params.userId}`;
    if (params.projectId) await MemoryService.assertScopeAccess(params.userId, tenantId, 'project', params.projectId);
    const history = await ConversationContextService.load({ userId: params.userId, tenantId,
      conversationId: params.conversationId, projectId: params.projectId, prompt: params.prompt, operationalOnly: true });
    const topic = history.continuity?.activeTopic;
    const recentMessages = [...history.recentMessages, ...(topic ? [{ role: 'user', content: topic.content }] : [])];
    if (!isOwnSiteRequest(params.prompt, recentMessages)) return null;
    if (!agentValidationIntent(params.prompt, recentMessages) && !isOwnSiteCapabilityQuestion(params.prompt) && !isOwnSiteAccessFollowUp(params.prompt) &&
        !isOwnSiteAgentQuestion(params.prompt, recentMessages) &&
        !isOwnSiteChangesQuestion(params.prompt, recentMessages) &&
        !requestsOwnSiteAction(params.prompt, recentMessages) && requestedOwnSiteToggle(params.prompt, recentMessages) === null) return null;
    if (params.abortSignal?.aborted) throw new Error('Solicitacao cancelada antes do controle administrativo.');
    const startedAt = new Date().toISOString();
    const control = await SelfSiteOwnerService.control({ role: params.trustedUserRole, userId: params.userId,
      prompt: params.prompt, recentMessages });
    if (!control) return null;
    const text = formatSelfSiteControlReceipt(control, params.prompt);
    let executionId = `site-control-${randomUUID()}`;
    try {
      executionId = await ExecutionTraceService.createTrace({ userId: params.userId,
        conversationId: params.conversationId || null, projectId: params.projectId || null, mode: params.mode,
        selectedModel: 'operational-control', fallbackModels: [], attemptedModels: [], status: 'completed',
        promptVersion: 'self-site-control-v1', inputTokens: 0, outputTokens: 0, cachedTokens: 0,
        estimatedCredits: 0, consumedCredits: 0, reservationId: 'not_required_local_control',
        latencyMs: Date.now() - Date.parse(startedAt), fallbackUsed: false, correlationId, errorCode: null,
        createdAt: startedAt, startedAt, completedAt: new Date().toISOString(), toolsRequested: ['self_site_control'] });
    } catch (error) { console.warn('Recibo administrativo preservado; trace indisponivel.', error); }
    if (adminDb && params.conversationId) {
      try {
        const batch = adminDb.batch();
        const timestamp = FieldValue.serverTimestamp();
        for (const [role, content, order] of [['user', params.prompt, 0], ['assistant', text, 1]] as const) {
          batch.set(adminDb.collection('messages').doc(`msg_${role === 'user' ? 'usr' : 'ast'}_${executionId}`), {
            userId: params.userId, tenantId, conversationId: params.conversationId, role, content, executionId,
            messageOrder: order, model: role === 'assistant' ? 'operational-control' : null,
            origin: 'self_site_control', createdAt: timestamp }, { merge: true });
        }
        batch.update(adminDb.collection('conversations').doc(params.conversationId), { updatedAt: timestamp });
        await batch.commit();
      } catch (error) { console.warn('Recibo administrativo preservado; historico indisponivel.', error); }
    }
    return { text, modelUsed: 'operational-control', executionId, consumedCredits: 0, citations: [], fallbackUsed: false,
      operationalControl: control, evidence: { researchStatus: 'not_requested', ragStatus: 'not_requested',
        socialSearchStatus: 'not_requested', siteAuditStatus: 'not_requested', siteAuditPages: 0,
        sourceCount: 0, sourceDomains: [], socialPlatforms: [] } };
  }
}
