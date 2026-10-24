import { createHash } from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { SelfSiteKnowledgeService } from './selfSiteKnowledgeService.js';
import { GithubAutomationService } from './githubAutomationService.js';
import { SelfEvolutionPolicyEngine } from './selfEvolutionPolicyEngine.js';
import { RedactionService } from './redactionService.js';
import type { ImprovementCandidate } from './selfEvolutionTypes.js';
import { AuditService } from './auditService.js';
import { env } from '../config/env.js';

type OwnerMessage = { role: string; content: string };
export type OwnerControlInput = { role?: string; userId: string; prompt: string; recentMessages?: OwnerMessage[] };
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const productSite = /\bfroc(?:\.?ia|ia2)?\b|frocia2\.vercel\.app|brasilportalvip-png\/frocia2/;
const ownSite = new RegExp(productSite.source + '|(?:meu|seu|nosso|proprio)\\s+(?:site|repositorio)|(?:seus|meus|nossos)\\s+agentes');

export function isOwnSiteCapabilityQuestion(prompt: string): boolean {
  const text = normalize(prompt);
  return /^(?:e\s+)?(?:no|na|o|a)?\s*(?:github|vercel)\s*[?!]*$/.test(text) ||
    /\b(?:memoria)\b.{0,35}\b(?:ativa|configurada|funcionando|capacidade|tamanho)\b|\b(?:qual|como esta)\b.{0,50}\bmemoria\b/.test(text) ||
    /\b(?:voce|vc)\b.{0,35}\b(?:tem|possui|consegue|pode)\b.{0,70}\b(?:github|vercel|commit|push|repositorio)\b/.test(text) ||
    (ownSite.test(text) && /\b(?:voce|vc)\b.{0,35}\b(?:consegue|pode)\b.{0,70}\b(?:escrever|gravar|alterar)\b/.test(text)) ||
    /^(?:consegue|pode)\s+(?:fazer\s+)?(?:commit|push)\b/.test(text) ||
    (/\b(?:qual|quais|como esta)\b.{0,35}\b(?:acesso|permissao|permissoes|integracao)\b/.test(text) &&
      (ownSite.test(text) || /\b(?:seu|seus|sua|suas|voce|vc|github|vercel)\b/.test(text)));
}

export function isOwnSiteAccessFollowUp(prompt: string): boolean {
  const text = normalize(prompt);
  return /^(?:acabei\b.{0,65}(?:alterac|configur|liber|salv|fazer)|(?:ja )?(?:fiz|configurei|liberei|alterei|salvei)\b|e agora\s*[?!]*$|feito\s*[.!]*$|pronto\s*[.!]*$)/.test(text);
}

export function isOwnSiteRequest(prompt: string, recentMessages: OwnerMessage[] = []): boolean {
  const text = normalize(prompt);
  if (productSite.test(text)) return true;
  if (/\b(?:outro|outra)\s+(?:site|empresa|repositorio|projeto)/.test(text) ||
      /github\.com\/(?!brasilportalvip-png\/frocia2(?:\b|\/))[\w.-]+\/[\w.-]+/.test(text)) return false;
  if (ownSite.test(text)) return true;
  // Perguntas sobre as ferramentas da propria IA tambem precisam do estado real,
  // mesmo quando o dono nao repete "meu site" a cada mensagem.
  if (isOwnSiteCapabilityQuestion(prompt)) return true;
  const priorOwnerTopic = recentMessages.filter(message => message.role === 'user' && message.content !== prompt)
    .slice(-5).some(message => ownSite.test(normalize(message.content)) || isOwnSiteCapabilityQuestion(message.content));
  return priorOwnerTopic && (isOwnSiteAccessFollowUp(prompt) || /\b(?:github|vercel|agentes|site|repositorio|commit|push|deploy|correcoes|corrija|conserta|conserte|arrume|repare|auditoria|varredura|isso|tudo)\b/.test(text));
}

