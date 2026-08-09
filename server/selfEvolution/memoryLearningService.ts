import crypto from 'crypto';
import { UserMemory, MemoryType } from './selfEvolutionTypes.js';
import { RedactionService } from './redactionService.js';
import { PromptInjectionDefense } from './promptInjectionDefense.js';

export class MemoryLearningService {
  private static memories: UserMemory[] = [];

  static saveUserMemory(params: {
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
  }): UserMemory {
    const rawRedacted = RedactionService.redactSensitiveData(params.content);
    const sanitized = PromptInjectionDefense.sanitizeUntrustedText(rawRedacted);
    const contentHash = crypto.createHash('sha256').update(`${params.userId}:${sanitized}`).digest('hex');

    // Deduplication check
    const existing = this.memories.find(
      (m) => m.userId === params.userId && m.contentHash === contentHash && m.status === 'active'
    );

    if (existing) {
      existing.usageCount += 1;
      existing.lastUsedAt = new Date().toISOString();
      return existing;
    }

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
      userApproved: params.userApproved ?? true,
      status: 'active',
      expiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      usageCount: 1,
    };

    this.memories.unshift(memory);
    return memory;
  }

  static getUserMemories(userId: string): UserMemory[] {
    const now = new Date().toISOString();
    return this.memories.filter(
      (m) => m.userId === userId && m.status === 'active' && (!m.expiresAt || m.expiresAt > now)
    );
  }

  static deleteUserMemory(userId: string, memoryId: string): boolean {
    const index = this.memories.findIndex((m) => m.id === memoryId && m.userId === userId);
    if (index === -1) return false;
    this.memories[index].status = 'archived';
    return true;
  }
}
