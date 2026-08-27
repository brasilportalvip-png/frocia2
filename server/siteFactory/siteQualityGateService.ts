import crypto from 'node:crypto';
import {
  adminDb,
  isFirebaseAdminConfigured,
} from '../lib/firebaseAdmin.js';
import {
  SiteArchitectureDefinition,
  SiteQualityGateKey,
  selectOfficialArchitecture,
} from './siteArchitectureCatalog.js';
import {
  SiteScope,
  SiteSpecificationVersion,
} from './siteSpecificationService.js';

export type SiteQualityGateStatus =
  | 'pending'
  | 'passed'
  | 'failed'
  | 'external_blocker';

export interface SiteGateEvidence {
  evidenceId: string;
  kind:
    | 'test-report'
    | 'browser-run'
    | 'security-report'
    | 'deployment-receipt'
    | 'provider-status'
    | 'runtime-log-query'
    | 'manual-review'
    | 'rollback-drill'
    | 'monitoring-snapshot'
    | 'specification-approval'
    | 'architecture-selection';
  uri: string;
  digest: string;
  summary: string;
  environment: 'local' | 'test' | 'preview' | 'production';
  observedAt: string;
  recordedBy: string;
  reviewerUserId: string | null;
  implementerUserId: string | null;
}

export interface SiteQualityGate {
  key: SiteQualityGateKey;
  required: true;
  status: SiteQualityGateStatus;
  independentReviewRequired: boolean;
  acceptanceCriterionIds: string[];
  evidence: SiteGateEvidence[];
  lastUpdatedAt: string;
  failureReason: string | null;
  blockerCode: string | null;
}

export interface SiteQualityPlan {
  planId: string;
  projectId: string;
  tenantId: string;
  ownerUserId: string;
  specificationId: string;
  specificationVersion: number;
  specificationHash: string;
  architectureId: string;
  implementerUserId: string;
  planVersion: number;
  gates: SiteQualityGate[];
  createdAt: string;
  updatedAt: string;
}

export interface SiteReadinessDecision {
  status: 'ready' | 'blocked';
  ready: boolean;
  specificationVersion: number;
  planVersion: number;
  passed: number;
  totalRequired: number;
  pendingGates: SiteQualityGateKey[];
  failedGates: SiteQualityGateKey[];
  externalBlockers: Array<{
    gate: SiteQualityGateKey;
    code: string;
  }>;
  reasons: string[];
  evaluatedAt: string;
}

export interface SiteQualityPlanRepository {
  get(scope: SiteScope): Promise<SiteQualityPlan | null>;
  create(plan: SiteQualityPlan): Promise<SiteQualityPlan>;
  updateGate(input: {
    scope: SiteScope;
    expectedPlanVersion: number;
    gate: SiteQualityGate;
    updatedAt: string;
  }): Promise<SiteQualityPlan>;
}

export class SiteQualityGateError extends Error {
  constructor(
    readonly code:
      | 'specification_not_approved'
      | 'quality_plan_not_found'
      | 'quality_plan_stale'
      | 'unknown_quality_gate'
      | 'invalid_gate_evidence'
      | 'independent_review_required'
      | 'quality_repository_unavailable',
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = 'SiteQualityGateError';
  }
}

const INDEPENDENT_GATES = new Set<SiteQualityGateKey>([
  'accessibility',
  'visual-regression',
  'security',
  'production-deployment',
  'public-url-smoke',
  'rollback-plan',
]);

function scopeKey(scope: SiteScope): string {
  return crypto
    .createHash('sha256')
    .update(`${scope.tenantId}:${scope.ownerUserId}:${scope.projectId}`)
    .digest('hex');
}

function clonePlan(plan: SiteQualityPlan): SiteQualityPlan {
  return structuredClone(plan);
}

function createGate(
  key: SiteQualityGateKey,
  now: string,
  acceptanceCriterionIds: string[] = []
): SiteQualityGate {
  return {
    key,
    required: true,
    status: 'pending',
    independentReviewRequired: INDEPENDENT_GATES.has(key),
    acceptanceCriterionIds: [...acceptanceCriterionIds],
    evidence: [],
    lastUpdatedAt: now,
    failureReason: null,
    blockerCode: null,
  };
}

