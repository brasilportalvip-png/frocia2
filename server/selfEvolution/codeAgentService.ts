import { ImprovementCandidate } from './selfEvolutionTypes.js';

export interface PatchResult {
  status: 'configured' | 'not_configured' | 'failed' | 'success';
  success: boolean;
  filesModified: string[];
  linesAdded: number;
  linesRemoved: number;
  testFileCreated?: string;
  errorMessage?: string;
}

export interface ICodeAgentAdapter {
  isConfigured(): boolean;
  generatePatchAndTest(candidate: ImprovementCandidate): Promise<PatchResult>;
}

export class DefaultCodeAgentAdapter implements ICodeAgentAdapter {
  isConfigured(): boolean {
    const workerUrl = process.env.SELF_EVOLUTION_WORKER_URL;
    const workerToken = process.env.SELF_EVOLUTION_WORKER_TOKEN;
    return Boolean(workerUrl && workerUrl.trim().length > 0 && workerToken && workerToken.trim().length > 0);
  }

  async generatePatchAndTest(candidate: ImprovementCandidate): Promise<PatchResult> {
    if (!this.isConfigured()) {
      return {
        status: 'not_configured',
        success: false,
        filesModified: [],
        linesAdded: 0,
        linesRemoved: 0,
        errorMessage: 'Worker isolado do Agente de Código não configurado (SELF_EVOLUTION_WORKER_URL ausente).',
      };
    }

    try {
      const response = await fetch(`${process.env.SELF_EVOLUTION_WORKER_URL}/api/worker/patch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SELF_EVOLUTION_WORKER_TOKEN}`,
        },
        body: JSON.stringify({
          candidateId: candidate.id,
          title: candidate.title,
          hypothesis: candidate.hypothesis,
          affectedComponents: candidate.affectedComponents,
          probableFiles: candidate.probableFiles,
        }),
      });

      if (!response.ok) {
        return {
          status: 'failed',
          success: false,
          filesModified: [],
          linesAdded: 0,
          linesRemoved: 0,
          errorMessage: `Worker retornou HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        status: 'success',
        success: true,
        filesModified: data.filesModified || [],
        linesAdded: data.linesAdded || 0,
        linesRemoved: data.linesRemoved || 0,
        testFileCreated: data.testFileCreated,
      };
    } catch (err: any) {
      return {
        status: 'failed',
        success: false,
        filesModified: [],
        linesAdded: 0,
        linesRemoved: 0,
        errorMessage: `Erro ao comunicar com o worker isolado: ${err?.message || err}`,
      };
    }
  }
}

export class CodeAgentService {
  private static adapter: ICodeAgentAdapter = new DefaultCodeAgentAdapter();

  static setAdapter(adapter: ICodeAgentAdapter): void {
    this.adapter = adapter;
  }

  static async generatePatchAndTest(candidate: ImprovementCandidate): Promise<PatchResult> {
    return this.adapter.generatePatchAndTest(candidate);
  }
}

