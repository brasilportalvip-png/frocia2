import crypto from 'node:crypto';
import { z } from 'zod';
import {
  adminDb,
  isFirebaseAdminConfigured,
} from '../lib/firebaseAdmin.js';
import {
  ArchitectureCompatibilityError,
  SiteProductType,
  SiteQualityGateKey,
  selectOfficialArchitecture,
} from './siteArchitectureCatalog.js';

const productTypes = [
  'landing-page',
  'institutional',
  'blog',
  'store',
  'authenticated-portal',
  'saas',
  'admin-panel',
  'booking',
  'payments',
  'ai-application',
] as const satisfies readonly SiteProductType[];

const gateKeys = [
  'specification',
  'architecture',
  'clean-install',
  'typecheck',
  'unit-tests',
  'integration-tests',
  'api-contract',
  'database-migrations',
  'e2e-browser',
  'responsive-layout',
  'accessibility',
  'visual-regression',
  'security',
  'concurrency',
  'idempotency',
  'load-critical-routes',
  'broken-links',
  'technical-seo',
  'production-build',
  'preview-deployment',
  'production-deployment',
  'public-url-smoke',
  'runtime-logs',
  'domain-https-headers',
  'integration-health',
  'rollback-plan',
  'monitoring',
] as const satisfies readonly SiteQualityGateKey[];

const safeText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .transform((value) =>
      value
        .normalize('NFKC')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .trim()
    );

const sourceReferenceSchema = z
  .object({
    label: safeText(160),
    url: z.string().url().max(2048),
    observedAt: z.string().datetime(),
  })
  .strict();

const approvedClaimSchema = z
  .object({
    text: safeText(500),
    sourceUrls: z.array(z.string().url().max(2048)).max(10).default([]),
    evidenceId: z.string().trim().max(160).optional(),
  })
  .strict();

const acceptanceCriterionSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_-]{2,39}$/),
    description: safeText(500),
    gate: z.enum(gateKeys),
    measurableTarget: safeText(300),
  })
  .strict();

