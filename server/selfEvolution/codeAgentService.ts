import {
  ImprovementCandidate
} from './selfEvolutionTypes.js';

const MAX_GENERATED_FILES = 25;
const MAX_FILE_CONTENT_BYTES = 1_000_000;
const MAX_TOTAL_CONTENT_BYTES = 2_500_000;
const WORKER_TIMEOUT_MS = 60_000;

export interface GeneratedFileChange {
  path: string;
  content: string;
}

export interface PatchResult {
  status:
    | 'configured'
    | 'not_configured'
    | 'failed'
    | 'success';
  success: boolean;
  filesModified: string[];
  files: GeneratedFileChange[];
  linesAdded: number;
  linesRemoved: number;
  testFileCreated?: string;
  commitMessage?: string;
  baseSha?: string;
  errorMessage?: string;
}

export interface ICodeAgentAdapter {
  isConfigured(): boolean;

  generatePatchAndTest(
    candidate: ImprovementCandidate
  ): Promise<PatchResult>;
}

function normalizeRepositoryPath(
  value: string
): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '');
}

function isSafeRepositoryPath(
  value: string
): boolean {
  if (
    !value ||
    value.length > 240 ||
    value.startsWith('/') ||
    /^[a-zA-Z]:\//.test(value)
  ) {
    return false;
  }

  const pathParts = value.split('/');

  return !pathParts.some(
    (part) =>
      part === '..' ||
      part === '' ||
      part === '.git'
  );
}

function createFailureResult(
  errorMessage: string,
  status:
    | 'not_configured'
    | 'failed' = 'failed'
): PatchResult {
  return {
    status,
    success: false,
    filesModified: [],
    files: [],
    linesAdded: 0,
    linesRemoved: 0,
    errorMessage
  };
}

function safeNonNegativeInteger(
  value: unknown
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.trunc(parsed));
}

