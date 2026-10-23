import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';

interface RecoveryContext {
  sourceSha: string;
  runId: string;
  manual: boolean;
  now: Date;
}

// Uma falha anterior nao pode sumir da fila nem gerar cobrancas sem limite.
// Cada versao pode retomar automaticamente uma vez por dia; o dono pode
// solicitar outra tentativa manual. Em ambos os casos, o teto e tres retomadas.
export function planWorkerFailureRecovery(candidate: Record<string, unknown>, context: RecoveryContext): Record<string, unknown> | null {
  if (candidate.state !== 'tests_failed' || candidate.pullRequestUrl || candidate.productionMergeSha ||
      !/^[a-f0-9]{40}$/i.test(context.sourceSha) || !context.runId) return null;
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(context.now);
  const prior = candidate.workerRecovery as Record<string, unknown> | undefined;
  if (prior?.runId === context.runId) return null;
  const sameDay = prior?.dateKey === dateKey;
  const count = sameDay && Number.isSafeInteger(prior?.count) ? Number(prior.count) : 0;
  const sourceShas = sameDay && Array.isArray(prior?.sourceShas)
    ? prior.sourceShas.filter((sha): sha is string => typeof sha === 'string') : [];
  if (count >= 3 || (!context.manual && sourceShas.includes(context.sourceSha))) return null;
  return {
    state: 'detected', updatedAt: context.now.toISOString(),
    workerRecovery: { dateKey, count: count + 1, runId: context.runId,
      sourceShas: [...new Set([...sourceShas, context.sourceSha])],
      previousState: 'tests_failed', requestedManually: context.manual },
  };
}

export class WorkerFailureRecoveryService {
  static async recoverNext(context: RecoveryContext): Promise<string | undefined> {
    if (!isFirebaseAdminConfigured()) throw new Error('Retomada do worker exige Firestore persistente.');
    const snapshot = await adminDb.collection('self_evolution_candidates').where('state', '==', 'tests_failed').get();
    const failed = [...snapshot.docs].sort((a, b) => String(a.data().updatedAt).localeCompare(String(b.data().updatedAt)));
    for (const doc of failed) {
      const recovered = await adminDb.runTransaction(async tx => {
        const current = await tx.get(doc.ref);
        if (!current.exists) return false;
        const update = planWorkerFailureRecovery(current.data()!, context);
        if (!update) return false;
        tx.update(doc.ref, update);
        return true;
      });
      if (recovered) return doc.id;
    }
    return undefined;
  }
}
