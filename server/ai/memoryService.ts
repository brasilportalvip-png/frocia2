import { adminDb } from '../lib/firebaseAdmin.js';
import { UserMemory } from './types/ai.js';
import { FieldValue } from 'firebase-admin/firestore';

export class MemoryService {
  /**
   * Retrieves active user memories for prompt context
   */
  static async getActiveMemories(
    userId: string,
    projectId?: string | null,
    conversationId?: string | null
  ): Promise<UserMemory[]> {
    if (!adminDb) return [];

    try {
      let query = adminDb.collection('user_memories')
        .where('userId', '==', userId)
        .where('status', '==', 'active');

      const snap = await query.get();
      const memories: UserMemory[] = [];

      snap.docs.forEach((doc) => {
        const d = doc.data();
        // Filter by scope match
        if (
          d.scope === 'user' ||
          (d.scope === 'project' && projectId && d.scopeId === projectId) ||
          (d.scope === 'conversation' && conversationId && d.scopeId === conversationId)
        ) {
          memories.push({
            id: doc.id,
            userId: d.userId,
            scope: d.scope,
            scopeId: d.scopeId || null,
            category: d.category || 'general',
            content: d.content,
            source: d.source || 'ai_extracted',
            confidence: d.confidence ?? 1.0,
            validFrom: d.validFrom || new Date().toISOString(),
            validUntil: d.validUntil || null,
            status: d.status || 'active',
            userApproved: d.userApproved ?? true,
            createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : new Date(d.createdAt).toISOString()) : new Date().toISOString(),
            updatedAt: d.updatedAt ? (d.updatedAt.toDate ? d.updatedAt.toDate().toISOString() : new Date(d.updatedAt).toISOString()) : new Date().toISOString(),
          });
        }
      });

      return memories;
    } catch (err) {
      console.warn('Erro ao carregar memorias do usuario:', err);
      return [];
    }
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

  /**
   * Deletes (soft delete or hard delete) memory
   */
  static async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    const docRef = adminDb.collection('user_memories').doc(memoryId);
    const snap = await docRef.get();
    if (!snap.exists || snap.data()?.userId !== userId) {
      return false;
    }

    await docRef.update({
      status: 'deleted',
      updatedAt: FieldValue.serverTimestamp(),
    });

    return true;
  }
}