export class DefaultCodeAgentAdapter
implements ICodeAgentAdapter {
  isConfigured(): boolean {
    const workerUrl =
      process.env.SELF_EVOLUTION_WORKER_URL;

    const workerToken =
      process.env.SELF_EVOLUTION_WORKER_TOKEN;

    return Boolean(
      workerUrl &&
      workerUrl.trim().length > 0 &&
      workerToken &&
      workerToken.trim().length > 0
    );
  }

  async generatePatchAndTest(
    candidate: ImprovementCandidate
  ): Promise<PatchResult> {
    if (!this.isConfigured()) {
      return createFailureResult(
        'Worker isolado do Agente de Código não configurado. Configure SELF_EVOLUTION_WORKER_URL e SELF_EVOLUTION_WORKER_TOKEN.',
        'not_configured'
      );
    }

    const workerUrl =
      process.env.SELF_EVOLUTION_WORKER_URL!
        .trim()
        .replace(/\/+$/, '');

    const workerToken =
      process.env.SELF_EVOLUTION_WORKER_TOKEN!
        .trim();

    try {
      const response = await fetch(
        `${workerUrl}/api/worker/patch`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
            Authorization:
              `Bearer ${workerToken}`
          },
          body: JSON.stringify({
            candidateId: candidate.id,
            title: candidate.title,
            summary: candidate.summary,
            hypothesis: candidate.hypothesis,
            expectedBehavior:
              candidate.expectedBehavior,
            affectedComponents:
              candidate.affectedComponents,
            probableFiles:
              candidate.probableFiles,
            testPlan: candidate.testPlan,
            riskLevel: candidate.riskLevel
          }),
          signal: AbortSignal.timeout(
            WORKER_TIMEOUT_MS
          )
        }
      );

      if (!response.ok) {
        return createFailureResult(
          `Worker retornou HTTP ${response.status}.`
        );
      }

      const data = await response.json() as {
        files?: unknown;
        linesAdded?: unknown;
        linesRemoved?: unknown;
        testFileCreated?: unknown;
        commitMessage?: unknown;
        baseSha?: unknown;
      };

      if (!Array.isArray(data.files)) {
        return createFailureResult(
          'Worker não retornou a propriedade obrigatória files.'
        );
      }

      if (
        data.files.length === 0 ||
        data.files.length > MAX_GENERATED_FILES
      ) {
        return createFailureResult(
          `Worker deve retornar entre 1 e ${MAX_GENERATED_FILES} arquivos.`
        );
      }

      const allowedCandidatePaths = new Set(
        candidate.probableFiles.map(
          normalizeRepositoryPath
        )
      );

      const generatedFiles:
        GeneratedFileChange[] = [];

      const generatedPaths =
        new Set<string>();

      let totalContentBytes = 0;

      for (const rawFile of data.files) {
        if (
          !rawFile ||
          typeof rawFile !== 'object'
        ) {
          return createFailureResult(
            'Worker retornou um arquivo com formato inválido.'
          );
        }

        const rawPath = (
          rawFile as Record<string, unknown>
        ).path;

        const rawContent = (
          rawFile as Record<string, unknown>
        ).content;

        if (
          typeof rawPath !== 'string' ||
          typeof rawContent !== 'string'
        ) {
          return createFailureResult(
            'Cada arquivo gerado deve possuir path e content em formato de texto.'
          );
        }

        const normalizedPath =
          normalizeRepositoryPath(rawPath);

        if (
          !isSafeRepositoryPath(
            normalizedPath
          )
        ) {
          return createFailureResult(
            `Caminho inseguro retornado pelo worker: ${normalizedPath || '(vazio)'}.`
          );
        }

        const isDeclaredCandidateFile =
          allowedCandidatePaths.has(
            normalizedPath
          );

        const isTestFile =
          /^tests\/[a-zA-Z0-9._/-]+\.test\.(ts|tsx)$/
            .test(normalizedPath);

        if (
          !isDeclaredCandidateFile &&
          !isTestFile
        ) {
          return createFailureResult(
            `Worker tentou modificar arquivo não declarado no candidato: ${normalizedPath}.`
          );
        }

        if (
          generatedPaths.has(
            normalizedPath
          )
        ) {
          return createFailureResult(
            `Worker retornou arquivo duplicado: ${normalizedPath}.`
          );
        }

        const contentBytes =
          Buffer.byteLength(
            rawContent,
            'utf8'
          );

        if (
          contentBytes >
          MAX_FILE_CONTENT_BYTES
        ) {
          return createFailureResult(
            `Arquivo ${normalizedPath} excede o limite de tamanho permitido.`
          );
        }

        totalContentBytes += contentBytes;

        if (
          totalContentBytes >
          MAX_TOTAL_CONTENT_BYTES
        ) {
          return createFailureResult(
            'O conjunto de arquivos gerados excede o limite total permitido.'
          );
        }

        generatedPaths.add(
          normalizedPath
        );

        generatedFiles.push({
          path: normalizedPath,
          content: rawContent
        });
      }

      const testFileCreated =
        typeof data.testFileCreated ===
          'string'
          ? normalizeRepositoryPath(
              data.testFileCreated
            )
          : undefined;

      if (
        testFileCreated &&
        !generatedPaths.has(
          testFileCreated
        )
      ) {
        return createFailureResult(
          'Worker informou testFileCreated, mas o teste não está presente na lista files.'
        );
      }

      const commitMessage =
        typeof data.commitMessage ===
          'string' &&
        data.commitMessage.trim().length > 0
          ? data.commitMessage
              .trim()
              .replace(/[\r\n]+/g, ' ')
              .slice(0, 120)
          : `fix(self-evolution): ${candidate.title}`
              .slice(0, 120);

      let baseSha: string | undefined;

      if (
        typeof data.baseSha === 'string' &&
        data.baseSha.trim().length > 0
      ) {
        const normalizedBaseSha =
          data.baseSha.trim();

        if (
          !/^[a-f0-9]{40}$/i.test(
            normalizedBaseSha
          )
        ) {
          return createFailureResult(
            'Worker retornou baseSha inválido.'
          );
        }

        baseSha = normalizedBaseSha;
      }

      return {
        status: 'success',
        success: true,
        filesModified:
          generatedFiles.map(
            (file) => file.path
          ),
        files: generatedFiles,
        linesAdded:
          safeNonNegativeInteger(
            data.linesAdded
          ),
        linesRemoved:
          safeNonNegativeInteger(
            data.linesRemoved
          ),
        testFileCreated,
        commitMessage,
        baseSha
      };
    } catch (error: any) {
      const timedOut =
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError';

      return createFailureResult(
        timedOut
          ? 'O worker do Agente de Código excedeu o limite de 60 segundos.'
          : `Erro ao comunicar com o worker isolado: ${error?.message || error}`
      );
    }
  }
}

export class CodeAgentService {
  private static adapter:
    ICodeAgentAdapter =
      new DefaultCodeAgentAdapter();

  static setAdapter(
    adapter: ICodeAgentAdapter
  ): void {
    this.adapter = adapter;
  }

  static async generatePatchAndTest(
    candidate: ImprovementCandidate
  ): Promise<PatchResult> {
    return this.adapter
      .generatePatchAndTest(candidate);
  }
}