export const siteSpecificationInputSchema = z
  .object({
    title: safeText(160),
    objective: safeText(2000),
    audience: z.array(safeText(240)).min(1).max(20),
    productType: z.enum(productTypes),
    pages: z
      .array(
        z
          .object({
            path: z
              .string()
              .trim()
              .regex(/^\/(?:[a-z0-9][a-z0-9/_-]*)?$/)
              .max(160),
            purpose: safeText(500),
            requiresAuthentication: z.boolean(),
          })
          .strict()
      )
      .min(1)
      .max(100),
    features: z.array(safeText(240)).max(100),
    visualIdentity: z
      .object({
        brandName: safeText(120),
        colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(1).max(12),
        typography: z.array(safeText(120)).min(1).max(8),
        tone: safeText(240),
        assetReferences: z.array(z.string().url().max(2048)).max(30).default([]),
      })
      .strict(),
    contentPolicy: z
      .object({
        placeholderPolicy: z.enum(['block', 'explicit-only']),
        sourceReferences: z.array(sourceReferenceSchema).max(100).default([]),
        approvedClaims: z.array(approvedClaimSchema).max(100).default([]),
      })
      .strict(),
    authentication: z
      .object({
        required: z.boolean(),
        providers: z.array(z.enum(['email', 'google', 'microsoft', 'github'])).max(4),
        roles: z.array(safeText(80)).max(20),
        multiTenant: z.boolean(),
      })
      .strict(),
    data: z
      .object({
        entities: z.array(safeText(120)).max(80),
        containsPersonalData: z.boolean(),
        migrationsRequired: z.boolean(),
        retentionPolicy: safeText(500),
      })
      .strict(),
    payments: z
      .object({
        required: z.boolean(),
        provider: z.enum(['none', 'mercado-pago', 'stripe', 'other']),
        sandboxRequired: z.boolean(),
        products: z.array(safeText(160)).max(100),
      })
      .strict(),
    administration: z
      .object({
        required: z.boolean(),
        roles: z.array(safeText(80)).max(20),
        auditableActions: z.array(safeText(160)).max(50),
      })
      .strict(),
    integrations: z
      .array(
        z
          .object({
            name: safeText(120),
            purpose: safeText(300),
            credentialOwner: safeText(120),
            requiredForLaunch: z.boolean(),
          })
          .strict()
      )
      .max(50),
    delivery: z
      .object({
        repositoryOwner: safeText(120),
        repositoryName: z.string().trim().regex(/^[A-Za-z0-9._-]{1,100}$/),
        hosting: z.enum(['vercel', 'cloudflare', 'other']),
        customDomain: z.string().trim().max(253).nullable(),
        environments: z
          .array(z.enum(['local', 'test', 'preview', 'production']))
          .min(2),
      })
      .strict(),
    seo: z
      .object({
        titlePattern: safeText(160),
        description: safeText(320),
        canonicalBaseUrl: z.string().url().max(2048).nullable(),
        indexable: z.boolean(),
      })
      .strict(),
    accessibility: z
      .object({
        standard: z.literal('WCAG-2.2-AA'),
        languages: z.array(z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)).min(1).max(10),
        keyboardOnlyRequired: z.boolean(),
        reducedMotionRequired: z.boolean(),
      })
      .strict(),
    privacy: z
      .object({
        legalBasis: safeText(240),
        consentRequired: z.boolean(),
        dataCategories: z.array(safeText(120)).max(30),
        retentionDays: z.number().int().min(1).max(3650),
        deletionFlowRequired: z.boolean(),
      })
      .strict(),
    successMetrics: z
      .array(
        z
          .object({
            name: safeText(120),
            target: safeText(240),
            measurementSource: safeText(160),
          })
          .strict()
      )
      .min(1)
      .max(30),
    acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(100),
    requestedArchitectureId: z.string().trim().max(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const pagePaths = new Set<string>();
    for (const page of value.pages) {
      if (pagePaths.has(page.path)) {
        context.addIssue({
          code: 'custom',
          path: ['pages'],
          message: `A página '${page.path}' foi informada mais de uma vez.`,
        });
      }
      pagePaths.add(page.path);
    }

    const criterionIds = new Set<string>();
    for (const criterion of value.acceptanceCriteria) {
      if (criterionIds.has(criterion.id)) {
        context.addIssue({
          code: 'custom',
          path: ['acceptanceCriteria'],
          message: `O critério '${criterion.id}' foi informado mais de uma vez.`,
        });
      }
      criterionIds.add(criterion.id);
    }

    if (value.authentication.required && value.authentication.providers.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['authentication', 'providers'],
        message: 'Autenticação obrigatória exige ao menos um provedor.',
      });
    }

    if (value.payments.required) {
      if (value.payments.provider === 'none') {
        context.addIssue({
          code: 'custom',
          path: ['payments', 'provider'],
          message: 'Pagamento obrigatório exige um provedor real.',
        });
      }
      if (!value.payments.sandboxRequired) {
        context.addIssue({
          code: 'custom',
          path: ['payments', 'sandboxRequired'],
          message: 'Pagamento exige validação prévia em sandbox.',
        });
      }
    }

    for (const claim of value.contentPolicy.approvedClaims) {
      if (looksLikeUnverifiedClaim(claim.text) && claim.sourceUrls.length === 0 && !claim.evidenceId) {
        context.addIssue({
          code: 'custom',
          path: ['contentPolicy', 'approvedClaims'],
          message: `A afirmação '${claim.text.slice(0, 80)}' exige fonte ou evidência.`,
        });
      }
    }
  });

export type SiteSpecificationInput = z.infer<typeof siteSpecificationInputSchema>;

