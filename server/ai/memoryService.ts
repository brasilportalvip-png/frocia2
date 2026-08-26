import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';
import { UserMemory } from './types/ai.js';
import {
  assertMemoryContentAllowed,
  classifyMemorySensitivity,
  defaultPurposeForScope,
  memoryQueryFingerprint,
  MemoryPurpose,
  MemoryPolicyViolationError,
  MemorySensitivity,
  resolveRetention,
} from './memoryPolicy.js';
import {
  decryptPersonalMemory,
  encryptPersonalMemory,
} from './memoryCryptoService.js';

const MAX_CONTEXT_MEMORIES = 12;
const MAX_MANAGED_MEMORIES = 200;
const CONSENT_VERSION = 'memory-consent-v1';

type MemoryScope = UserMemory['scope'];

export interface SaveMemoryInput {
  scope: MemoryScope;
  scopeId?: string | null;
  category: string;
  content: string;
  source?: string;
  confidence?: number;
  purpose?: MemoryPurpose;
  sensitivity?: MemorySensitivity;
  retentionDays?: number;
  sourceMessageIds?: string[];
  validFrom?: string;
  validUntil?: string | null;
  status?: UserMemory['status'];
  userApproved: boolean;
  consentedAt?: string;
}

export interface MemoryAuditEvent {
  id: string;
  memoryId: string;
  action: 'created' | 'updated' | 'deleted' | 'retrieved';
  reason: string;
  occurredAt: string;
  scope?: MemoryScope;
}

export class MemoryScopeAccessError extends Error {
  constructor() {
    super('O escopo informado não pertence ao usuário e à empresa autenticados.');
    this.name = 'MemoryScopeAccessError';
  }
}

function toIsoString(value: any, fallback: string): string {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function effectiveTenantId(data: Record<string, any>): string {
  return data.tenantId || `user:${data.userId}`;
}

function effectiveValidUntil(data: Record<string, any>, now: string): string {
  if (data.validUntil) return toIsoString(data.validUntil, now);

  const createdAt = new Date(toIsoString(data.createdAt, now));
  return resolveRetention(data.scope || 'user', data.retentionDays, createdAt)
    .validUntil;
}

function readMemoryContent(data: Record<string, any>): string {
  if (data.contentCiphertext) {
    return decryptPersonalMemory(
      data,
      effectiveTenantId(data),
      data.userId
    );
  }
  return typeof data.content === 'string' ? data.content : '';
}

function mapMemory(doc: any): UserMemory {
  const data = doc.data();
  const now = new Date().toISOString();
  const scope = (data.scope || 'user') as MemoryScope;

  return {
    id: doc.id,
    userId: data.userId,
    tenantId: effectiveTenantId(data),
    scope,
    scopeId: data.scopeId || null,
    category: data.category || 'general',
    content: readMemoryContent(data),
    source: data.source || 'ai_extracted',
    confidence: data.confidence ?? 1,
    purpose: data.purpose || defaultPurposeForScope(scope),
    sensitivity: data.sensitivity || 'standard',
    retentionDays:
      data.retentionDays || resolveRetention(scope).retentionDays,
    consentVersion: data.consentVersion || 'legacy-explicit-approval',
    consentedAt: toIsoString(data.consentedAt || data.createdAt, now),
    sourceMessageIds: Array.isArray(data.sourceMessageIds)
      ? data.sourceMessageIds.filter((id: unknown) => typeof id === 'string')
      : [],
    validFrom: toIsoString(data.validFrom, now),
    validUntil: effectiveValidUntil(data, now),
    status: data.status || 'active',
    userApproved: data.userApproved === true,
    createdAt: toIsoString(data.createdAt, now),
    updatedAt: toIsoString(data.updatedAt, now),
  };
}

function normalizeTerms(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3)
  );
}

export function memoryRelevanceScore(
  memory: UserMemory,
  prompt: string
): number {
  const promptTerms = normalizeTerms(prompt);
  const memoryTerms = normalizeTerms(`${memory.category} ${memory.content}`);
  let overlap = 0;
  promptTerms.forEach((term) => {
    if (memoryTerms.has(term)) overlap += 1;
  });

  const scopeWeight =
    memory.scope === 'conversation'
      ? 3
      : memory.scope === 'project'
        ? 2
        : memory.scope === 'organization'
          ? 1
          : 0.5;
  const durablePreferenceWeight = /prefer|perfil|acess|idioma|nome|tom/i.test(
    memory.category
  )
    ? 0.75
    : 0;

  return (
    overlap * 2 +
    scopeWeight +
    durablePreferenceWeight +
    Math.max(0, Math.min(1, memory.confidence || 0))
  );
}

