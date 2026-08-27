import crypto from 'node:crypto';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';

export const PRODUCTION_GATE_KEYS = [
  'clean-install',
  'lockfile',
  'lint',
  'typecheck',
  'unit-tests',
  'integration-tests',
  'e2e',
  'security-audit',
  'production-build',
  'migrations',
  'staging',
  'production-deployment',
  'public-smoke',
  'runtime-logs',
  'backup',
  'rollback',
  'monitoring-alerts',
  'operation-docs',
  'tracker',
  'independent-audit',
] as const;

export type ProductionGateKey = (typeof PRODUCTION_GATE_KEYS)[number];
export type ProductionGateStatus = 'pending' | 'passed' | 'failed' | 'external_blocker';

export interface ProductionGateEvidence {
  evidenceId: string;
  uri: string;
  digest: string;
  commitSha: string;
  environment: 'local' | 'test' | 'staging' | 'production';
  command: string;
  result: string;
  observedAt: string;
  recordedBy: string;
  reviewerUserId: string | null;
}

export interface ProductionGate {
  key: ProductionGateKey;
  status: ProductionGateStatus;
  evidence: ProductionGateEvidence[];
  failureReason: string | null;
  blockerCode: string | null;
  independentReviewRequired: boolean;
  updatedAt: string;
}

export interface ProductionReleasePlan {
  releaseId: string;
  version: string;
  baseCommitSha: string;
  commitSha: string;
  implementerUserId: string;
  planVersion: number;
  gates: ProductionGate[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductionReleaseDecision {
  releaseId: string;
  ready: boolean;
  status: 'ready' | 'blocked';
  passed: number;
  total: number;
  pending: ProductionGateKey[];
  failed: ProductionGateKey[];
  externalBlockers: Array<{ gate: ProductionGateKey; code: string }>;
  staleEvidence: ProductionGateKey[];
  evaluatedAt: string;
}

export interface ProductionReleaseRepository {
  get(releaseId: string): Promise<ProductionReleasePlan | null>;
  create(plan: ProductionReleasePlan): Promise<ProductionReleasePlan>;
  replace(plan: ProductionReleasePlan, expectedVersion: number): Promise<ProductionReleasePlan>;
}

export class ProductionReleaseError extends Error {
  constructor(
    readonly code:
      | 'release_not_found'
      | 'release_exists'
      | 'release_stale'
      | 'invalid_release'
      | 'invalid_evidence'
      | 'gate_dependency_pending'
      | 'independent_review_required'
      | 'release_repository_unavailable',
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = 'ProductionReleaseError';
  }
}

const independentGates = new Set<ProductionGateKey>([
  'security-audit',
  'e2e',
  'independent-audit',
]);

const dependencies: Partial<Record<ProductionGateKey, ProductionGateKey[]>> = {
  staging: ['clean-install', 'lockfile', 'lint', 'typecheck', 'unit-tests', 'integration-tests', 'production-build'],
  'production-deployment': ['staging', 'security-audit', 'tracker'],
  'public-smoke': ['production-deployment'],
  'runtime-logs': ['production-deployment'],
  'independent-audit': ['public-smoke', 'runtime-logs', 'rollback', 'monitoring-alerts'],
};

function clone(plan: ProductionReleasePlan): ProductionReleasePlan {
  return structuredClone(plan);
}

function validateReleaseIdentity(
  releaseId: string,
  version: string,
  baseCommitSha: string,
  commitSha: string
): void {
  if (
    !/^[A-Za-z0-9:_-]{8,160}$/.test(releaseId) ||
    version.trim().length < 1 ||
    version.length > 120 ||
    !/^[a-f0-9]{40}$/i.test(baseCommitSha) ||
    !/^[a-f0-9]{40}$/i.test(commitSha)
  ) {
    throw new ProductionReleaseError('invalid_release', 'Identidade de release inválida.', 400);
  }
}

function validateEvidence(evidence: ProductionGateEvidence, commitSha: string): void {
  let protocol = '';
  try {
    protocol = new URL(evidence.uri).protocol;
  } catch {
    protocol = '';
  }
  if (
    !/^[A-Za-z0-9:_-]{8,160}$/.test(evidence.evidenceId) ||
    !['https:', 'urn:'].includes(protocol) ||
    !/^[a-f0-9]{64}$/i.test(evidence.digest) ||
    !/^[a-f0-9]{40}$/i.test(evidence.commitSha) ||
    evidence.commitSha !== commitSha ||
    evidence.command.trim().length < 2 ||
    evidence.result.trim().length < 4 ||
    Number.isNaN(Date.parse(evidence.observedAt)) ||
    Date.parse(evidence.observedAt) > Date.now() + 5 * 60_000
  ) {
    throw new ProductionReleaseError(
      'invalid_evidence',
      'A evidência não possui URI, digest, commit, comando e resultado verificáveis.',
      400
    );
  }
}

export class InMemoryProductionReleaseRepository implements ProductionReleaseRepository {
  readonly plans = new Map<string, ProductionReleasePlan>();

  async get(releaseId: string): Promise<ProductionReleasePlan | null> {
    const plan = this.plans.get(releaseId);
    return plan ? clone(plan) : null;
  }

  async create(plan: ProductionReleasePlan): Promise<ProductionReleasePlan> {
    if (this.plans.has(plan.releaseId)) {
      throw new ProductionReleaseError('release_exists', 'A release já existe.', 409);
    }
    this.plans.set(plan.releaseId, clone(plan));
    return clone(plan);
  }

  async replace(plan: ProductionReleasePlan, expectedVersion: number): Promise<ProductionReleasePlan> {
    const current = this.plans.get(plan.releaseId);
    if (!current) throw new ProductionReleaseError('release_not_found', 'Release não encontrada.', 404);
    if (current.planVersion !== expectedVersion) {
      throw new ProductionReleaseError('release_stale', 'A release mudou; recarregue antes de atualizar.', 409);
    }
    this.plans.set(plan.releaseId, clone(plan));
    return clone(plan);
  }
}

export class FirestoreProductionReleaseRepository implements ProductionReleaseRepository {
  private ref(releaseId: string) {
    return adminDb.collection('production_release_plans').doc(releaseId);
  }

  async get(releaseId: string): Promise<ProductionReleasePlan | null> {
    const snapshot = await this.ref(releaseId).get();
    return snapshot.exists ? (snapshot.data() as ProductionReleasePlan) : null;
  }

  async create(plan: ProductionReleasePlan): Promise<ProductionReleasePlan> {
    try {
      await this.ref(plan.releaseId).create(plan);
      return plan;
    } catch (error) {
      if ((error as { code?: number | string })?.code === 6 || (error as { code?: string })?.code === 'already-exists') {
        throw new ProductionReleaseError('release_exists', 'A release já existe.', 409);
      }
      throw error;
    }
  }

  async replace(plan: ProductionReleasePlan, expectedVersion: number): Promise<ProductionReleasePlan> {
    const ref = this.ref(plan.releaseId);
    return adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new ProductionReleaseError('release_not_found', 'Release não encontrada.', 404);
      const current = snapshot.data() as ProductionReleasePlan;
      if (current.planVersion !== expectedVersion) {
        throw new ProductionReleaseError('release_stale', 'A release mudou; recarregue antes de atualizar.', 409);
      }
      transaction.set(ref, plan);
      return plan;
    });
  }
}

