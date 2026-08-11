import crypto from 'crypto';
import { adminDb, hasFullServiceAccountCredentials } from '../lib/firebaseAdmin.js';
import { AuditRecord, RiskLevel } from './selfEvolutionTypes.js';

export class AuditService {
  private static inMemoryLogs: AuditRecord[] = [];
  private static lastHash: string = '0000000000000000000000000000000000000000000000000000000000000000';

  private static isDbConfigured(): boolean {
    return hasFullServiceAccountCredentials() || Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  }

  private static async getLatestHash(): Promise<string> {
    if (this.isDbConfigured()) {
      try {
        const snapshot = await adminDb
          .collection('self_evolution_audit_logs')
          .orderBy('timestamp', 'desc')
          .limit(1)
          .get();

        if (!snapshot.empty) {
          const latestDoc = snapshot.docs[0].data() as AuditRecord;
          if (latestDoc.recordHash) {
            return latestDoc.recordHash;
          }
        }
      } catch (err) {
        console.warn('⚠️ Erro ao buscar último hash da trilha no Firestore:', (err as any)?.message || err);
      }
    }
    return this.lastHash;
  }

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

    if (this.isDbConfigured()) {
      const docRef = adminDb.collection('self_evolution_audit_logs').doc(id);
      try {
        return await adminDb.runTransaction(async (transaction) => {
          // Busca o registro mais recente em transação para garantir encadeamento forte
          const query = adminDb.collection('self_evolution_audit_logs').orderBy('timestamp', 'desc').limit(1);
          const snapshot = await transaction.get(query);

          let previousRecordHash = '0000000000000000000000000000000000000000000000000000000000000000';
          if (!snapshot.empty) {
            const latest = snapshot.docs[0].data() as AuditRecord;
            if (latest.recordHash) {
              previousRecordHash = latest.recordHash;
            }
          }

          const rawToHash = JSON.stringify({
            id,
            actor: params.actor,
            action: params.action,
            resource: params.resource,
            result: params.result,
            timestamp,
            previousHash: previousRecordHash,
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
            previousRecordHash,
            recordHash,
            timestamp,
          };

          transaction.set(docRef, record);
          this.lastHash = recordHash;
          this.inMemoryLogs.unshift(record);
          return record;
        });
      } catch (err) {
        console.warn('⚠️ Transação do Firestore falhou para AuditLog, utilizando encadeamento local:', (err as any)?.message || err);
      }
    }

    const previousRecordHash = await this.getLatestHash();
    const rawToHash = JSON.stringify({
      id,
      actor: params.actor,
      action: params.action,
      resource: params.resource,
      result: params.result,
      timestamp,
      previousHash: previousRecordHash,
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
      previousRecordHash,
      recordHash,
      timestamp,
    };

    this.lastHash = recordHash;
    this.inMemoryLogs.unshift(record);
    return record;
  }

  static async getAuditLogs(limit: number = 50): Promise<AuditRecord[]> {
    if (this.isDbConfigured()) {
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
