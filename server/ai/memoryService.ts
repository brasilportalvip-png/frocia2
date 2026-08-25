import { adminDb } from '../lib/firebaseAdmin.js';
import { UserMemory } from './types/ai.js';
import { FieldValue } from 'firebase-admin/firestore';

const MAX_CONTEXT_MEMORIES = 12;
const MAX_MANAGED_MEMORIES = 200;

function toIsoString(value: any, fallback: string): string {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function mapMemory(doc: any): UserMemory {
  const data = doc.data();
  const now = new Date().toISOString();

  return {
    id: doc.id,
    userId: data.userId,
    scope: data.scope,
    scopeId: data.scopeId || null,
    category: data.category || 'general',
    content: data.content,
    source: data.source || 'ai_extracted',
    confidence: data.confidence ?? 1,
    validFrom: toIsoString(data.validFrom, now),
    validUntil: data.validUntil
      ? toIsoString(data.validUntil, now)
      : null,
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

function relevanceScore(memory: UserMemory, prompt: string): number {
  const promptTerms = normalizeTerms(prompt);
  const memoryTerms = normalizeTerms(
    `${memory.category} ${memory.content}`
  );

  let overlap = 0;
  promptTerms.forEach((term) => {
    if (memoryTerms.has(term)) overlap += 1;
  });

  const scopeWeight =
    memory.scope === 'conversation'
      ? 3
      : memory.scope === 'project'
        ? 2
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

export class MemoryService {
  /**
   * Retrieves active user memories for prompt context
   */
  static async getActiveMemories(
    userId: string,
    projectId?: string | null,
    conversationId?: string | null,
    prompt = ''
  ): Promise<UserMemory[]> {
    if (!adminDb) return [];

    try {
      let query = adminDb.collection('user_memories')
        .where('userId', '==', userId)
        .where('status', '==', 'active');

      const snap = await query.get();
      const now = Date.now();
      const memories: UserMemory[] = [];

      snap.docs.forEach((doc) => {
        const d = doc.data();
        const validFrom = d.validFrom
          ? new Date(toIsoString(d.validFrom, new Date(0).toISOString())).getTime()
          : 0;
        const validUntil = d.validUntil
          ? new Date(toIsoString(d.validUntil, new Date(0).toISOString())).getTime()
          : null;

        // Only approved, currently valid memories from the requested scope
        // are eligible for model context.
        if (
          d.userApproved === true &&
          validFrom <= now &&
          (validUntil === null || validUntil > now) &&
          (
            d.scope === 'user' ||
            (d.scope === 'project' && projectId && d.scopeId === projectId) ||
            (d.scope === 'conversation' && conversationId && d.scopeId === conversationId)
          )
        ) {
          memories.push(mapMemory(doc));
        }
      });

      return memories
        .map((memory) => ({
          memory,
          score: relevanceScore(memory, prompt),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return b.memory.updatedAt.localeCompare(a.memory.updatedAt);
        })
        .slice(0, MAX_CONTEXT_MEMORIES)
        .map(({ memory }) => memory);
    } catch (err) {
      console.warn('Erro ao carregar memorias do usuario:', err);
      return [];
    }
  }

  /**
   * Lists memories for the user-facing manager. Deleted memories are not
   * returned because DELETE permanently removes the document.
   */
  static async listMemories(userId: string): Promise<UserMemory[]> {
    if (!adminDb) return [];

    const snap = await adminDb
      .collection('user_memories')
      .where('userId', '==', userId)
      .limit(MAX_MANAGED_MEMORIES)
      .get();

    return snap.docs
      .map(mapMemory)
      .filter((memory) => memory.status !== 'deleted')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Creates or updates a memory
   */
  static async saveMemory(
    userId: string,
    memory: Omit<UserMemory, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    const docRef = adminDb.collection('user_memories').doc();
    const now = FieldValue.serverTimestamp();

    await docRef.set({
      userId,
      scope: memory.scope,
      scopeId: memory.scopeId || null,
      category: memory.category,
      content: memory.content,
      source: memory.source || 'manual',
      confidence: memory.confidence ?? 1.0,
      validFrom: memory.validFrom || new Date().toISOString(),
      validUntil: memory.validUntil || null,
      status: memory.status || 'active',
      userApproved: memory.userApproved ?? true,
      createdAt: now,
      updatedAt: now,
    });

    return docRef.id;
  }

  /**
   * Updates memory status or content
   */
  static async updateMemory(
    userId: string,
    memoryId: string,
    updates: Partial<UserMemory>
  ): Promise<boolean> {
    const docRef = adminDb.collection('user_memories').doc(memoryId);
    const snap = await docRef.get();
    if (!snap.exists || snap.data()?.userId !== userId) {
      return false;
    }

    const cleanUpdates: Record<string, any> = {};
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        cleanUpdates[key] = val;
      }
    }
    cleanUpdates.updatedAt = FieldValue.serverTimestamp();

    await docRef.update(cleanUpdates);

    return true;
  }

  /** Permanently deletes a memory owned by the user. */
  static async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    const docRef = adminDb.collection('user_memories').doc(memoryId);
    const snap = await docRef.get();
    if (!snap.exists || snap.data()?.userId !== userId) {
      return false;
    }

    await docRef.delete();

    return true;
  }
}