export class ProductionReleaseService {
  constructor(
    private readonly repository: ProductionReleaseRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async create(input: {
    releaseId: string;
    version: string;
    baseCommitSha: string;
    commitSha: string;
    implementerUserId: string;
  }): Promise<ProductionReleasePlan> {
    validateReleaseIdentity(
      input.releaseId,
      input.version,
      input.baseCommitSha,
      input.commitSha
    );
    const now = this.now().toISOString();
    return this.repository.create({
      ...input,
      version: input.version.trim(),
      planVersion: 1,
      gates: PRODUCTION_GATE_KEYS.map((key) => ({
        key,
        status: 'pending',
        evidence: [],
        failureReason: null,
        blockerCode: null,
        independentReviewRequired: independentGates.has(key),
        updatedAt: now,
      })),
      createdAt: now,
      updatedAt: now,
    });
  }

  async get(releaseId: string): Promise<ProductionReleasePlan> {
    const plan = await this.repository.get(releaseId);
    if (!plan) throw new ProductionReleaseError('release_not_found', 'Release não encontrada.', 404);
    return plan;
  }

  async recordGate(input: {
    releaseId: string;
    expectedPlanVersion: number;
    gateKey: ProductionGateKey;
    status: Exclude<ProductionGateStatus, 'pending'>;
    actorUserId: string;
    evidence?: ProductionGateEvidence;
    failureReason?: string;
    blockerCode?: string;
  }): Promise<ProductionReleasePlan> {
    const plan = await this.get(input.releaseId);
    if (plan.planVersion !== input.expectedPlanVersion) {
      throw new ProductionReleaseError('release_stale', 'A release mudou; recarregue antes de atualizar.', 409);
    }
    const gate = plan.gates.find((item) => item.key === input.gateKey)!;
    if (input.status === 'passed') {
      if (!input.evidence) {
        throw new ProductionReleaseError('invalid_evidence', 'Gate aprovado exige evidência.', 400);
      }
      validateEvidence(input.evidence, plan.commitSha);
      const unmet = (dependencies[input.gateKey] || []).filter(
        (key) => plan.gates.find((candidate) => candidate.key === key)?.status !== 'passed'
      );
      if (unmet.length > 0) {
        throw new ProductionReleaseError(
          'gate_dependency_pending',
          `Gate depende de: ${unmet.join(', ')}.`,
          409
        );
      }
      if (gate.independentReviewRequired && input.actorUserId === plan.implementerUserId) {
        throw new ProductionReleaseError(
          'independent_review_required',
          'Este gate exige identidade diferente do implementador.',
          409
        );
      }
    }
    if (input.status === 'failed' && (input.failureReason?.trim().length || 0) < 4) {
      throw new ProductionReleaseError('invalid_evidence', 'Falha exige motivo explícito.', 400);
    }
    if (input.status === 'external_blocker' && (input.blockerCode?.trim().length || 0) < 3) {
      throw new ProductionReleaseError('invalid_evidence', 'Bloqueio externo exige código.', 400);
    }
    const now = this.now().toISOString();
    const evidence = input.evidence
      ? { ...input.evidence, recordedBy: input.actorUserId, reviewerUserId: input.actorUserId }
      : undefined;
    const updated: ProductionReleasePlan = {
      ...plan,
      planVersion: plan.planVersion + 1,
      updatedAt: now,
      gates: plan.gates.map((item) =>
        item.key !== input.gateKey
          ? item
          : {
              ...item,
              status: input.status,
              evidence: evidence ? [...item.evidence, evidence] : item.evidence,
              failureReason: input.status === 'failed' ? input.failureReason!.trim() : null,
              blockerCode: input.status === 'external_blocker' ? input.blockerCode!.trim() : null,
              updatedAt: now,
            }
      ),
    };
    return this.repository.replace(updated, input.expectedPlanVersion);
  }

  async evaluate(releaseId: string): Promise<ProductionReleaseDecision> {
    const plan = await this.get(releaseId);
    const pending = plan.gates.filter((gate) => gate.status === 'pending').map((gate) => gate.key);
    const failed = plan.gates.filter((gate) => gate.status === 'failed').map((gate) => gate.key);
    const externalBlockers = plan.gates
      .filter((gate) => gate.status === 'external_blocker')
      .map((gate) => ({ gate: gate.key, code: gate.blockerCode || 'external_blocker' }));
    const staleEvidence = plan.gates
      .filter(
        (gate) =>
          gate.status === 'passed' &&
          !gate.evidence.some((evidence) => evidence.commitSha === plan.commitSha)
      )
      .map((gate) => gate.key);
    const ready = pending.length === 0 && failed.length === 0 && externalBlockers.length === 0 && staleEvidence.length === 0;
    return {
      releaseId,
      ready,
      status: ready ? 'ready' : 'blocked',
      passed: plan.gates.filter((gate) => gate.status === 'passed').length,
      total: plan.gates.length,
      pending,
      failed,
      externalBlockers,
      staleEvidence,
      evaluatedAt: this.now().toISOString(),
    };
  }

  async finalReport(releaseId: string) {
    const plan = await this.get(releaseId);
    const decision = await this.evaluate(releaseId);
    return {
      release: { releaseId: plan.releaseId, version: plan.version, commitSha: plan.commitSha },
      decision,
      commits: { initial: plan.baseCommitSha, final: plan.commitSha, intermediate: [] as string[] },
      requirements: { implemented: [], verified: [], externalBlockers: decision.externalBlockers },
      changedFiles: [] as string[],
      architecture: 'Evidência deve ser anexada ao gate operation-docs.',
      tests: plan.gates.filter((gate) => gate.key.includes('test') || gate.key === 'e2e'),
      adversarialTests: plan.gates.find((gate) => gate.key === 'security-audit') || null,
      ci: plan.gates.find((gate) => gate.key === 'integration-tests') || null,
      staging: plan.gates.find((gate) => gate.key === 'staging') || null,
      production: plan.gates.find((gate) => gate.key === 'production-deployment') || null,
      publicSmoke: plan.gates.find((gate) => gate.key === 'public-smoke') || null,
      security: plan.gates.find((gate) => gate.key === 'security-audit') || null,
      observability: plan.gates.find((gate) => gate.key === 'monitoring-alerts') || null,
      residualRisks: [...decision.pending, ...decision.failed, ...decision.externalBlockers.map((item) => item.gate)],
      costsAndLimits: 'Nenhum custo monetário é afirmado sem recibo do provedor.',
      rollback: plan.gates.find((gate) => gate.key === 'rollback') || null,
      evidenceInvented: false,
      generatedAt: this.now().toISOString(),
    };
  }
}

let runtime: ProductionReleaseService | null = null;

export function getProductionReleaseService(): ProductionReleaseService {
  if (!runtime) {
    if (process.env.NODE_ENV === 'production' && !isFirebaseAdminConfigured()) {
      throw new ProductionReleaseError(
        'release_repository_unavailable',
        'Firestore é obrigatório para releases em produção.',
        503
      );
    }
    runtime = new ProductionReleaseService(
      isFirebaseAdminConfigured()
        ? new FirestoreProductionReleaseRepository()
        : new InMemoryProductionReleaseRepository()
    );
  }
  return runtime;
}