function retrievalReason(memory: UserMemory, score: number): string {
  const source =
    memory.scope === 'conversation'
      ? 'conversa atual'
      : memory.scope === 'project'
        ? 'projeto atual'
        : memory.scope === 'organization'
          ? 'empresa autenticada'
          : 'preferência do usuário';
  return `Selecionada por relevância (${score.toFixed(2)}) e escopo da ${source}.`;
}

function uniqueDocuments(documents: any[]): any[] {
  return [...new Map(documents.map((doc) => [doc.id, doc])).values()];
}

async function safeAudit(input: {
  userId: string;
  tenantId: string;
  memoryId: string;
  action: MemoryAuditEvent['action'];
  reason: string;
  scope?: MemoryScope;
  queryFingerprint?: string;
}): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb.collection('memory_audit_events').doc().set({
      ...input,
      occurredAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.warn('Falha ao registrar auditoria de memória:', error);
  }
}

export class MemoryService {
  static async assertScopeAccess(
    userId: string,
    tenantId: string,
    scope: MemoryScope,
    scopeId?: string | null
  ): Promise<void> {
    if (scope === 'user') return;
    if (scope === 'organization') {
      if (tenantId === `user:${userId}`) throw new MemoryScopeAccessError();
      return;
    }
    if (!adminDb || !scopeId) throw new MemoryScopeAccessError();

    const collection = scope === 'project' ? 'projects' : 'conversations';
    const snapshot = await adminDb.collection(collection).doc(scopeId).get();
    const data = snapshot.data();
    if (
      !snapshot.exists ||
      !data ||
      data.userId !== userId ||
      (data.tenantId || `user:${data.userId}`) !== tenantId
    ) {
      throw new MemoryScopeAccessError();
    }
  }

  static async getActiveMemories(
    userId: string,
    projectId?: string | null,
    conversationId?: string | null,
    prompt = '',
    tenantId = `user:${userId}`
  ): Promise<UserMemory[]> {
    if (!adminDb) return [];

    try {
      const ownQuery = adminDb
        .collection('user_memories')
        .where('userId', '==', userId)
        .where('status', '==', 'active');
      const snapshots = [await ownQuery.get()];

      if (tenantId !== `user:${userId}`) {
        snapshots.push(
          await adminDb
            .collection('user_memories')
            .where('tenantId', '==', tenantId)
            .limit(MAX_MANAGED_MEMORIES)
            .get()
        );
      }

      const now = Date.now();
      const memories: UserMemory[] = [];

      for (const doc of uniqueDocuments(snapshots.flatMap((snap) => snap.docs))) {
        try {
          const memory = mapMemory(doc);
          const validFrom = new Date(memory.validFrom).getTime();
          const validUntil = memory.validUntil
            ? new Date(memory.validUntil).getTime()
            : 0;
          const ownerEligible =
            memory.userId === userId ||
            (memory.scope === 'organization' && memory.tenantId === tenantId);
          const scopeEligible =
            memory.scope === 'user' ||
            (memory.scope === 'organization' && memory.tenantId === tenantId) ||
            (memory.scope === 'project' &&
              Boolean(projectId) &&
              memory.scopeId === projectId) ||
            (memory.scope === 'conversation' &&
              Boolean(conversationId) &&
              memory.scopeId === conversationId);

          if (
            ownerEligible &&
            memory.tenantId === tenantId &&
            memory.status === 'active' &&
            memory.userApproved &&
            validFrom <= now &&
            validUntil > now &&
            scopeEligible
          ) {
            memories.push(memory);
          }
        } catch (error) {
          console.warn(`Memória ${doc.id} ignorada por falha de política ou criptografia.`, error);
        }
      }

      const selected = memories
        .map((memory) => {
          const score = memoryRelevanceScore(memory, prompt);
          return {
            memory: {
              ...memory,
              relevanceScore: score,
              retrievalReason: retrievalReason(memory, score),
            },
            score,
          };
        })
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return b.memory.updatedAt.localeCompare(a.memory.updatedAt);
        })
        .slice(0, MAX_CONTEXT_MEMORIES)
        .map(({ memory }) => memory);

