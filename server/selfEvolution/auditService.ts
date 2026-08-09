import crypto from 'crypto';
import { AuditRecord, RiskLevel } from './selfEvolutionTypes.js';

export class AuditService {
  private static auditLogs: AuditRecord[] = [];
  private static lastHash: string = '0000000000000000000000000000000000000000000000000000000000000000';

  static logEvent(params: {
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
  }): AuditRecord {
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
      previousState: params.previousState,
      newState: params.newState,
      reason: params.reason,
      riskLevel: params.riskLevel,
      result: params.result,
      correlationId: params.correlationId,
      commitHash: params.commitHash,
      prUrl: params.prUrl,
      deployUrl: params.deployUrl,
      previousRecordHash: this.lastHash,
      recordHash,
      timestamp,
    };

    this.auditLogs.unshift(record);
    this.lastHash = recordHash;

    return record;
  }

  static getAuditLogs(limit: number = 50): AuditRecord[] {
    return this.auditLogs.slice(0, limit);
  }
}
