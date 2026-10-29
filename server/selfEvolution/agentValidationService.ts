import { createHash } from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { installedSelfSiteAgentInventory } from './selfSiteKnowledgeService.js';
import { GithubAutomationService } from './githubAutomationService.js';
import { RedactionService } from './redactionService.js';

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
type Message = { role: string; content: string };
export function agentValidationIntent(prompt: string, history: Message[] = []): boolean {
  const text = normalize(prompt);
  if (/\b(?:outro|outra)\s+(?:site|empresa|projeto)|https?:\/\//.test(text)) return false;
  const prior = history.filter(m => m.role === 'user').slice(-5).some(m => /agentes|froc|homologacao/.test(normalize(m.content)));
  return (/agentes|froc/.test(text) || prior) && /homologa|evidencias|registros|funcion|integrados?|executados?|testados?|validacao/.test(text);
}
export function requestsAgentValidation(prompt: string): boolean {
  const text = normalize(prompt.replace(/```[\s\S]*?```|^\s*>[^\n]*|["“][^"”\n]*["”]|`[^`\n]*`/gm, ' '));
  if (/\b(?:nao|nunca|sem)\b|^\s*(?:como|por que|o que)\b/.test(text)) return false;
  return /\b(?:execute|inicie|rode|faca|quero executar|pode executar)\b.{0,60}\b(?:homologacao|validacao|testes)\b/.test(text);
}
const clean = (value: unknown) => RedactionService.redactSensitiveData(String(value ?? '')).slice(0, 500);

export class AgentValidationService {
  static async evidence(userId: string) {
    const inventory = installedSelfSiteAgentInventory();
    const agents = inventory.agents.map(agent => ({ id: agent.id, kind: agent.kind, evidence: [] as Array<Record<string, unknown>> }));
    const limitations: string[] = ['Leitura limitada aos 50 registros por fonte (amostra por identificador nas fontes privadas, ciclos recentes na inovação); ausência na janela não significa ausência histórica.',
      'Diretriz aplicada e contribuição registrada não comprovam qualidade ou homologação individual em produção.'];
    if (!isFirebaseAdminConfigured()) return { inventoryTotal: agents.length, agents, limitations: [...limitations, 'Firestore indisponível: não foi possível consultar execuções.'] };
    const sources = [
      { name: 'ai_executions', query: () => adminDb.collection('ai_executions').where('userId', '==', userId).limit(50).get() },
      { name: 'site_factory_builds', query: () => adminDb.collection('site_factory_builds').where('userId', '==', userId).limit(50).get() },
      { name: 'self_evolution_innovation_cycles', query: () => adminDb.collection('self_evolution_innovation_cycles').orderBy('recordedAt', 'desc').limit(50).get() },
    ];
    await Promise.all(sources.map(async source => {
      try {
        const snapshot = await source.query();
        for (const doc of snapshot.docs) {
          const row = doc.data();
          const ids: string[] = source.name === 'ai_executions'
            ? row.status === 'completed' && row.specialistPolicyApplied === true && Array.isArray(row.specialistAgentIds) ? row.specialistAgentIds : []
            : source.name === 'site_factory_builds'
              ? (Array.isArray(row.reports) ? row.reports : []).flatMap(report => (Array.isArray(report.contributions) ? report.contributions : []).map((c: { agentId?: string }) => c.agentId)).filter(Boolean)
              : typeof row.agentId === 'string' ? [row.agentId] : [];
          for (const agent of agents) if (ids.includes(agent.id) && agent.evidence.length < 3) agent.evidence.push({
            source: source.name, recordId: clean(doc.id), status: clean(row.status),
            recordedAt: clean(row.completedAt || row.recordedAt || row.updatedAt || row.createdAt),
            kind: source.name === 'ai_executions' ? 'instructions_applied' : source.name === 'site_factory_builds' ? 'contribution_recorded' : 'cycle_recorded',
          });
        }
      } catch { limitations.push(`Fonte ${source.name} indisponível. Verifique conectividade, permissões e índices do Firestore.`); }
    }));
    limitations.push('Os revisores de manutenção não possuem recibos individuais consultados por esta leitura; não foram classificados como homologados.');
    return { inventoryTotal: agents.length, agents, limitations };
  }

  static async respond(userId: string, prompt: string) {
    const evidence = await this.evidence(userId);
    if (!isFirebaseAdminConfigured()) return { ...evidence, request: { status: 'blocked', message: 'Firestore não configurado; não iniciei testes.' }, run: null, scope: 'Nenhum teste iniciado.' };
    const latestRef = adminDb.collection('self_evolution_config').doc('agent_validation_' + createHash('sha256').update(userId).digest('hex'));
    let receipt = (await latestRef.get()).data();
    if (requestsAgentValidation(prompt)) {
      // Ten-minute idempotency window; the transaction prevents duplicate dispatches.
      const requestId = 'validation-' + createHash('sha256').update(`${userId}|${Math.floor(Date.now() / 600000)}`).digest('hex').slice(0, 32);
      const ref = adminDb.collection('self_evolution_config').doc(requestId);
      const claimed = await adminDb.runTransaction(async tx => {
        const prior = await tx.get(ref);
        if (prior.exists) return false;
        tx.set(ref, { requestId, userId, status: 'dispatching', createdAt: new Date().toISOString() });
        return true;
      });
      if (claimed) {
        const result = await GithubAutomationService.agentValidationRun(requestId, true);
        receipt = { requestId, userId, ...result, requestedAt: new Date().toISOString() };
        await ref.set(receipt, { merge: true });
      } else receipt = (await ref.get()).data();
      await latestRef.set(receipt || { requestId, status: 'unavailable' });
    }
    const requestId = receipt?.requestId;
    const run = typeof requestId === 'string' ? await GithubAutomationService.agentValidationRun(requestId) : null;
    return { ...evidence, request: receipt ? { requestId, status: receipt.status, message: receipt.message } : null, run,
      scope: 'Testes automatizados do código e do navegador. Não cria projetos pagos, não altera arquivos e não publica. Integrações reais e homologação completa em produção continuam dependentes de evidências específicas.' };
  }
}

export function formatAgentValidation(value: Record<string, any>): string {
  const agents: Array<{ id: string; evidence: Array<Record<string, unknown>> }> = value.agents || [];
  const evidenced = agents.filter(agent => agent.evidence.length);
  const paragraphs = [`Consultei registros de execução, além do catálogo de ${value.inventoryTotal} perfis.`,
    `${evidenced.length} perfis com registros na janela consultada; ${agents.length - evidenced.length} sem comprovação nesta leitura.`];
  if (evidenced.length) paragraphs.push(evidenced.map(agent => `- ${agent.id}: ${agent.evidence.map(row => `${row.kind}; ${row.source}/${row.recordId}; estado ${row.status}; ${row.recordedAt}`).join(' | ')}`).join('\n'));
  const missing = agents.filter(agent => !agent.evidence.length);
  if (missing.length) paragraphs.push('Sem comprovação nesta leitura: ' + missing.map(agent => agent.id).join(', ') + '.');
  if (value.request) paragraphs.push(`Solicitação: ${clean(value.request.requestId)}. Estado do recibo: ${clean(value.request.status)}. ${clean(value.request.message)}`);
  if (value.run) {
    paragraphs.push(`Execução no GitHub: ${clean(value.run.status)}; conclusão: ${clean(value.run.conclusion) || 'pendente'}. ${clean(value.run.message)}`);
    if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(value.run.url || '')) paragraphs.push(value.run.url);
    if (/^[a-f0-9]{40}$/.test(value.run.commitSha || '')) paragraphs.push(`Commit testado: ${value.run.commitSha}.`);
  }
  paragraphs.push(...(value.limitations || []), value.scope || 'Nenhum teste foi iniciado nesta consulta.');
  return paragraphs.join('\n\n');
}