export interface SiteSpecificationVersion {
  specificationId: string;
  projectId: string;
  tenantId: string;
  ownerUserId: string;
  version: number;
  status: 'draft' | 'approved';
  specification: SiteSpecificationInput;
  architectureId: string;
  contentHash: string;
  changeRequestId: string | null;
  changeReason: string;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface SiteSpecificationChangeRequest {
  requestId: string;
  projectId: string;
  tenantId: string;
  ownerUserId: string;
  baseVersion: number;
  resultingVersion: number;
  reason: string;
  changes: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

export interface SiteSpecificationRepository {
  create(version: SiteSpecificationVersion): Promise<void>;
  getCurrent(scope: SiteScope): Promise<SiteSpecificationVersion | null>;
  listVersions(scope: SiteScope): Promise<SiteSpecificationVersion[]>;
  findChangeRequest(scope: SiteScope, requestId: string): Promise<SiteSpecificationVersion | null>;
  appendVersion(
    current: SiteSpecificationVersion,
    next: SiteSpecificationVersion,
    request: SiteSpecificationChangeRequest
  ): Promise<void>;
  approve(
    scope: SiteScope,
    expectedVersion: number,
    actorUserId: string,
    approvedAt: string
  ): Promise<SiteSpecificationVersion>;
}

export interface SiteScope {
  projectId: string;
  tenantId: string;
  ownerUserId: string;
}

export class SiteSpecificationError extends Error {
  constructor(
    readonly code:
      | 'specification_exists'
      | 'specification_not_found'
      | 'stale_specification_version'
      | 'invalid_change_request'
      | 'specification_already_approved'
      | 'repository_unavailable',
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = 'SiteSpecificationError';
  }
}

const unverifiedClaimPatterns = [
  /\b(?:n[uú]mero\s*1|l[ií]der\s+de\s+mercado|o\s+melhor|garantid[oa])\b/i,
  /\b\d+(?:[.,]\d+)?\s*%\b/,
  /\b(?:milh(?:a|õ)es?|milhares?)\s+(?:de\s+)?(?:clientes|usu[aá]rios|vendas)\b/i,
  /\b(?:mais\s+de\s+)?\d[\d.,]*\s+(?:clientes|usu[aá]rios|projetos|vendas)\b/i,
];

export function looksLikeUnverifiedClaim(value: string): boolean {
  return unverifiedClaimPatterns.some((pattern) => pattern.test(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function hashSiteSpecification(value: SiteSpecificationInput): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function specificationDocumentId(scope: SiteScope): string {
  return crypto
    .createHash('sha256')
    .update(`${scope.tenantId}:${scope.ownerUserId}:${scope.projectId}`)
    .digest('hex');
}

function cloneVersion(version: SiteSpecificationVersion): SiteSpecificationVersion {
  return structuredClone(version);
}

function assertSafeChanges(
  value: unknown,
  path: string[] = []
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SiteSpecificationError(
      'invalid_change_request',
      'As alterações precisam ser um objeto.',
      400
    );
  }

  for (const [key, nested] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new SiteSpecificationError(
        'invalid_change_request',
        `O caminho '${[...path, key].join('.')}' não é permitido.`,
        400
      );
    }
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      assertSafeChanges(nested, [...path, key]);
    }
  }
}

function deepMerge(
  current: Record<string, unknown>,
  changes: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = structuredClone(current);
  for (const [key, value] of Object.entries(changes)) {
    const previous = merged[key];
    merged[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      previous &&
      typeof previous === 'object' &&
      !Array.isArray(previous)
        ? deepMerge(
            previous as Record<string, unknown>,
            value as Record<string, unknown>
          )
        : structuredClone(value);
  }
  return merged;
}

export class InMemorySiteSpecificationRepository
  implements SiteSpecificationRepository
{
  private readonly projects = new Map<
    string,
    {
      currentVersion: number;
      versions: SiteSpecificationVersion[];
      requests: Map<string, number>;
    }
  >();

  async create(version: SiteSpecificationVersion): Promise<void> {
    const key = specificationDocumentId(version);
    if (this.projects.has(key)) {
      throw new SiteSpecificationError(
        'specification_exists',
        'Este projeto já possui uma especificação.',
        409
      );
    }
    this.projects.set(key, {
      currentVersion: 1,
      versions: [cloneVersion(version)],
      requests: new Map(),
    });
  }

  async getCurrent(scope: SiteScope): Promise<SiteSpecificationVersion | null> {
    const project = this.projects.get(specificationDocumentId(scope));
    if (!project) return null;
    const version = project.versions.find(
      (candidate) => candidate.version === project.currentVersion
    );
    return version ? cloneVersion(version) : null;
  }

  async listVersions(scope: SiteScope): Promise<SiteSpecificationVersion[]> {
    const project = this.projects.get(specificationDocumentId(scope));
    return project
      ? project.versions.map(cloneVersion).sort((left, right) => right.version - left.version)
      : [];
  }

  async findChangeRequest(
    scope: SiteScope,
    requestId: string
  ): Promise<SiteSpecificationVersion | null> {
    const project = this.projects.get(specificationDocumentId(scope));
    const versionNumber = project?.requests.get(requestId);
    const version = project?.versions.find(
      (candidate) => candidate.version === versionNumber
    );
    return version ? cloneVersion(version) : null;
  }

  async appendVersion(
    current: SiteSpecificationVersion,
    next: SiteSpecificationVersion,
    request: SiteSpecificationChangeRequest
  ): Promise<void> {
    const project = this.projects.get(specificationDocumentId(current));
    if (!project || project.currentVersion !== current.version) {
      throw new SiteSpecificationError(
        'stale_specification_version',
        'A especificação mudou. Recarregue antes de aplicar esta alteração.',
        409
      );
    }
    if (project.requests.has(request.requestId)) return;
    project.versions.push(cloneVersion(next));
    project.currentVersion = next.version;
    project.requests.set(request.requestId, next.version);
  }

  async approve(
    scope: SiteScope,
    expectedVersion: number,
    actorUserId: string,
    approvedAt: string
  ): Promise<SiteSpecificationVersion> {
    const project = this.projects.get(specificationDocumentId(scope));
    const version = project?.versions.find(
      (candidate) => candidate.version === project.currentVersion
    );
    if (!project || !version) {
      throw new SiteSpecificationError(
        'specification_not_found',
        'Especificação não encontrada.',
        404
      );
    }
    if (project.currentVersion !== expectedVersion) {
      throw new SiteSpecificationError(
        'stale_specification_version',
        'A versão informada não é a versão atual.',
        409
      );
    }
    if (version.status === 'approved') return cloneVersion(version);
    version.status = 'approved';
    version.approvedBy = actorUserId;
    version.approvedAt = approvedAt;
    return cloneVersion(version);
  }
}

export class FirestoreSiteSpecificationRepository
  implements SiteSpecificationRepository
{
  private projectRef(scope: SiteScope) {
    return adminDb
      .collection('site_factory_projects')
      .doc(specificationDocumentId(scope));
  }

  async create(version: SiteSpecificationVersion): Promise<void> {
    const projectRef = this.projectRef(version);
    const versionRef = projectRef.collection('versions').doc('v000001');
    await adminDb.runTransaction(async (transaction) => {
      const current = await transaction.get(projectRef);
      if (current.exists) {
        throw new SiteSpecificationError(
          'specification_exists',
          'Este projeto já possui uma especificação.',
          409
        );
      }
      transaction.create(projectRef, {
        specificationId: version.specificationId,
        projectId: version.projectId,
        tenantId: version.tenantId,
        ownerUserId: version.ownerUserId,
        currentVersion: 1,
        current: version,
        createdAt: new Date(version.createdAt),
        updatedAt: new Date(version.createdAt),
      });
      transaction.create(versionRef, version);
    });
  }

  async getCurrent(scope: SiteScope): Promise<SiteSpecificationVersion | null> {
    const snapshot = await this.projectRef(scope).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    if (
      data?.tenantId !== scope.tenantId ||
      data?.ownerUserId !== scope.ownerUserId ||
      data?.projectId !== scope.projectId
    ) {
      return null;
    }
    return data.current as SiteSpecificationVersion;
  }

  async listVersions(scope: SiteScope): Promise<SiteSpecificationVersion[]> {
    const current = await this.getCurrent(scope);
    if (!current) return [];
    const snapshot = await this.projectRef(scope)
      .collection('versions')
      .orderBy('version', 'desc')
      .limit(100)
      .get();
    return snapshot.docs.map(
      (document) => document.data() as SiteSpecificationVersion
    );
  }

  async findChangeRequest(
    scope: SiteScope,
    requestId: string
  ): Promise<SiteSpecificationVersion | null> {
    const current = await this.getCurrent(scope);
    if (!current) return null;
    const request = await this.projectRef(scope)
      .collection('change_requests')
      .doc(requestId)
      .get();
    if (!request.exists) return null;
    const resultingVersion = Number(request.data()?.resultingVersion || 0);
    const version = await this.projectRef(scope)
      .collection('versions')
      .doc(`v${String(resultingVersion).padStart(6, '0')}`)
      .get();
    return version.exists
      ? (version.data() as SiteSpecificationVersion)
      : null;
  }

  async appendVersion(
    current: SiteSpecificationVersion,
    next: SiteSpecificationVersion,
    request: SiteSpecificationChangeRequest
  ): Promise<void> {
    const projectRef = this.projectRef(current);
    const versionRef = projectRef
      .collection('versions')
      .doc(`v${String(next.version).padStart(6, '0')}`);
    const requestRef = projectRef
      .collection('change_requests')
      .doc(request.requestId);

    await adminDb.runTransaction(async (transaction) => {
      const [project, previousRequest] = await Promise.all([
        transaction.get(projectRef),
        transaction.get(requestRef),
      ]);
      if (previousRequest.exists) return;
      if (!project.exists || Number(project.data()?.currentVersion) !== current.version) {
        throw new SiteSpecificationError(
          'stale_specification_version',
          'A especificação mudou. Recarregue antes de aplicar esta alteração.',
          409
        );
      }
      transaction.create(versionRef, next);
      transaction.create(requestRef, request);
      transaction.update(projectRef, {
        currentVersion: next.version,
        current: next,
        updatedAt: new Date(next.createdAt),
      });
    });
  }

  async approve(
    scope: SiteScope,
    expectedVersion: number,
    actorUserId: string,
    approvedAt: string
  ): Promise<SiteSpecificationVersion> {
    const projectRef = this.projectRef(scope);
    return adminDb.runTransaction(async (transaction) => {
      const project = await transaction.get(projectRef);
      const current = project.data()?.current as SiteSpecificationVersion | undefined;
      if (!project.exists || !current) {
        throw new SiteSpecificationError(
          'specification_not_found',
          'Especificação não encontrada.',
          404
        );
      }
      if (current.version !== expectedVersion) {
        throw new SiteSpecificationError(
          'stale_specification_version',
          'A versão informada não é a versão atual.',
          409
        );
      }
      if (current.status === 'approved') return current;
      const approved: SiteSpecificationVersion = {
        ...current,
        status: 'approved',
        approvedBy: actorUserId,
        approvedAt,
      };
      transaction.update(projectRef, {
        current: approved,
        updatedAt: new Date(approvedAt),
      });
      transaction.update(
        projectRef
          .collection('versions')
          .doc(`v${String(current.version).padStart(6, '0')}`),
        {
          status: 'approved',
          approvedBy: actorUserId,
          approvedAt,
        }
      );
      return approved;
    });
  }
}

export class SiteSpecificationService {
  constructor(
    private readonly repository: SiteSpecificationRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = crypto.randomUUID
  ) {}

  static createDefault(): SiteSpecificationService {
    if (isFirebaseAdminConfigured()) {
      return new SiteSpecificationService(
        new FirestoreSiteSpecificationRepository()
      );
    }
    if (process.env.NODE_ENV === 'production') {
      throw new SiteSpecificationError(
        'repository_unavailable',
        'Firestore não está configurado para a fábrica de sites.',
        503
      );
    }
    return new SiteSpecificationService(
      new InMemorySiteSpecificationRepository()
    );
  }

  async create(input: {
    scope: SiteScope;
    specification: unknown;
    actorUserId: string;
  }): Promise<SiteSpecificationVersion> {
    const specification = siteSpecificationInputSchema.parse(input.specification);
    const architecture = selectOfficialArchitecture(
      specification.productType,
      specification.requestedArchitectureId
    );
    const createdAt = this.now().toISOString();
    const version: SiteSpecificationVersion = {
      specificationId: this.createId(),
      ...input.scope,
      version: 1,
      status: 'draft',
      specification,
      architectureId: architecture.id,
      contentHash: hashSiteSpecification(specification),
      changeRequestId: null,
      changeReason: 'Especificação inicial criada.',
      createdBy: input.actorUserId,
      createdAt,
      approvedBy: null,
      approvedAt: null,
    };
    await this.repository.create(version);
    return cloneVersion(version);
  }

  async getCurrent(scope: SiteScope): Promise<SiteSpecificationVersion> {
    const current = await this.repository.getCurrent(scope);
    if (!current) {
      throw new SiteSpecificationError(
        'specification_not_found',
        'Especificação não encontrada.',
        404
      );
    }
    return current;
  }

  async listVersions(scope: SiteScope): Promise<SiteSpecificationVersion[]> {
    return this.repository.listVersions(scope);
  }

  async applyChange(input: {
    scope: SiteScope;
    requestId: string;
    baseVersion: number;
    reason: string;
    changes: unknown;
    actorUserId: string;
  }): Promise<SiteSpecificationVersion> {
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(input.requestId)) {
      throw new SiteSpecificationError(
        'invalid_change_request',
        'Identificador da mudança inválido.',
        400
      );
    }
    const previous = await this.repository.findChangeRequest(
      input.scope,
      input.requestId
    );
    if (previous) return previous;

    assertSafeChanges(input.changes);
    const current = await this.getCurrent(input.scope);
    if (current.version !== input.baseVersion) {
      throw new SiteSpecificationError(
        'stale_specification_version',
        'A especificação mudou. Recarregue antes de aplicar esta alteração.',
        409
      );
    }

    const merged = deepMerge(
      current.specification as unknown as Record<string, unknown>,
      input.changes
    );
    const specification = siteSpecificationInputSchema.parse(merged);
    const architecture = selectOfficialArchitecture(
      specification.productType,
      specification.requestedArchitectureId
    );
    const createdAt = this.now().toISOString();
    const next: SiteSpecificationVersion = {
      ...current,
      version: current.version + 1,
      status: 'draft',
      specification,
      architectureId: architecture.id,
      contentHash: hashSiteSpecification(specification),
      changeRequestId: input.requestId,
      changeReason: safeText(1000).parse(input.reason),
      createdBy: input.actorUserId,
      createdAt,
      approvedBy: null,
      approvedAt: null,
    };
    const request: SiteSpecificationChangeRequest = {
      requestId: input.requestId,
      ...input.scope,
      baseVersion: current.version,
      resultingVersion: next.version,
      reason: next.changeReason,
      changes: structuredClone(input.changes),
      createdBy: input.actorUserId,
      createdAt,
    };
    await this.repository.appendVersion(current, next, request);
    return cloneVersion(next);
  }

  async approve(input: {
    scope: SiteScope;
    expectedVersion: number;
    actorUserId: string;
  }): Promise<SiteSpecificationVersion> {
    return this.repository.approve(
      input.scope,
      input.expectedVersion,
      input.actorUserId,
      this.now().toISOString()
    );
  }
}

export { ArchitectureCompatibilityError };