function initialPassedGate(input: {
  key: 'specification' | 'architecture';
  now: string;
  actor: string;
  digest: string;
  summary: string;
  uri: string;
  acceptanceCriterionIds: string[];
}): SiteQualityGate {
  const kind =
    input.key === 'specification'
      ? 'specification-approval'
      : 'architecture-selection';
  return {
    ...createGate(input.key, input.now, input.acceptanceCriterionIds),
    status: 'passed',
    evidence: [
      {
        evidenceId: crypto.randomUUID(),
        kind,
        uri: input.uri,
        digest: input.digest,
        summary: input.summary,
        environment: 'test',
        observedAt: input.now,
        recordedBy: input.actor,
        reviewerUserId: input.actor,
        implementerUserId: null,
      },
    ],
  };
}

export class InMemorySiteQualityPlanRepository
  implements SiteQualityPlanRepository
{
  private readonly plans = new Map<string, SiteQualityPlan>();

  async get(scope: SiteScope): Promise<SiteQualityPlan | null> {
    const plan = this.plans.get(scopeKey(scope));
    return plan ? clonePlan(plan) : null;
  }

  async create(plan: SiteQualityPlan): Promise<SiteQualityPlan> {
    const key = scopeKey(plan);
    const current = this.plans.get(key);
    if (current) return clonePlan(current);
    this.plans.set(key, clonePlan(plan));
    return clonePlan(plan);
  }

  async updateGate(input: {
    scope: SiteScope;
    expectedPlanVersion: number;
    gate: SiteQualityGate;
    updatedAt: string;
  }): Promise<SiteQualityPlan> {
    const key = scopeKey(input.scope);
    const plan = this.plans.get(key);
    if (!plan) {
      throw new SiteQualityGateError(
        'quality_plan_not_found',
        'Plano de qualidade não encontrado.',
        404
      );
    }
    if (plan.planVersion !== input.expectedPlanVersion) {
      throw new SiteQualityGateError(
        'quality_plan_stale',
        'O plano de qualidade mudou. Recarregue antes de registrar evidência.',
        409
      );
    }
    plan.gates = plan.gates.map((gate) =>
      gate.key === input.gate.key ? structuredClone(input.gate) : gate
    );
    plan.planVersion += 1;
    plan.updatedAt = input.updatedAt;
    return clonePlan(plan);
  }
}

export class FirestoreSiteQualityPlanRepository
  implements SiteQualityPlanRepository
{
  private ref(scope: SiteScope) {
    return adminDb.collection('site_quality_plans').doc(scopeKey(scope));
  }

  async get(scope: SiteScope): Promise<SiteQualityPlan | null> {
    const snapshot = await this.ref(scope).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() as SiteQualityPlan;
    if (
      data.tenantId !== scope.tenantId ||
      data.ownerUserId !== scope.ownerUserId ||
      data.projectId !== scope.projectId
    ) {
      return null;
    }
    return data;
  }

  async create(plan: SiteQualityPlan): Promise<SiteQualityPlan> {
    const ref = this.ref(plan);
    return adminDb.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (current.exists) return current.data() as SiteQualityPlan;
      transaction.create(ref, plan);
      return plan;
    });
  }

  async updateGate(input: {
    scope: SiteScope;
    expectedPlanVersion: number;
    gate: SiteQualityGate;
    updatedAt: string;
  }): Promise<SiteQualityPlan> {
    const ref = this.ref(input.scope);
    return adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        throw new SiteQualityGateError(
          'quality_plan_not_found',
          'Plano de qualidade não encontrado.',
          404
        );
      }
      const plan = snapshot.data() as SiteQualityPlan;
      if (plan.planVersion !== input.expectedPlanVersion) {
        throw new SiteQualityGateError(
          'quality_plan_stale',
          'O plano de qualidade mudou. Recarregue antes de registrar evidência.',
          409
        );
      }
      const updated: SiteQualityPlan = {
        ...plan,
        gates: plan.gates.map((gate) =>
          gate.key === input.gate.key ? input.gate : gate
        ),
        planVersion: plan.planVersion + 1,
        updatedAt: input.updatedAt,
      };
      transaction.update(ref, updated);
      return updated;
    });
  }
}

