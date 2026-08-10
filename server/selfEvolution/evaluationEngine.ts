import { execSync } from 'child_process';
import { adminDb } from '../lib/firebaseAdmin.js';
import { RedactionService } from './redactionService.js';

export interface EvaluationResult {
  status: 'configured' | 'not_configured' | 'success' | 'failed';
  suiteName: string;
  suiteVersion: string;
  commandExecuted?: string;
  passedCount: number;
  failedCount: number;
  totalCount: number;
  scorePercentage: number;
  criticalPassed: boolean;
  commitSha?: string;
  sanitizedLogs?: string;
  timestamp: string;
}

export class EvaluationEngine {
  static runSuite(suiteName: string, commitSha?: string): EvaluationResult {
    const suiteVersion = '2.1.0';
    const timestamp = new Date().toISOString();

    let command = '';
    if (suiteName === 'golden') {
      command = 'npm test -- tests/selfEvolutionEngine.test.ts';
    } else if (suiteName === 'security') {
      command = 'npm test -- tests/authAndHealthSecurity.test.ts';
    } else if (suiteName === 'rag') {
      command = 'npm test -- tests/knowledgeBaseRag.test.ts';
    } else {
      command = 'npm test';
    }

    try {
      const output = execSync(command, { encoding: 'utf-8', timeout: 30000 });
      const sanitizedLogs = RedactionService.redactSensitiveData(output.substring(0, 2000));

      const result: EvaluationResult = {
        status: 'success',
        suiteName,
        suiteVersion,
        commandExecuted: command,
        passedCount: 1,
        failedCount: 0,
        totalCount: 1,
        scorePercentage: 100,
        criticalPassed: true,
        commitSha,
        sanitizedLogs,
        timestamp,
      };

      this.persistResult(result);
      return result;
    } catch (err: any) {
      const rawError = err?.stdout || err?.stderr || err?.message || 'Falha na execução dos testes';
      const sanitizedLogs = RedactionService.redactSensitiveData(String(rawError).substring(0, 2000));

      const result: EvaluationResult = {
        status: 'failed',
        suiteName,
        suiteVersion,
        commandExecuted: command,
        passedCount: 0,
        failedCount: 1,
        totalCount: 1,
        scorePercentage: 0,
        criticalPassed: false,
        commitSha,
        sanitizedLogs,
        timestamp,
      };

      this.persistResult(result);
      return result;
    }
  }

  private static async persistResult(result: EvaluationResult): Promise<void> {
    if (!adminDb) return;
    try {
      await adminDb.collection('self_evolution_evaluations').add({
        ...result,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error('Erro ao persistir avaliação no Firestore:', err);
    }
  }
}

