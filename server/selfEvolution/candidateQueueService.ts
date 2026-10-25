import { randomUUID } from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { LockService } from './lockService.js';
import { AuditService } from './auditService.js';

export class CandidateQueueError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export class CandidateQueueService {
  static async remove(candidateId: string, actorUid: string): Promise<{ candidateId: string; deleted: true; alreadyDeleted: boolean }> {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(candidateId) || !actorUid) throw new CandidateQueueError(400, 'Tarefa inválida.');
    if (!isFirebaseAdminConfigured()) throw new CandidateQueueError(503, 'Não foi possível confirmar o armazenamento da tarefa.');
    const owner = 'delete-candidate-' + randomUUID();
    const lock = await LockService.acquireLock(candidateId, owner);
    if (!lock) throw new CandidateQueueError(409, 'Esta tarefa está em execução. Aguarde a conclusão para excluí-la.');
    try {
      const now = new Date().toISOString();
      const ref = adminDb.collection('self_evolution_candidates').doc(candidateId);
      const outcome = await adminDb.runTransaction(async tx => {
        const doc = await tx.get(ref);
        if (!doc.exists) throw new CandidateQueueError(404, 'Tarefa não encontrada.');
        const data = doc.data()!;
        if (data.deletedAt) return { alreadyDeleted: true, previousState: data.deletedFromState, riskLevel: data.riskLevel };
        if (['agent_running', 'approved_for_release', 'canary_deployed', 'monitoring'].includes(data.state)) {
          throw new CandidateQueueError(409, 'Esta tarefa está em execução ou verificando a publicação. Aguarde a conclusão para excluí-la.');
        }
        tx.update(ref, { state: 'cancelled', deletedAt: now, deletedBy: actorUid, deletedFromState: data.state, updatedAt: now });
        tx.set(ref.collection('queue_events').doc(randomUUID()), {
          action: 'removed_from_queue', actorUid, candidateId, previousState: data.state, createdAt: now,
        });
        return { alreadyDeleted: false, previousState: data.state, riskLevel: data.riskLevel };
      });
      if (!outcome.alreadyDeleted) {
        try {
          await AuditService.logEvent({ actor: actorUid, action: 'remove_candidate_from_queue', resource: candidateId,
            riskLevel: outcome.riskLevel || 'R1', result: 'success', previousState: outcome.previousState,
            newState: 'cancelled', reason: 'Tarefa removida da fila pelo administrador; histórico preservado.' });
        } catch {
          // O evento da exclusão e a identidade já foram gravados na mesma transação da tarefa.
          console.warn('[candidate-queue] Evento transacional preservado; indisponibilidade na cópia para a auditoria global.');
        }
      }
      return { candidateId, deleted: true, alreadyDeleted: outcome.alreadyDeleted };
    } finally { await LockService.releaseLock(candidateId, owner); }
  }
}
