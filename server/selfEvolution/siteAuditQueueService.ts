import { createHash } from 'node:crypto';
import { adminDb } from '../lib/firebaseAdmin.js';
import { SelfEvolutionPolicyEngine } from './selfEvolutionPolicyEngine.js';
import { RESUMABLE_STATES } from './runnerContinuationPolicy.js';
import type { ProductionFinding } from './productionSiteAuditDiscoveryService.js';
import type { ImprovementCandidate } from './selfEvolutionTypes.js';

interface QueueContext {
  origin: string; auditId: string; generation: string; commitSha: string; now: Date; manual: boolean;
}
export function planAuditQueue(previous: Record<string, any> | undefined, previousSha: unknown, context: {
  commitSha: string; manual: boolean;
}): 'reuse' | 'create' | 'wait' {
  if (!previous) return 'create';
  if (!previous.deletedAt && RESUMABLE_STATES.has(previous.state) && previous.state !== 'ci_failed') return 'reuse';
  if (context.manual || previousSha !== context.commitSha || previous.state === 'accepted') return 'create';
  return 'wait';
}

/** Reconcile observed faults with the queue; historical terminal tasks never swallow a new manual request. */
export class SiteAuditQueueService {
  static async enqueue(findings: ProductionFinding[], context: QueueContext) {
    const candidateIds: string[] = [];
    const blockedCandidates: Array<{ candidateId: string; state: string; reason: string }> = [];
    let createdCount = 0;
    const grouped = new Map<string, ProductionFinding[]>();
    for (const finding of findings) {
      const key = finding.code + '|' + finding.probableFiles.join('|');
      grouped.set(key, [...(grouped.get(key) || []), finding]);
    }
    for (const [signature, issues] of grouped) {
      const first = issues[0];
      const issueHash = createHash('sha256').update(context.origin + '|' + signature).digest('hex');
      const candidateId = 'site-' + issueHash.slice(0, 24) + '-' + context.commitSha.slice(0, 8) + '-' + context.generation.replace(/-/g, '');
      const ref = adminDb.collection('self_evolution_candidates').doc(candidateId);
      const signatureRef = adminDb.collection('self_evolution_site_issue_signatures').doc(issueHash);
      const result = await adminDb.runTransaction(async tx => {
        const signatureDoc = await tx.get(signatureRef);
        const previousId = signatureDoc.data()?.candidateId;
        const previous = typeof previousId === 'string'
          ? await tx.get(adminDb.collection('self_evolution_candidates').doc(previousId)) : null;
        const prior = previous?.exists ? previous.data() : undefined;
        const decision = planAuditQueue(prior, signatureDoc.data()?.repositorySha, context);
        if (decision === 'reuse') return { id: previousId as string, created: false };
        if (decision === 'wait') return { blocked: {
          candidateId: previousId as string, state: String(prior?.state || 'unknown'),
          reason: prior?.deletedAt ? 'Tarefa excluída pelo administrador nesta versão. Um novo pedido manual pode investigar a falha novamente.'
            : 'Tentativa anterior encerrada nesta versão. A próxima investigação pode ser solicitada manualmente.',
        } };
        const existing = await tx.get(ref);
        if (existing.exists) {
          if (existing.data()?.deletedAt) return { blocked: { candidateId, state: 'cancelled', reason: 'Esta tarefa foi excluída; nenhum registro histórico foi reativado.' } };
          return { id: candidateId, created: false };
        }
        const riskLevel = SelfEvolutionPolicyEngine.classifyRisk(first.probableFiles);
        const now = context.now.toISOString();
        const candidate: ImprovementCandidate = {
          id: candidateId, title: '[Auditoria do site] ' + first.code,
          summary: issues.length + ' ocorrência(s) observada(s). ' + first.message + ' Reproduzir a causa no código antes da correção.',
          evidence: ['self_evolution_site_audits/' + context.auditId + '/generations/' + context.generation,
            'self_evolution_repository_index/' + context.commitSha,
            ...issues.slice(0, 8).map(i => i.url + ' | ' + i.evidence),
            ...(prior ? ['Tentativa anterior: ' + previousId + '; estado ' + prior.state + '. Esta é uma investigação nova; o histórico anterior foi preservado.'] : [])],
          frequency: issues.length, affectedUsersCount: 0, severity: first.severity, confidence: 0.9,
          affectedComponents: ['production-site', first.code], probableFiles: first.probableFiles,
          hypothesis: 'Investigar ' + first.code + ' no código e seus dependentes com a evidência observada.',
          expectedBehavior: 'O cenário observado deve passar no navegador sem introduzir novas falhas.',
          riskLevel, estimatedCostCredits: 10,
          testPlan: 'Reproduzir ' + first.code + ', criar teste de regressão e executar typecheck, testes, build e navegador.',
          rollbackStrategy: 'Reverter o PR e restaurar a publicação anterior verificada.',
          duplicates: [], requiresApproval: riskLevel === 'R2' || riskLevel === 'R3',
          state: 'detected', createdAt: now, updatedAt: now,
        };
        tx.create(ref, candidate);
        tx.set(signatureRef, { candidateId, issueCode: first.code, detectedAt: now, repositorySha: context.commitSha,
          generation: context.generation, ...(typeof previousId === 'string' ? { previousCandidateId: previousId } : {}) });
        return { id: candidateId, created: true };
      });
      if (result.blocked) blockedCandidates.push(result.blocked);
      else if (result.id) { candidateIds.push(result.id); if (result.created) createdCount++; }
    }
    return { candidateIds, createdCount, blockedCandidates };
  }
}
