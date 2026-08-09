import { adminDb } from '../lib/firebaseAdmin.js';
import { ExecutionRecord } from './types/ai.js';
import { FieldValue } from 'firebase-admin/firestore';

export class ExecutionTraceService {
  static async createTrace(record: Omit<ExecutionRecord, 'executionId'>): Promise<string> {
    if (!adminDb) return `mock-trace-${Date.now()}`;

    const ref = adminDb.collection('ai_executions').doc();
    const id = ref.id;

    await ref.set({
      ...record,
      executionId: id,
      createdAt: FieldValue.serverTimestamp(),
    });

    return id;
  }

  static async updateTrace(
    executionId: string,
    updates: Partial<ExecutionRecord>
  ): Promise<void> {
    if (!adminDb || executionId.startsWith('mock-')) return;

    try {
      const ref = adminDb.collection('ai_executions').doc(executionId);
      await ref.update({
        ...updates,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.warn('Erro ao atualizar trace de execucao:', err);
    }
  }

  static async getTrace(executionId: string): Promise<ExecutionRecord | null> {
    if (!adminDb) return null;

    try {
      const snap = await adminDb.collection('ai_executions').doc(executionId).get();
      if (!snap.exists) return null;
      return snap.data() as ExecutionRecord;
    } catch (err) {
      return null;
    }
  }
}