function assertEvidence(evidence: SiteGateEvidence): void {
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(evidence.evidenceId)) {
    throw new SiteQualityGateError(
      'invalid_gate_evidence',
      'Identificador de evidência inválido.',
      400
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(evidence.digest)) {
    throw new SiteQualityGateError(
      'invalid_gate_evidence',
      'A evidência precisa informar um digest SHA-256 real.',
      400
    );
  }
  if (
    evidence.summary.trim().length < 8 ||
    evidence.summary.length > 1000 ||
    evidence.uri.trim().length < 3 ||
    evidence.uri.length > 2048 ||
    Number.isNaN(new Date(evidence.observedAt).getTime())
  ) {
    throw new SiteQualityGateError(
      'invalid_gate_evidence',
      'A evidência está incompleta ou possui formato inválido.',
      400
    );
  }
}

export class SiteQualityGateService {
  constructor(
    private readonly repository: SiteQualityPlanRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = crypto.randomUUID
  ) {}

  static createDefault(): SiteQualityGateService {
    if (isFirebaseAdminConfigured()) {
      return new SiteQualityGateService(
        new FirestoreSiteQualityPlanRepository()
      );
    }
    if (process.env.NODE_ENV === 'production') {
      throw new SiteQualityGateError(
        'quality_repository_unavailable',
        'Firestore não está configurado para os gates da fábrica de sites.',
        503
      );
    }
    return new SiteQualityGateService(
      new InMemorySiteQualityPlanRepository()
    );
  }

  async createPlan(input: {
    scope: SiteScope;
    specification: SiteSpecificationVersion;
    actorUserId: string;
  }): Promise<SiteQualityPlan> {
    if (input.specification.status !== 'approved') {
      throw new SiteQualityGateError(
        'specification_not_approved',
        'A especificação precisa ser aprovada antes de iniciar os gates.',
        409
      );
    }
    const architecture = selectOfficialArchitecture(
      input.specification.specification.productType,
      input.specification.architectureId
    );
    const now = this.now().toISOString();
    const criteriaByGate = new Map<SiteQualityGateKey, string[]>();
    for (const criterion of input.specification.specification.acceptanceCriteria) {
      const current = criteriaByGate.get(criterion.gate) || [];
      current.push(criterion.id);
      criteriaByGate.set(criterion.gate, current);
    }
    const requiredGates = [
      ...new Set<SiteQualityGateKey>([
        ...architecture.requiredGates,
        ...criteriaByGate.keys(),
      ]),
    ];
    const gates = requiredGates.map((key) => {
      const criterionIds = criteriaByGate.get(key) || [];
      if (key === 'specification') {
        return initialPassedGate({
          key,
          now,
          actor: input.actorUserId,
          digest: input.specification.contentHash,
          summary: `Especificação v${input.specification.version} aprovada pelo proprietário.`,
          uri: `urn:frocia:site-specification:${input.specification.specificationId}:v${input.specification.version}`,
          acceptanceCriterionIds: criterionIds,
        });
      }
      if (key === 'architecture') {
        const digest = crypto
          .createHash('sha256')
          .update(JSON.stringify(architecture))
          .digest('hex');
        return initialPassedGate({
          key,
          now,
          actor: input.actorUserId,
          digest,
          summary: `Arquitetura oficial '${architecture.id}' compatível com o produto.`,
          uri: `urn:frocia:site-architecture:${architecture.id}`,
          acceptanceCriterionIds: criterionIds,
        });
      }
      return createGate(key, now, criterionIds);
    });
    const plan: SiteQualityPlan = {
      planId: this.createId(),
      ...input.scope,
      specificationId: input.specification.specificationId,
      specificationVersion: input.specification.version,
      specificationHash: input.specification.contentHash,
      architectureId: architecture.id,
      implementerUserId: input.actorUserId,
      planVersion: 1,
      gates,
      createdAt: now,
      updatedAt: now,
    };
    return this.repository.create(plan);
  }

  async getPlan(scope: SiteScope): Promise<SiteQualityPlan> {
    const plan = await this.repository.get(scope);
    if (!plan) {
      throw new SiteQualityGateError(
        'quality_plan_not_found',
        'Plano de qualidade não encontrado.',
        404
      );
    }
    return plan;
  }

