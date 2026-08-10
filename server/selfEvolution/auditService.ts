import crypto from 'crypto';
import { adminDb } from '../lib/firebaseAdmin.js';
import { AuditRecord, RiskLevel } from './selfEvolutionTypes.js';

export class AuditService {
  private static inMemoryLogs: AuditRecord[] = [];
  private static lastHash: string = '0000000000000000000000000000000000000000000000000000000000000000';

  static async logEvent(params: {
    actor: string;
    action: string;
    resource: string;
    previousState?: any;
    newState?: any;
    reason?: string;
    riskLevel: RiskLevel;
    result: 'success' | 'failure' | 'rejected';
    correlationId?: string;
    commitHash?: string;
    prUrl?: string;
    deployUrl?: string;
  }): Promise<AuditRecord> {
    const timestamp = new Date().toISOString();
    const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const rawToHash = JSON.stringify({
      id,
      actor: params.actor,
      action: params.action,
      resource: params.resource,
      result: params.result,
      timestamp,
      previousHash: this.lastHash,
    });

    const recordHash = crypto.createHash('sha256').update(rawToHash).digest('hex');

    const record: AuditRecord = {
      id,
      actor: params.actor,
      action: params.action,
      resource: params.resource,
      previousState: params.previousState ?? null,
      newState: params.newState ?? null,
      reason: params.reason ?? null,
      riskLevel: params.riskLevel,
      result: params.result,
      correlationId: params.correlationId ?? null,
      commitHash: params.commitHash ?? null,
      prUrl: params.prUrl ?? null,
      deployUrl: params.deployUrl ?? null,
      previousRecordHash: this.lastHash,
      recordHash,
      timestamp,
    };

    this.lastHash = recordHash;
    this.inMemoryLogs.unshift(record);

    if (adminDb) {
      try {
        await adminDb.collection('self_evolution_audit_logs').doc(id).set(record);
      } catch (err) {
        console.error('Erro ao salvar audit log no Firestore:', err);
      }
    }

    return record;
  }

  static async getAuditLogs(limit: number = 50): Promise<AuditRecord[]> {
    if (adminDb) {
      try {
        const snapshot = await adminDb
          .collection('self_evolution_audit_logs')
          .orderBy('timestamp', 'desc')
          .limit(limit)
          .get();

        if (!snapshot.empty) {
          return snapshot.docs.map((doc) => doc.data() as AuditRecord);
        }
      } catch (err) {
        console.error('Erro ao consultar audit logs no Firestore:', err);
      }
    }

    return this.inMemoryLogs.slice(0, limit);
  }
}

