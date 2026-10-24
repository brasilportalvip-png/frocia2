import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';
import { SelfSiteOwnerService, isOwnSiteAccessFollowUp, isOwnSiteCapabilityQuestion,
  isOwnSiteRequest, requestedOwnSiteToggle, requestsOwnSiteAction } from '../selfEvolution/selfSiteOwnerService.js';
import { RedactionService } from '../selfEvolution/redactionService.js';
import { ConversationContextService } from './conversationContextService.js';
import { ExecutionTraceService } from './executionTraceService.js';
import { MemoryService } from './memoryService.js';
import type { ExecutionParams } from './types/ai.js';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const safe = (value: unknown) => typeof value === 'string' ? RedactionService.redactSensitiveData(value).slice(0, 2000) : '';

export function formatSelfSiteControlReceipt(control: Record<string, unknown>, prompt = ''): string {
  if (control.status === 'blocked') return safe(control.message) || 'Nao foi possivel confirmar o controle administrativo nesta sessao.';
  const action = object(control.action);
  const connection = object(control.connection);
  const operations = object(control.operations);
  const integrations = object(operations.lastVerifiedExternalIntegrations);
  const runner = object(operations.lastRunner);
  const paragraphs: string[] = [];
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
  } else paragraphs.push('Consultei o acesso real desta sessao e o estado registrado dos agentes.');
  if (connection.status) paragraphs.push(`Ligacao do chat com o GitHub: ${safe(connection.message) || safe(connection.status)}.`);
  if (object(integrations.github).contentsWriteVerified === true) {
    paragraphs.push(`Executor externo: escrita no GitHub confirmada na verificacao registrada${safe(integrations.checkedAt) ? ` em ${safe(integrations.checkedAt)}` : ''}.`);
  }
  if (runner.state || runner.status) {
    paragraphs.push(`Ultima tarefa registrada: ${safe(runner.state) || safe(runner.status)}.${safe(runner.message) ? ` ${safe(runner.message)}` : ''}`);
  }
  if (action.status === 'requested' || action.status === 'queued') paragraphs.push('Este pedido aguarda as etapas de teste, revisao e verificacao da publicacao.');
  return paragraphs.join('\n\n');
}

/** Consultas de acesso e comandos administrativos retornam o recibo do servidor,
 * sem gerar uma resposta com o modelo nem reservar creditos de conversa. */
export class SelfSiteChatControlService {
  static async respond(params: ExecutionParams, correlationId: string) {
    if (params.attachments?.length) return null;
    const potential = isOwnSiteCapabilityQuestion(params.prompt) || isOwnSiteAccessFollowUp(params.prompt) ||
      /\b(?:corrija|corrige|conserte|conserta|arrume|arruma|repare|resolva|audite|varra|faca|faça|execute|inicie|rode|aplique|ative|retome|habilite|desative|pause|pare|quero|pode)\b/i.test(params.prompt);
    if (!potential) return null;
    const tenantId = params.tenantId || `user:${params.userId}`;
    if (params.projectId) await MemoryService.assertScopeAccess(params.userId, tenantId, 'project', params.projectId);
    const history = await ConversationContextService.load({ userId: params.userId, tenantId,
      conversationId: params.conversationId, projectId: params.projectId, prompt: params.prompt, operationalOnly: true });
    const topic = history.continuity?.activeTopic;
    const recentMessages = [...history.recentMessages, ...(topic ? [{ role: 'user', content: topic.content }] : [])];
    if (!isOwnSiteRequest(params.prompt, recentMessages)) return null;
    if (!isOwnSiteCapabilityQuestion(params.prompt) && !isOwnSiteAccessFollowUp(params.prompt) &&
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