      await Promise.all(
        selected.map((memory) =>
          safeAudit({
            userId,
            tenantId,
            memoryId: memory.id,
            action: 'retrieved',
            reason: memory.retrievalReason || 'Memória relevante recuperada.',
            scope: memory.scope,
            queryFingerprint: memoryQueryFingerprint(prompt),
          })
        )
      );

      return selected;
    } catch (error) {
      console.warn('Erro ao carregar memórias do usuário:', error);
      return [];
    }
  }

  static async listMemories(
    userId: string,
    tenantId = `user:${userId}`
  ): Promise<UserMemory[]> {
    if (!adminDb) return [];

    const snapshots = [
      await adminDb
        .collection('user_memories')
        .where('userId', '==', userId)
        .limit(MAX_MANAGED_MEMORIES)
        .get(),
    ];

    if (tenantId !== `user:${userId}`) {
      snapshots.push(
        await adminDb
          .collection('user_memories')
          .where('tenantId', '==', tenantId)
          .limit(MAX_MANAGED_MEMORIES)
          .get()
      );
    }

    return uniqueDocuments(snapshots.flatMap((snapshot) => snapshot.docs))
      .map((doc) => {
        try {
          return mapMemory(doc);
        } catch {
          return null;
        }
      })
      .filter((memory): memory is UserMemory =>
        Boolean(
          memory &&
            memory.tenantId === tenantId &&
            (memory.userId === userId || memory.scope === 'organization') &&
            memory.status !== 'deleted'
        )
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_MANAGED_MEMORIES);
  }

  static async saveMemory(
    userId: string,
    memory: SaveMemoryInput,
    tenantId = `user:${userId}`
  ): Promise<string> {
    if (!adminDb) throw new Error('Banco de memória indisponível.');
    assertMemoryContentAllowed(memory.content);
    await this.assertScopeAccess(
      userId,
      tenantId,
      memory.scope,
      memory.scopeId
    );

    if (!memory.userApproved || !memory.consentedAt) {
      throw new Error('O consentimento explícito é obrigatório para salvar uma memória.');
    }
    const sensitivity = classifyMemorySensitivity(
      memory.content,
      memory.sensitivity
    );
    if (memory.scope === 'organization' && sensitivity === 'personal') {
      throw new MemoryPolicyViolationError(
        'personal_organization_memory_forbidden',
        'Dados pessoais não podem ser compartilhados como memória da empresa.'
      );
    }
    const retention = resolveRetention(
      memory.scope,
      memory.retentionDays
    );
    const validUntil = memory.validUntil || retention.validUntil;
    const contentHash = createHash('sha256')
      .update(
        `${tenantId}:${userId}:${memory.scope}:${memory.scopeId || ''}:${memory.content
          .normalize('NFKC')
          .trim()}`
      )
      .digest('hex');
    const docRef = adminDb.collection('user_memories').doc(contentHash);
    const now = FieldValue.serverTimestamp();
    const protectedContent =
      sensitivity === 'personal'
        ? encryptPersonalMemory(memory.content.trim(), tenantId, userId)
        : { content: memory.content.trim() };

    await docRef.set(
      {
        userId,
        tenantId,
        scope: memory.scope,
        scopeId: memory.scopeId || null,
        category: memory.category,
        ...protectedContent,
        source: memory.source || 'user_manual',
        confidence: memory.confidence ?? 1,
        purpose: memory.purpose || defaultPurposeForScope(memory.scope),
        sensitivity,
        retentionDays: retention.retentionDays,
        consentVersion: CONSENT_VERSION,
        consentedAt: memory.consentedAt,
        sourceMessageIds: memory.sourceMessageIds || [],
        validFrom: memory.validFrom || new Date().toISOString(),
        validUntil,
        status: memory.status || 'active',
        userApproved: true,
        contentHash,
        createdAt: now,
        updatedAt: now,
      },
      { merge: false }
    );

    await safeAudit({
      userId,
      tenantId,
      memoryId: docRef.id,
      action: 'created',
      reason: `Consentimento ${CONSENT_VERSION}; finalidade ${
        memory.purpose || defaultPurposeForScope(memory.scope)
      }.`,
      scope: memory.scope,
    });
    return docRef.id;
  }

  static async updateMemory(
    userId: string,
    memoryId: string,
    updates: Partial<SaveMemoryInput>,
    tenantId = `user:${userId}`
  ): Promise<boolean> {
    if (!adminDb) return false;
    const docRef = adminDb.collection('user_memories').doc(memoryId);
    const snap = await docRef.get();
    const existing = snap.data();
    if (
      !snap.exists ||
      !existing ||
      effectiveTenantId(existing) !== tenantId ||
      existing.userId !== userId
    ) {
      return false;
    }

    const cleanUpdates: Record<string, any> = {};
    if (updates.category !== undefined) cleanUpdates.category = updates.category;
    if (updates.purpose !== undefined) cleanUpdates.purpose = updates.purpose;
    if (updates.status !== undefined) cleanUpdates.status = updates.status;
    if (updates.userApproved !== undefined) {
      cleanUpdates.userApproved = updates.userApproved;
      if (updates.userApproved) {
        cleanUpdates.consentVersion = CONSENT_VERSION;
        cleanUpdates.consentedAt = updates.consentedAt || new Date().toISOString();
      }
    }
    if (updates.validUntil !== undefined) cleanUpdates.validUntil = updates.validUntil;
    if (updates.retentionDays !== undefined) {
      const retention = resolveRetention(existing.scope, updates.retentionDays);
      cleanUpdates.retentionDays = retention.retentionDays;
      cleanUpdates.validUntil = retention.validUntil;
    }
    if (updates.content !== undefined) {
      assertMemoryContentAllowed(updates.content);
      const sensitivity = classifyMemorySensitivity(
        updates.content,
        updates.sensitivity || existing.sensitivity || 'standard'
      );
      cleanUpdates.sensitivity = sensitivity;
      if (sensitivity === 'personal') {
        Object.assign(
          cleanUpdates,
          encryptPersonalMemory(updates.content.trim(), tenantId, userId)
        );
        cleanUpdates.content = FieldValue.delete();
      } else {
        cleanUpdates.content = updates.content.trim();
        cleanUpdates.contentCiphertext = FieldValue.delete();
        cleanUpdates.contentIv = FieldValue.delete();
        cleanUpdates.contentAuthTag = FieldValue.delete();
        cleanUpdates.encryptionVersion = FieldValue.delete();
      }
    }

    cleanUpdates.updatedAt = FieldValue.serverTimestamp();
    await docRef.update(cleanUpdates);
    await safeAudit({
      userId,
      tenantId,
      memoryId,
      action: 'updated',
      reason: 'Alteração solicitada pelo proprietário autenticado.',
      scope: existing.scope,
    });
    return true;
  }

  static async deleteMemory(
    userId: string,
    memoryId: string,
    tenantId = `user:${userId}`
  ): Promise<boolean> {
    if (!adminDb) return false;
    const docRef = adminDb.collection('user_memories').doc(memoryId);
    const snap = await docRef.get();
    const data = snap.data();
    if (
      !snap.exists ||
      !data ||
      data.userId !== userId ||
      effectiveTenantId(data) !== tenantId
    ) {
      return false;
    }

    await docRef.delete();
    await safeAudit({
      userId,
      tenantId,
      memoryId,
      action: 'deleted',
      reason: 'Exclusão permanente solicitada pelo proprietário autenticado.',
      scope: data.scope,
    });
    return true;
  }

  static async deleteAllMemories(
    userId: string,
    tenantId = `user:${userId}`
  ): Promise<number> {
    if (!adminDb) return 0;
    const memories = await adminDb
      .collection('user_memories')
      .where('userId', '==', userId)
      .limit(MAX_MANAGED_MEMORIES)
      .get();
    const owned = memories.docs.filter(
      (doc) => effectiveTenantId(doc.data()) === tenantId
    );

    for (let offset = 0; offset < owned.length; offset += 400) {
      const batch = adminDb.batch();
      owned.slice(offset, offset + 400).forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    return owned.length;
  }

  static async listAuditEvents(
    userId: string,
    tenantId = `user:${userId}`
  ): Promise<MemoryAuditEvent[]> {
    if (!adminDb) return [];
    const snap = await adminDb
      .collection('memory_audit_events')
      .where('userId', '==', userId)
      .limit(100)
      .get();
    const now = new Date().toISOString();
    return snap.docs
      .filter((doc) => doc.data().tenantId === tenantId)
      .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        memoryId: data.memoryId,
        action: data.action,
        reason: data.reason,
        occurredAt: toIsoString(data.occurredAt, now),
        scope: data.scope,
      };
      })
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
}
