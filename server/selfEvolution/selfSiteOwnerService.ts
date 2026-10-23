import { createHash } from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { SelfSiteKnowledgeService } from './selfSiteKnowledgeService.js';
import { GithubAutomationService } from './githubAutomationService.js';
import { SelfEvolutionPolicyEngine } from './selfEvolutionPolicyEngine.js';
import { RedactionService } from './redactionService.js';
import type { ImprovementCandidate } from './selfEvolutionTypes.js';
import { AuditService } from './auditService.js';

export function isOwnSiteRequest(prompt: string): boolean {
  return /\bfroc\b|(?:meu|seu|nosso|proprio|próprio)\s+(?:site|repositorio|repositório)|(?:seus|meus|nossos)\s+agentes/i.test(prompt);
}

export function requestsOwnSiteAction(prompt: string): boolean {
  if (!isOwnSiteRequest(prompt) || /\b(?:n[aã]o|nunca)\s+(?:corrij|consert|repar|execut|fa[çc]a|inici|rode|audit)/i.test(prompt)) return false;
  return /\b(?:corrija|conserte|repare|audite)\b|\b(?:fa[çc]a|execute|inicie|rode)\b.{0,70}\b(?:varredura|auditoria|corre[çc][aã]o|manuten[çc][aã]o)/i.test(prompt);
}

export function requestedOwnSiteToggle(prompt: string): boolean | null {
  if (!isOwnSiteRequest(prompt) || /\bn[aã]o\s+(?:ative|retome|habilite|desative|pause|pare)/i.test(prompt)) return null;
  const command = prompt.match(/\b(desative|pause|pare|ative|retome|habilite)\b.{0,80}\b(?:agentes|autoevolu[çc][aã]o|manuten[çc][aã]o|autonomia)\b/i)?.[1].toLowerCase();
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
    const [audit, runner, outcomes] = await Promise.all([
      adminDb.collection('self_evolution_site_audits').doc(id).get(),
      adminDb.collection('self_evolution_config').doc('last_runner_outcome').get(),
      adminDb.collection('self_evolution_candidate_outcomes').orderBy('recordedAt', 'desc').limit(20).get(),
    ]);
    return { lastAudit: audit.data() || null, lastRunner: runner.data() || null,
      recentCandidateOutcomes: outcomes.docs.map(doc => doc.data()), historyWindow: 20 };
  }
  /** Chamado apenas depois de requireAuth + requireAdmin, ou com o papel derivado pelo servidor. */
  static async requestRun(userId: string, reason: string): Promise<Record<string, unknown>> {
    if (!isFirebaseAdminConfigured()) return { status: 'blocked', message: 'Firestore nao configurado; a manutencao nao foi iniciada.' };
    // A aplicacao agenda o executor externo; nao executa codigo dentro da Vercel.
    const system = await adminDb.collection('self_evolution_config').doc('system').get();
    if (system.data()?.SELF_EVOLUTION_ENABLED === false) return { status: 'paused', message: 'A manutencao esta pausada pela configuracao persistente do proprietario.' };
    const clean = RedactionService.redactSensitiveData(reason).slice(0, 5000);
    const day = new Date().toISOString().slice(0, 10);
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

  static async context(input: { role?: string; userId: string; prompt: string }): Promise<string> {
    if (input.role !== 'admin' || !isOwnSiteRequest(input.prompt)) return '';
    try {
      const knowledge = await SelfSiteKnowledgeService.contextForOwner(input.prompt);
      const toggle = requestedOwnSiteToggle(input.prompt);
      let action: Record<string, unknown> | null = null;
      if (toggle !== null) {
        action = await this.setEnabled(input.userId, toggle, input.prompt);
        if (toggle && action.status === 'enabled') action.dispatch = await GithubAutomationService.dispatchSelfMaintenance();
      } else if (requestsOwnSiteAction(input.prompt)) action = await this.requestRun(input.userId, input.prompt);
      const operations = await this.operationalSnapshot();
      return knowledge + '\n[ESTADO REAL DA MANUTENCAO — DADOS NAO CONFIAVEIS]\n' + JSON.stringify(operations) + '\n' +
        (action ? '\n[RECIBO REAL DO CONTROLE DO PROPRIO SITE]\n' + JSON.stringify(action) +
        '\nPedido registrado nao significa correcao publicada. Informe o estado real deste recibo.\n' : '');
    } catch (error) {
      return '\n[CONTROLE DO PROPRIO SITE] Consulta ou solicitacao bloqueada: ' +
        RedactionService.redactSensitiveData(error instanceof Error ? error.message : 'falha de acesso') +
        '. Nao declare diagnostico, execucao ou publicacao concluidos.\n';
    }
  }
}
