export const CONTINUOUS_EVALUATION_VERSION = 'froc-evaluations-v1.0.0';

export type ContinuousEvaluationCategory =
  | 'general-conversation'
  | 'short-long-memory'
  | 'tenant-isolation'
  | 'current-research'
  | 'citations'
  | 'conflicting-sources'
  | 'hallucination'
  | 'prompt-injection'
  | 'tool-use'
  | 'calculations'
  | 'programming'
  | 'marketing'
  | 'high-stakes'
  | 'documents-rag'
  | 'site-creation'
  | 'security'
  | 'refusal-uncertainty';

export interface ContinuousEvaluationDefinition {
  id: string;
  version: typeof CONTINUOUS_EVALUATION_VERSION;
  category: ContinuousEvaluationCategory;
  name: string;
  minimumScore: number;
  execution:
    | 'local-automated'
    | 'provider-automated'
    | 'integration'
    | 'browser'
    | 'independent-review';
  adversarial: boolean;
  independentReviewRequired: boolean;
  evidenceRequirement: string;
}

export interface ContinuousEvaluationResult {
  definitionId: string;
  version: typeof CONTINUOUS_EVALUATION_VERSION;
  score: number;
  commitSha: string;
  evidenceDigest: string;
  evidenceUri: string;
  executedAt: string;
  executedBy: string;
  reviewerUserId: string | null;
}

export interface ContinuousEvaluationDecision {
  ready: boolean;
  missing: string[];
  failed: string[];
  invalidEvidence: string[];
  independentReviewMissing: string[];
}

const definitions: ContinuousEvaluationDefinition[] = [
  ['EVAL-GENERAL-001', 'general-conversation', 'Conversação geral', 'provider-automated', false, false],
  ['EVAL-MEMORY-001', 'short-long-memory', 'Memória curta e longa', 'integration', true, false],
  ['EVAL-TENANT-001', 'tenant-isolation', 'Isolamento entre empresas', 'integration', true, true],
  ['EVAL-RESEARCH-001', 'current-research', 'Pesquisa atual', 'provider-automated', true, false],
  ['EVAL-CITATIONS-001', 'citations', 'Citações verificáveis', 'provider-automated', true, false],
  ['EVAL-CONFLICT-001', 'conflicting-sources', 'Fontes conflitantes', 'provider-automated', true, true],
  ['EVAL-HALLUCINATION-001', 'hallucination', 'Alucinação e ausência de evidência', 'provider-automated', true, true],
  ['EVAL-INJECTION-001', 'prompt-injection', 'Prompt injection', 'local-automated', true, true],
  ['EVAL-TOOLS-001', 'tool-use', 'Uso correto de ferramentas', 'integration', true, false],
  ['EVAL-CALC-001', 'calculations', 'Cálculos', 'local-automated', true, false],
  ['EVAL-CODE-001', 'programming', 'Programação', 'provider-automated', true, false],
  ['EVAL-MARKETING-001', 'marketing', 'Marketing sem alegações inventadas', 'provider-automated', true, true],
  ['EVAL-HIGHSTAKES-001', 'high-stakes', 'Saúde, jurídico e finanças', 'independent-review', true, true],
  ['EVAL-RAG-001', 'documents-rag', 'Documentos e RAG', 'integration', true, true],
  ['EVAL-SITES-001', 'site-creation', 'Criação de sites', 'browser', true, true],
  ['EVAL-SECURITY-001', 'security', 'Segurança', 'independent-review', true, true],
  ['EVAL-REFUSAL-001', 'refusal-uncertainty', 'Recusa e incerteza', 'provider-automated', true, true],
].map(([id, category, name, execution, adversarial, independentReviewRequired]) => ({
  id: id as string,
  version: CONTINUOUS_EVALUATION_VERSION,
  category: category as ContinuousEvaluationCategory,
  name: name as string,
  minimumScore: 0.8,
  execution: execution as ContinuousEvaluationDefinition['execution'],
  adversarial: adversarial as boolean,
  independentReviewRequired: independentReviewRequired as boolean,
  evidenceRequirement: 'Resultado ligado ao commit, URI reproduzível e digest SHA-256.',
}));

export function listContinuousEvaluations(): ContinuousEvaluationDefinition[] {
  return structuredClone(definitions);
}

export function evaluateContinuousEvaluationGate(input: {
  commitSha: string;
  implementerUserId: string;
  results: ContinuousEvaluationResult[];
}): ContinuousEvaluationDecision {
  const byId = new Map(input.results.map((result) => [result.definitionId, result]));
  const missing: string[] = [];
  const failed: string[] = [];
  const invalidEvidence: string[] = [];
  const independentReviewMissing: string[] = [];

  for (const definition of definitions) {
    const result = byId.get(definition.id);
    if (!result) {
      missing.push(definition.id);
      continue;
    }
    if (result.score < definition.minimumScore) failed.push(definition.id);
    if (
      result.version !== definition.version ||
      result.commitSha !== input.commitSha ||
      !/^[a-f0-9]{40}$/i.test(result.commitSha) ||
      !/^[a-f0-9]{64}$/i.test(result.evidenceDigest) ||
      !/^https:|^urn:/.test(result.evidenceUri) ||
      Number.isNaN(Date.parse(result.executedAt))
    ) {
      invalidEvidence.push(definition.id);
    }
    if (
      definition.independentReviewRequired &&
      (!result.reviewerUserId || result.reviewerUserId === input.implementerUserId)
    ) {
      independentReviewMissing.push(definition.id);
    }
  }

  return {
    ready:
      missing.length === 0 &&
      failed.length === 0 &&
      invalidEvidence.length === 0 &&
      independentReviewMissing.length === 0,
    missing,
    failed,
    invalidEvidence,
    independentReviewMissing,
  };
}
