import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  adminDb,
  isFirebaseAdminConfigured,
} from '../lib/firebaseAdmin.js';
import { RedactionService } from '../selfEvolution/redactionService.js';

export type SecurityEventSeverity =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export type SecurityIncidentStatus =
  | 'open'
  | 'investigating'
  | 'contained'
  | 'resolved';

export interface SecurityEventInput {
  category:
    | 'cross_site_mutation'
    | 'invalid_content_type'
    | 'unsafe_payload'
    | 'rate_limit'
    | 'authentication_failure'
    | 'authorization_failure'
    | 'prompt_injection'
    | 'secret_exposure_attempt'
    | 'provider_integrity_failure';
  severity: SecurityEventSeverity;
  correlationId: string;
  sourceIp?: string | null;
  userId?: string | null;
  tenantId?: string | null;
  route?: string | null;
  details?: Record<string, unknown>;
  occurredAt?: string;
}

export interface SecurityEventRecord extends SecurityEventInput {
  eventId: string;
  fingerprint: string;
  occurredAt: string;
  details: Record<string, unknown>;
}

export interface SecurityIncident {
  incidentId: string;
  fingerprint: string;
  category: SecurityEventInput['category'];
  severity: SecurityEventSeverity;
  status: SecurityIncidentStatus;
  eventCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCorrelationId: string;
  assigneeUserId: string | null;
  resolutionSummary: string | null;
  playbook: string;
  updatedAt: string;
}

export interface SecurityEventRepository {
  appendEvent(event: SecurityEventRecord): Promise<void>;
  upsertIncident(incident: SecurityIncident): Promise<SecurityIncident>;
  getIncident(incidentId: string): Promise<SecurityIncident | null>;
  updateIncident(incident: SecurityIncident): Promise<SecurityIncident>;
  listIncidents(limit: number): Promise<SecurityIncident[]>;
}

const severityRank: Record<SecurityEventSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const allowedTransitions: Record<SecurityIncidentStatus, SecurityIncidentStatus[]> = {
  open: ['investigating', 'contained'],
  investigating: ['contained', 'resolved'],
  contained: ['investigating', 'resolved'],
  resolved: ['investigating'],
};

function stableFingerprint(input: SecurityEventInput): string {
  return crypto
    .createHash('sha256')
    .update(
      [
        input.category,
        input.tenantId || 'unknown-tenant',
        input.userId || 'anonymous',
        input.route || 'unknown-route',
      ].join(':'),
      'utf8'
    )
    .digest('hex');
}

function incidentIdFor(fingerprint: string): string {
  return `incident_${fingerprint.slice(0, 40)}`;
}

function incidentPlaybook(category: SecurityEventInput['category']): string {
  const playbooks: Record<SecurityEventInput['category'], string> = {
    cross_site_mutation: 'audit-evidence/runbooks/security-incident.md#cross-site',
    invalid_content_type: 'audit-evidence/runbooks/security-incident.md#input',
    unsafe_payload: 'audit-evidence/runbooks/security-incident.md#input',
    rate_limit: 'audit-evidence/runbooks/security-incident.md#abuse',
    authentication_failure: 'audit-evidence/runbooks/security-incident.md#identity',
    authorization_failure: 'audit-evidence/runbooks/security-incident.md#identity',
    prompt_injection: 'audit-evidence/runbooks/security-incident.md#prompt-injection',
    secret_exposure_attempt: 'audit-evidence/runbooks/security-incident.md#secrets',
    provider_integrity_failure: 'audit-evidence/runbooks/security-incident.md#provider',
  };
  return playbooks[category];
}