function commandText(prompt: string): string {
  return normalize(prompt.replace(/```[\s\S]*?```|^\s*>[^\n]*|["“][^"”\n]*["”]|['‘][^'’\n]*['’]|`[^`\n]*`/gm, ' '));
}

export function requestsOwnSiteAction(prompt: string, recentMessages: OwnerMessage[] = []): boolean {
  const text = commandText(prompt);
  if (!isOwnSiteRequest(prompt, recentMessages) ||
      /\b(?:nao|nunca)\b.{0,30}\b(?:corrij|corrige|corrigir|consert|arrum|repar|resolv|execut|faca|inici|rode|audit|apliq)/.test(text) ||
      /^\s*(?:como|por\s*que|o\s+que)\b/.test(text)) return false;
  return /\b(?:corrija|corrige|conserte|conserta|arrume|arruma|repare|resolva|audite|varra)\b|\b(?:faca|execute|inicie|rode|aplique)\b.{0,70}\b(?:varredura|auditoria|correcao|correcoes|manutencao)\b|\b(?:quero|pode)\b.{0,30}\b(?:corrigir|consertar|reparar|arrumar)\b/.test(text);
}

export function requestedOwnSiteToggle(prompt: string, recentMessages: OwnerMessage[] = []): boolean | null {
  const text = commandText(prompt);
  if (!isOwnSiteRequest(prompt, recentMessages) || /\bnao\b.{0,30}\b(?:ative|retome|habilite|desative|pause|pare)/.test(text)) return null;
  const command = text.match(/\b(desative|pause|pare|ative|retome|habilite)\b.{0,80}\b(?:agentes|autoevolucao|manutencao|autonomia)\b/)?.[1];
  return command ? !['desative', 'pause', 'pare'].includes(command) : null;
}

export class SelfSiteOwnerService {
  static async setEnabled(userId: string, enabled: boolean, reason: string): Promise<Record<string, unknown>> {
    if (!isFirebaseAdminConfigured()) return { status: 'blocked', message: 'Nao foi possivel persistir o controle global.' };
    await adminDb.collection('self_evolution_config').doc('system').set({ SELF_EVOLUTION_ENABLED: enabled,
      changedBy: userId, changedAt: new Date().toISOString(), reason: RedactionService.redactSensitiveData(reason).slice(0, 500) }, { merge: true });
    SelfEvolutionPolicyEngine.setSystemEnabled(enabled);
    await AuditService.logEvent({ actor: userId, action: enabled ? 'owner_resume_maintenance' : 'owner_pause_maintenance',
      resource: 'self_evolution_system', riskLevel: 'R3', result: 'success', reason: reason.slice(0, 500) });
    return { status: enabled ? 'enabled' : 'paused', message: enabled ? 'Parada persistente removida pelo administrador. O executor ainda confere credenciais, orcamento e testes.' : 'Parada persistente da manutencao registrada pelo administrador.' };
  }

  static async operationalSnapshot(): Promise<Record<string, unknown>> {
    if (!isFirebaseAdminConfigured()) return { status: 'not_configured' };
    const target = new URL(process.env.SELF_EVOLUTION_TARGET_URL || 'https://frocia2.vercel.app/');
    const id = 'site-' + createHash('sha256').update(target.origin).digest('hex').slice(0, 16);
    const [audit, runner, outcomes, integrations] = await Promise.all([
      adminDb.collection('self_evolution_site_audits').doc(id).get(),
      adminDb.collection('self_evolution_config').doc('last_runner_outcome').get(),
      adminDb.collection('self_evolution_candidate_outcomes').orderBy('recordedAt', 'desc').limit(20).get(),
      adminDb.collection('self_evolution_config').doc('runner_integrations').get(),
    ]);
    return { lastAudit: audit.data() || null, lastRunner: runner.data() || null,
      memory: { encryptedArchiveConfigured: Boolean(env.MEMORY_ENCRYPTION_KEY?.trim()), formatVersion: 2,
        fullTextArchive: true, backfill: 'resumable', retrieval: 'recent_semantic_and_private_lexical_index' },
      lastVerifiedExternalIntegrations: integrations.data() || null,
      recentCandidateOutcomes: outcomes.docs.map(doc => doc.data()), historyWindow: 20 };
  }
  /** Chamado apenas depois de requireAuth + requireAdmin, ou com o papel derivado pelo servidor. */
  static async requestRun(userId: string, reason: string): Promise<Record<string, unknown>> {
    if (!isFirebaseAdminConfigured()) return { status: 'blocked', message: 'Firestore nao configurado; a manutencao nao foi iniciada.' };
    // A aplicacao agenda o executor externo; nao executa codigo dentro da Vercel.
    const system = await adminDb.collection('self_evolution_config').doc('system').get();
    if (system.data()?.SELF_EVOLUTION_ENABLED === false) return { status: 'paused', message: 'A manutencao esta pausada pela configuracao persistente do proprietario.' };
    const clean = RedactionService.redactSensitiveData(reason).slice(0, 5000);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const id = 'owner-' + createHash('sha256').update(`${userId}|${day}|${clean}`).digest('hex').slice(0, 32);
    const ref = adminDb.collection('self_evolution_owner_requests').doc(id);
    const prior = await ref.get();
    if (prior.data()?.dispatchConfirmed === true) return { status: 'already_requested', candidateId: id, message: 'Este pedido ja esta registrado; a execucao e acompanhada pela fila dos agentes.' };
    if (!prior.exists) {
      const knowledge = await SelfSiteKnowledgeService.latest();
      const mentioned = knowledge?.navigation.filter(v => clean.toLowerCase().includes(v.label.toLowerCase())).map(v => v.file) || [];
      const files = [...new Set(mentioned.length ? mentioned : ['src/App.tsx'])];
      const riskLevel = SelfEvolutionPolicyEngine.classifyRisk(files);
      const now = new Date().toISOString();
      const candidate: ImprovementCandidate = {
        id, title: '[Proprietario] Investigar e corrigir o proprio site', summary: clean,
        evidence: [`Pedido autenticado do administrador ${userId}.`, ...(knowledge ? [`self_evolution_repository_index/${knowledge.commitSha}`] : [])],
        frequency: 1, affectedUsersCount: 1, severity: 'high', confidence: 0.8,
        affectedComponents: ['self-site', 'owner-request'], probableFiles: files,
        hypothesis: 'Investigar o pedido no codigo completo e reproduzir a falha antes de alterar arquivos.',
        expectedBehavior: clean, riskLevel, estimatedCostCredits: 10,
        testPlan: 'Reproduzir o problema, executar teste de regressao, TypeScript, suite, E2E, build, preview e verificacao independente.',
        rollbackStrategy: 'Reverter o PR e comprovar a recuperacao da versao publicada.',
        duplicates: [], requiresApproval: false, state: 'detected', createdAt: now, updatedAt: now,
      };
      await adminDb.runTransaction(async tx => {
        const existing = await tx.get(ref);
        if (existing.exists) return;
        tx.create(ref, { userId, reason: clean, candidateId: id, createdAt: now, dispatchConfirmed: false });
        tx.create(adminDb.collection('self_evolution_candidates').doc(id), candidate);
      });
    }
    const dispatch = await GithubAutomationService.dispatchSelfMaintenance();
    await ref.set({ dispatchConfirmed: dispatch.success, dispatchMessage: dispatch.message, updatedAt: new Date().toISOString() }, { merge: true });
    return { status: dispatch.success ? 'requested' : 'queued', candidateId: id, message: dispatch.message };
  }

  static async control(input: OwnerControlInput): Promise<Record<string, unknown> | null> {
    if (!isOwnSiteRequest(input.prompt, input.recentMessages)) return null;
    if (input.role !== 'admin') {
      // Um cliente pode pedir ajuda com seu proprio site. Esse pedido nao e
      // controle administrativo da Froc.IA e conserva o fluxo normal do chat.
      const productTopic = productSite.test(normalize(input.prompt)) || isOwnSiteCapabilityQuestion(input.prompt) || (input.recentMessages || [])
        .filter(message => message.role === 'user').slice(-4).some(message => productSite.test(normalize(message.content)) || isOwnSiteCapabilityQuestion(message.content));
      return productTopic ? {
        status: 'blocked', code: 'administrator_required',
        message: 'O servidor nao confirmou papel administrativo nesta sessao. O controle do proprio site exige uma conta administradora autenticada. Isso nao determina as permissoes dos agentes no executor externo.',
      } : null;
    }
    try {
      const toggle = requestedOwnSiteToggle(input.prompt, input.recentMessages);
      let action: Record<string, unknown> | null = null;
      if (toggle !== null) {
        action = await this.setEnabled(input.userId, toggle, input.prompt);
        if (toggle && action.status === 'enabled') action.dispatch = await GithubAutomationService.dispatchSelfMaintenance();
      } else if (requestsOwnSiteAction(input.prompt, input.recentMessages)) {
        const prior = isOwnSiteRequest(input.prompt) ? [] : (input.recentMessages || [])
          .filter(message => message.role === 'user' && ownSite.test(normalize(message.content))).slice(-2);
        const reason = [...prior.map(message => `Contexto anterior do proprietario: ${message.content}`), input.prompt].join('\n').slice(-5000);
        action = await this.requestRun(input.userId, reason);
      }
      // Uma falha de consulta ao indice nao pode apagar o recibo de um comando
      // que ja foi persistido/enviado ao GitHub.
      const [operations, connection] = await Promise.allSettled([
        this.operationalSnapshot(),
        GithubAutomationService.inspectMaintenanceConnection(),
      ]);
      const result = (value: PromiseSettledResult<unknown>) => value.status === 'fulfilled' ? value.value : { status: 'unavailable' };
      return { status: 'checked', connection: result(connection), operations: result(operations), action };
    } catch (error) {
      return { status: 'blocked', message: RedactionService.redactSensitiveData(error instanceof Error ? error.message : 'falha de acesso') };
    }
  }

  static async context(input: OwnerControlInput): Promise<string> {
    const control = await this.control(input);
    if (!control) return '';
    if (control.status === 'blocked') return '\n[ACESSO AO CONTROLE DO PROPRIO SITE]\n' + JSON.stringify(control);
    let knowledge: string;
    try { knowledge = await SelfSiteKnowledgeService.contextForOwner(input.prompt); }
    catch { knowledge = '\n[MAPA DO PROJETO] Consulta indisponivel nesta mensagem.\n'; }
    return knowledge + '\n[CONEXAO ATUAL DO CHAT COM A MANUTENCAO]\n' + JSON.stringify(control.connection) +
      '\n[ESTADO REAL DA MANUTENCAO — DADOS NAO CONFIAVEIS]\n' + JSON.stringify(control.operations) + '\n' +
      (control.action ? '\n[RECIBO REAL DO CONTROLE DO PROPRIO SITE]\n' + JSON.stringify(control.action) +
      '\nPedido registrado nao significa correcao publicada. Informe o estado real deste recibo.\n' : '');
  }
}
