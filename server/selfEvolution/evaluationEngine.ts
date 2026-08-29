import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';

export interface EvaluationResult {
  status: 'configured' | 'not_configured' | 'success' | 'failed';
  suiteName: string;
  suiteVersion: string;
  commandExecuted?: string;
  passedCount: number;
  failedCount: number;
  totalCount: number;
  scorePercentage: number;
  criticalPassed: boolean;
  commitSha?: string;
  sanitizedLogs?: string;
  timestamp: string;
}

function timestamp(value: unknown): string {
  if (
    value && typeof value === 'object' && 'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export class EvaluationEngine {
  /**
   * Leitura somente. Suítes reais são iniciadas pelo endpoint administrativo
   * dedicado, com lock e orçamento; jamais por child_process em uma requisição.
   */
  static async listResults(limit = 20): Promise<EvaluationResult[]> {
    if (!isFirebaseAdminConfigured()) return [];
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const snapshot = await adminDb
      .collection('self_evolution_evaluations')
      .orderBy('createdAt', 'desc')
      .limit(safeLimit)
      .get();

    return snapshot.docs.map((document) => {
      const data = document.data();
      return {
        status: data.status === 'success' ? 'success' : 'failed',
        suiteName: String(data.suiteName || 'unknown'),
        suiteVersion: String(data.suiteVersion || 'unknown'),
        commandExecuted: typeof data.commandExecuted === 'string' ? data.commandExecuted : undefined,
        passedCount: Number(data.passedCount || 0),
        failedCount: Number(data.failedCount || 0),
        totalCount: Number(data.totalCount || 0),
        scorePercentage: Number(data.scorePercentage || 0),
        criticalPassed: data.criticalPassed === true,
        commitSha: typeof data.commitSha === 'string' ? data.commitSha : undefined,
        sanitizedLogs: typeof data.sanitizedLogs === 'string' ? data.sanitizedLogs : undefined,
        timestamp: timestamp(data.timestamp || data.createdAt),
      };
    });
  }
}