  async recordGate(input: {
    scope: SiteScope;
    gateKey: SiteQualityGateKey;
    expectedPlanVersion: number;
    status: Exclude<SiteQualityGateStatus, 'pending'>;
    actorUserId: string;
    evidence?: SiteGateEvidence;
    failureReason?: string;
    blockerCode?: string;
  }): Promise<SiteQualityPlan> {
    const plan = await this.getPlan(input.scope);
    const gate = plan.gates.find((candidate) => candidate.key === input.gateKey);
    if (!gate) {
      throw new SiteQualityGateError(
        'unknown_quality_gate',
        'Este gate não pertence ao plano de qualidade atual.',
        404
      );
    }
    if (input.status === 'passed') {
      if (!input.evidence) {
        throw new SiteQualityGateError(
          'invalid_gate_evidence',
          'Um gate só pode passar com evidência.',
          400
        );
      }
      assertEvidence(input.evidence);
      input.evidence = {
        ...input.evidence,
        recordedBy: input.actorUserId,
        reviewerUserId: input.actorUserId,
        implementerUserId: plan.implementerUserId,
      };
      if (
        gate.independentReviewRequired &&
        input.actorUserId === plan.implementerUserId
      ) {
        throw new SiteQualityGateError(
          'independent_review_required',
          'Este gate exige revisor diferente do implementador.',
          409
        );
      }
    }
    if (input.status === 'failed' && !input.failureReason?.trim()) {
      throw new SiteQualityGateError(
        'invalid_gate_evidence',
        'Falha de gate exige uma causa explícita.',
        400
      );
    }
    if (input.status === 'external_blocker' && !input.blockerCode?.trim()) {
      throw new SiteQualityGateError(
        'invalid_gate_evidence',
        'Bloqueio externo exige um código explícito.',
        400
      );
    }
    const now = this.now().toISOString();
    const nextGate: SiteQualityGate = {
      ...gate,
      status: input.status,
      evidence:
        input.status === 'passed' && input.evidence
          ? gate.evidence.some(
              (evidence) => evidence.evidenceId === input.evidence!.evidenceId
            )
            ? gate.evidence
            : [...gate.evidence, structuredClone(input.evidence)]
          : gate.evidence,
      lastUpdatedAt: now,
      failureReason:
        input.status === 'failed' ? input.failureReason!.trim().slice(0, 1000) : null,
      blockerCode:
        input.status === 'external_blocker'
          ? input.blockerCode!.trim().slice(0, 160)
          : null,
    };
    return this.repository.updateGate({
      scope: input.scope,
      expectedPlanVersion: input.expectedPlanVersion,
      gate: nextGate,
      updatedAt: now,
    });
  }

  async evaluateReadiness(scope: SiteScope): Promise<SiteReadinessDecision> {
    const plan = await this.getPlan(scope);
    const pendingGates = plan.gates
      .filter((gate) => gate.status === 'pending')
      .map((gate) => gate.key);
    const failedGates = plan.gates
      .filter((gate) => gate.status === 'failed')
      .map((gate) => gate.key);
    const externalBlockers = plan.gates
      .filter((gate) => gate.status === 'external_blocker')
      .map((gate) => ({
        gate: gate.key,
        code: gate.blockerCode || 'external_blocker',
      }));
    const reasons = [
      ...pendingGates.map((gate) => `Gate pendente: ${gate}.`),
      ...failedGates.map((gate) => `Gate falhou: ${gate}.`),
      ...externalBlockers.map(
        (blocker) => `Bloqueio externo em ${blocker.gate}: ${blocker.code}.`
      ),
    ];
    const ready = reasons.length === 0;
    return {
      status: ready ? 'ready' : 'blocked',
      ready,
      specificationVersion: plan.specificationVersion,
      planVersion: plan.planVersion,
      passed: plan.gates.filter((gate) => gate.status === 'passed').length,
      totalRequired: plan.gates.length,
      pendingGates,
      failedGates,
      externalBlockers,
      reasons,
      evaluatedAt: this.now().toISOString(),
    };
  }
}

export function architectureForSpecification(
  specification: SiteSpecificationVersion
): SiteArchitectureDefinition {
  return selectOfficialArchitecture(
    specification.specification.productType,
    specification.architectureId
  );
}
