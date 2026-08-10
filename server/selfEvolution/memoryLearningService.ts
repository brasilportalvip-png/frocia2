import crypto from 'crypto';
import { adminDb } from '../lib/firebaseAdmin.js';
import { UserMemory, MemoryType } from './selfEvolutionTypes.js';
import { RedactionService } from './redactionService.js';
import { PromptInjectionDefense } from './promptInjectionDefense.js';

export class MemoryLearningService {
  private static inMemoryMemories: UserMemory[] = [];

  static async saveUserMemory(params: {
    userId: string;
    projectId?: string;
    conversationId?: string;
    type: MemoryType;
    category: string;
    content: string;
    source: string;
    confidence?: number;
    userApproved?: boolean;
    ttlDays?: number;
  }): Promise<UserMemory> {
    const rawRedacted = RedactionService.redactSensitiveData(params.content);
    const sanitized = PromptInjectionDefense.sanitizeUntrustedText(rawRedacted);
    const contentHash = crypto.createHash('sha256').update(`${params.userId}:${sanitized}`).digest('hex');

    // Default consent is FALSE unless explicitly approved by user
    const userApproved = params.userApproved === true;

    const now = new Date();
    let expiresAt: string | undefined;
    if (params.ttlDays) {
      const exp = new Date(now.getTime() + params.ttlDays * 86400000);
      expiresAt = exp.toISOString();
    }

    const memory: UserMemory = {
      id: `mem-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      userId: params.userId,
      projectId: params.projectId,
      conversationId: params.conversationId,
      type: params.type,
      category: params.category,
      content: sanitized,
      contentHash,
      source: params.source,
      confidence: params.confidence ?? 0.9,
      userApproved,
      status: userApproved ? 'active' : 'pending_consent',
      expiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      usageCount: 1,
    };

    if (adminDb) {
      try {
        await adminDb.collection('self_evolution_memories').doc(memory.id).set(memory);
      } catch (err) {
        console.error('Erro ao salvar memória no Firestore:', err);
      }
    }

    this.inMemoryMemories.unshift(memory);
    return memory;
  }

  static async getUserMemories(userId: string): Promise<UserMemory[]> {
    const now = new Date().toISOString();

    if (adminDb) {
      try {
        const snapshot = await adminDb
          .collection('self_evolution_memories')
          .where('userId', '==', userId)
          .where('status', '==', 'active')
          .where('userApproved', '==', true)
          .get();

        if (!snapshot.empty) {
          return snapshot.docs
            .map((doc) => doc.data() as UserMemory)
            .filter((m) => !m.expiresAt || m.expiresAt > now);
        }
      } catch (err) {
        console.error('Erro ao buscar memórias no Firestore:', err);
      }
    }

    return this.inMemoryMemories.filter(
      (m) => m.userId === userId && m.status === 'active' && m.userApproved && (!m.expiresAt || m.expiresAt > now)
    );
  }

  static async deleteUserMemory(userId: string, memoryId: string): Promise<boolean> {
    if (adminDb) {
      try {
        const docRef = adminDb.collection('self_evolution_memories').doc(memoryId);
        const doc = await docRef.get();
        if (doc.exists && doc.data()?.userId === userId) {
          await docRef.update({ status: 'archived', updatedAt: new Date().toISOString() });
          return true;
        }
      } catch (err) {
        console.error('Erro ao remover memória no Firestore:', err);
      }
    }

    const index = this.inMemoryMemories.findIndex((m) => m.id === memoryId && m.userId === userId);
    if (index === -1) return false;
    this.inMemoryMemories[index].status = 'archived';
    return true;
  }
}