export class InMemorySecurityEventRepository
  implements SecurityEventRepository
{
  readonly events: SecurityEventRecord[] = [];
  readonly incidents = new Map<string, SecurityIncident>();

  async appendEvent(event: SecurityEventRecord): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async upsertIncident(incident: SecurityIncident): Promise<SecurityIncident> {
    const current = this.incidents.get(incident.incidentId);
    const next = current
      ? {
          ...current,
          severity:
            severityRank[incident.severity] > severityRank[current.severity]
              ? incident.severity
              : current.severity,
          eventCount: current.eventCount + 1,
          lastSeenAt: incident.lastSeenAt,
          lastCorrelationId: incident.lastCorrelationId,
          updatedAt: incident.updatedAt,
          ...(current.status === 'resolved' ? { status: 'open' as const } : {}),
        }
      : incident;
    this.incidents.set(incident.incidentId, structuredClone(next));
    return structuredClone(next);
  }

  async getIncident(incidentId: string): Promise<SecurityIncident | null> {
    const incident = this.incidents.get(incidentId);
    return incident ? structuredClone(incident) : null;
  }

  async updateIncident(incident: SecurityIncident): Promise<SecurityIncident> {
    this.incidents.set(incident.incidentId, structuredClone(incident));
    return structuredClone(incident);
  }

  async listIncidents(limit: number): Promise<SecurityIncident[]> {
    return [...this.incidents.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map((incident) => structuredClone(incident));
  }
}

export class FirestoreSecurityEventRepository
  implements SecurityEventRepository
{
  async appendEvent(event: SecurityEventRecord): Promise<void> {
    await adminDb.collection('security_events').doc(event.eventId).create({
      ...event,
      persistedAt: FieldValue.serverTimestamp(),
    });
  }

  async upsertIncident(incident: SecurityIncident): Promise<SecurityIncident> {
    const ref = adminDb.collection('security_incidents').doc(incident.incidentId);
    return adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        transaction.create(ref, {
          ...incident,
          persistedAt: FieldValue.serverTimestamp(),
        });
        return incident;
      }
      const current = snapshot.data() as SecurityIncident;
      const next: SecurityIncident = {
        ...current,
        severity:
          severityRank[incident.severity] > severityRank[current.severity]
            ? incident.severity
            : current.severity,
        status: current.status === 'resolved' ? 'open' : current.status,
        eventCount: Number(current.eventCount || 0) + 1,
        lastSeenAt: incident.lastSeenAt,
        lastCorrelationId: incident.lastCorrelationId,
        updatedAt: incident.updatedAt,
      };
      transaction.set(ref, next, { merge: true });
      return next;
    });
  }

  async getIncident(incidentId: string): Promise<SecurityIncident | null> {
    const snapshot = await adminDb.collection('security_incidents').doc(incidentId).get();
    return snapshot.exists ? (snapshot.data() as SecurityIncident) : null;
  }

  async updateIncident(incident: SecurityIncident): Promise<SecurityIncident> {
    await adminDb.collection('security_incidents').doc(incident.incidentId).set(
      {
        ...incident,
        persistedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return incident;
  }

  async listIncidents(limit: number): Promise<SecurityIncident[]> {
    const snapshot = await adminDb
      .collection('security_incidents')
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();
    return snapshot.docs.map((document) => document.data() as SecurityIncident);
  }
}

export class SecurityEventService {
  constructor(
    private readonly repository: SecurityEventRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = crypto.randomUUID
  ) {}

  async record(input: SecurityEventInput): Promise<SecurityEventRecord> {
    const occurredAt = input.occurredAt || this.now().toISOString();
    if (Number.isNaN(Date.parse(occurredAt))) {
      throw new Error('invalid_security_event_timestamp');
    }
    const fingerprint = stableFingerprint(input);
    const details = RedactionService.redactValue(
      input.details || {},
      ['cookie', 'set-cookie', 'body', 'query']
    ) as Record<string, unknown>;
    const event: SecurityEventRecord = {
      ...input,
      eventId: this.createId(),
      fingerprint,
      occurredAt,
      sourceIp: input.sourceIp || null,
      userId: input.userId || null,
      tenantId: input.tenantId || null,
      route: input.route || null,
      details,
    };
    await this.repository.appendEvent(event);

    if (severityRank[input.severity] >= severityRank.high) {
      await this.repository.upsertIncident({
        incidentId: incidentIdFor(fingerprint),
        fingerprint,
        category: input.category,
        severity: input.severity,
        status: 'open',
        eventCount: 1,
        firstSeenAt: occurredAt,
        lastSeenAt: occurredAt,
        lastCorrelationId: input.correlationId,
        assigneeUserId: null,
        resolutionSummary: null,
        playbook: incidentPlaybook(input.category),
        updatedAt: occurredAt,
      });
    }
    return event;
  }

  async listIncidents(limit = 50): Promise<SecurityIncident[]> {
    return this.repository.listIncidents(Math.max(1, Math.min(100, Math.trunc(limit))));
  }

  async transitionIncident(input: {
    incidentId: string;
    status: SecurityIncidentStatus;
    actorUserId: string;
    resolutionSummary?: string;
  }): Promise<SecurityIncident> {
    const current = await this.repository.getIncident(input.incidentId);
    if (!current) throw new Error('security_incident_not_found');
    if (!allowedTransitions[current.status].includes(input.status)) {
      throw new Error('invalid_security_incident_transition');
    }
    if (input.status === 'resolved' && (input.resolutionSummary?.trim().length || 0) < 12) {
      throw new Error('security_incident_resolution_required');
    }
    const updated: SecurityIncident = {
      ...current,
      status: input.status,
      assigneeUserId: input.actorUserId,
      resolutionSummary:
        input.status === 'resolved'
          ? input.resolutionSummary!.trim().slice(0, 2000)
          : current.resolutionSummary,
      updatedAt: this.now().toISOString(),
    };
    return this.repository.updateIncident(updated);
  }
}

let runtimeService: SecurityEventService | null = null;

export function getSecurityEventService(): SecurityEventService {
  if (!runtimeService) {
    runtimeService = new SecurityEventService(
      isFirebaseAdminConfigured()
        ? new FirestoreSecurityEventRepository()
        : new InMemorySecurityEventRepository()
    );
  }
  return runtimeService;
}

export async function recordSecurityEventBestEffort(
  input: SecurityEventInput
): Promise<void> {
  try {
    await getSecurityEventService().record(input);
  } catch (error) {
    console.error('security_event_persistence_failed', {
      category: input.category,
      correlationId: input.correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
