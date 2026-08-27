import { describe, expect, it } from 'vitest';
import {
  ArchitectureCompatibilityError,
  listOfficialArchitectures,
  selectOfficialArchitecture,
} from '../server/siteFactory/siteArchitectureCatalog.js';
import {
  InMemorySiteSpecificationRepository,
  SiteSpecificationError,
  SiteSpecificationInput,
  SiteSpecificationService,
  hashSiteSpecification,
  siteSpecificationInputSchema,
} from '../server/siteFactory/siteSpecificationService.js';
import {
  InMemorySiteQualityPlanRepository,
  SiteQualityGateError,
  SiteQualityGateService,
} from '../server/siteFactory/siteQualityGateService.js';

const scope = {
  projectId: 'project-site-factory',
  tenantId: 'tenant:acme',
  ownerUserId: 'user-owner',
};

function validSpecification(
  overrides: Partial<SiteSpecificationInput> = {}
): SiteSpecificationInput {
  return {
    title: 'Portal de clientes Acme',
    objective: 'Permitir que clientes acompanhem projetos e documentos.',
    audience: ['Clientes ativos', 'Equipe de atendimento'],
    productType: 'authenticated-portal',
    pages: [
      {
        path: '/',
        purpose: 'Apresentar o produto e oferecer entrada segura.',
        requiresAuthentication: false,
      },
      {
        path: '/painel',
        purpose: 'Exibir projetos pertencentes ao usuário autenticado.',
        requiresAuthentication: true,
      },
    ],
    features: ['Login', 'Lista de projetos', 'Exportação de documentos'],
    visualIdentity: {
      brandName: 'Acme',
      colors: ['#101828', '#2E90FA'],
      typography: ['Inter'],
      tone: 'Claro e profissional',
      assetReferences: [],
    },
    contentPolicy: {
      placeholderPolicy: 'block',
      sourceReferences: [],
      approvedClaims: [],
    },
    authentication: {
      required: true,
      providers: ['email'],
      roles: ['cliente', 'atendimento', 'admin'],
      multiTenant: true,
    },
    data: {
      entities: ['user', 'project', 'document'],
      containsPersonalData: true,
      migrationsRequired: true,
      retentionPolicy: 'Excluir documentos 90 dias após o encerramento do contrato.',
    },
    payments: {
      required: false,
      provider: 'none',
      sandboxRequired: false,
      products: [],
    },
    administration: {
      required: true,
      roles: ['admin'],
      auditableActions: ['alterar acesso', 'excluir documento'],
    },
    integrations: [
      {
        name: 'Firebase Auth',
        purpose: 'Autenticação de clientes',
        credentialOwner: 'Acme',
        requiredForLaunch: true,
      },
    ],
    delivery: {
      repositoryOwner: 'acme',
      repositoryName: 'portal-clientes',
      hosting: 'vercel',
      customDomain: 'portal.example.com',
      environments: ['local', 'test', 'preview', 'production'],
    },
    seo: {
      titlePattern: '%s | Acme',
      description: 'Portal autenticado para clientes Acme.',
      canonicalBaseUrl: 'https://portal.example.com',
      indexable: false,
    },
    accessibility: {
      standard: 'WCAG-2.2-AA',
      languages: ['pt-BR'],
      keyboardOnlyRequired: true,
      reducedMotionRequired: true,
    },
    privacy: {
      legalBasis: 'Execução de contrato e consentimento quando aplicável.',
      consentRequired: true,
      dataCategories: ['identificação', 'documentos'],
      retentionDays: 365,
      deletionFlowRequired: true,
    },
    successMetrics: [
      {
        name: 'Conclusão do fluxo principal',
        target: 'Fluxo concluído sem erro no teste E2E homologado.',
        measurementSource: 'Relatório Playwright',
      },
    ],
    acceptanceCriteria: [
      {
        id: 'AC_LOGIN_01',
        description: 'Usuário autenticado acessa somente o próprio tenant.',
        gate: 'e2e-browser',
        measurableTarget: 'Cenários positivo e negativo aprovados.',
      },
      {
        id: 'AC_A11Y_01',
        description: 'Fluxo principal funciona apenas com teclado.',
        gate: 'accessibility',
        measurableTarget: 'Zero bloqueio crítico no relatório de acessibilidade.',
      },
    ],
    requestedArchitectureId: 'official-authenticated-app-v1',
    ...overrides,
  };
}

function createSpecificationService() {
  let counter = 0;
  return new SiteSpecificationService(
    new InMemorySiteSpecificationRepository(),
    () => new Date(`2026-08-27T10:00:0${counter++}.000Z`),
    () => 'specification-id'
  );
}

describe('Versioned site engineering specification', () => {
  it('accepts a complete, strict and measurable discovery specification', () => {
    const result = siteSpecificationInputSchema.parse(validSpecification());
    expect(result.productType).toBe('authenticated-portal');
    expect(result.acceptanceCriteria).toHaveLength(2);
  });

  it('rejects duplicate pages and acceptance criteria', () => {
    const original = validSpecification();
    expect(() =>
      siteSpecificationInputSchema.parse({
        ...original,
        pages: [original.pages[0], original.pages[0]],
        acceptanceCriteria: [
          original.acceptanceCriteria[0],
          original.acceptanceCriteria[0],
        ],
      })
    ).toThrow();
  });

  it('blocks unsupported payment specifications before generation', () => {
    expect(() =>
      siteSpecificationInputSchema.parse(
        validSpecification({
          payments: {
            required: true,
            provider: 'none',
            sandboxRequired: false,
            products: ['Plano Pro'],
          },
        })
      )
    ).toThrow(/provedor real|sandbox/i);
  });

  it('blocks quantified marketing claims without a source or evidence', () => {
    const specification = validSpecification();
    specification.contentPolicy.approvedClaims = [
      {
        text: 'Mais de 10000 clientes satisfeitos',
        sourceUrls: [],
      },
    ];
    expect(() => siteSpecificationInputSchema.parse(specification)).toThrow(
      /exige fonte ou evidência/i
    );
  });

  it('allows a quantified claim only when its evidence is explicit', () => {
    const specification = validSpecification();
    specification.contentPolicy.approvedClaims = [
      {
        text: 'Mais de 10000 clientes satisfeitos',
        sourceUrls: ['https://example.com/audit/customer-count'],
      },
    ];
    expect(siteSpecificationInputSchema.parse(specification)).toBeTruthy();
  });

  it('selects only an official architecture compatible with the product', () => {
    expect(
      selectOfficialArchitecture(
        'authenticated-portal',
        'official-authenticated-app-v1'
      ).status
    ).toBe('official');
    expect(() =>
      selectOfficialArchitecture(
        'store',
        'official-content-site-v1'
      )
    ).toThrow(ArchitectureCompatibilityError);
  });

  it('covers every supported product type in the official catalog', () => {
    const supported = new Set(
      listOfficialArchitectures().flatMap(
        (architecture) => architecture.compatibleProductTypes
      )
    );
    expect(supported).toEqual(
      new Set([
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
      ])
    );
  });

  it('creates immutable version 1 with a deterministic content hash', async () => {
    const service = createSpecificationService();
    const input = validSpecification();
    const created = await service.create({
      scope,
      specification: input,
      actorUserId: scope.ownerUserId,
    });
    expect(created.version).toBe(1);
    expect(created.status).toBe('draft');
    expect(created.contentHash).toBe(hashSiteSpecification(input));
    expect((await service.listVersions(scope))).toHaveLength(1);
  });

  it('does not overwrite an existing project specification', async () => {
    const service = createSpecificationService();
    await service.create({
      scope,
      specification: validSpecification(),
      actorUserId: scope.ownerUserId,
    });
    await expect(
      service.create({
        scope,
        specification: validSpecification(),
        actorUserId: scope.ownerUserId,
      })
    ).rejects.toMatchObject({ code: 'specification_exists' });
  });

  it('applies a change request as a new version and preserves history', async () => {
    const service = createSpecificationService();
    await service.create({
      scope,
      specification: validSpecification(),
      actorUserId: scope.ownerUserId,
    });
    const changed = await service.applyChange({
      scope,
      requestId: 'change-title-0001',
      baseVersion: 1,
      reason: 'Atualizar o nome aprovado pelo cliente.',
      changes: { title: 'Portal Acme Empresas' },
      actorUserId: scope.ownerUserId,
    });
    expect(changed.version).toBe(2);
    expect(changed.specification.title).toBe('Portal Acme Empresas');
    expect(await service.listVersions(scope)).toHaveLength(2);
  });

  it('replays an idempotent change request without creating version 3', async () => {
    const service = createSpecificationService();
    await service.create({
      scope,
      specification: validSpecification(),
      actorUserId: scope.ownerUserId,
    });
    const change = {
      scope,
      requestId: 'change-title-replay',
      baseVersion: 1,
      reason: 'Atualizar o título uma única vez.',
      changes: { title: 'Portal replay seguro' },
      actorUserId: scope.ownerUserId,
    };
    const first = await service.applyChange(change);
    const replay = await service.applyChange(change);
    expect(replay.contentHash).toBe(first.contentHash);
    expect(await service.listVersions(scope)).toHaveLength(2);
  });

  it('rejects stale concurrent changes instead of losing an update', async () => {
    const service = createSpecificationService();
    await service.create({
      scope,
      specification: validSpecification(),
      actorUserId: scope.ownerUserId,
    });
    await service.applyChange({
      scope,
      requestId: 'change-current-0001',
      baseVersion: 1,
      reason: 'Primeira alteração concorrente.',
      changes: { title: 'Versão atual' },
      actorUserId: scope.ownerUserId,
    });
    await expect(
      service.applyChange({
        scope,
        requestId: 'change-stale-0002',
        baseVersion: 1,
        reason: 'Alteração baseada em versão antiga.',
        changes: { title: 'Versão perdida' },
        actorUserId: scope.ownerUserId,
      })
    ).rejects.toBeInstanceOf(SiteSpecificationError);
  });

  it('rejects prototype-pollution paths in a change request', async () => {
    const service = createSpecificationService();
    await service.create({
      scope,
      specification: validSpecification(),
      actorUserId: scope.ownerUserId,
    });
    const changes = JSON.parse('{"__proto__":{"polluted":true}}');
    await expect(
      service.applyChange({
        scope,
        requestId: 'unsafe-change-001',
        baseVersion: 1,
        reason: 'Tentativa adversarial deve falhar.',
        changes,
        actorUserId: scope.ownerUserId,
      })
    ).rejects.toMatchObject({ code: 'invalid_change_request' });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('Site quality gates and honest readiness', () => {
  async function approvedSpecification() {
    const service = createSpecificationService();
    await service.create({
      scope,
      specification: validSpecification(),
      actorUserId: scope.ownerUserId,
    });
    return service.approve({
      scope,
      expectedVersion: 1,
      actorUserId: scope.ownerUserId,
    });
  }

  it('refuses to create a quality plan from an unapproved draft', async () => {
    const specificationService = createSpecificationService();
    const draft = await specificationService.create({
      scope,
      specification: validSpecification(),
      actorUserId: scope.ownerUserId,
    });
    const quality = new SiteQualityGateService(
      new InMemorySiteQualityPlanRepository()
    );
    await expect(
      quality.createPlan({
        scope,
        specification: draft,
        actorUserId: scope.ownerUserId,
      })
    ).rejects.toMatchObject({ code: 'specification_not_approved' });
  });

  it('starts only specification and architecture gates as passed', async () => {
    const specification = await approvedSpecification();
    const quality = new SiteQualityGateService(
      new InMemorySiteQualityPlanRepository(),
      () => new Date('2026-08-27T10:30:00.000Z'),
      () => 'quality-plan-id'
    );
    const plan = await quality.createPlan({
      scope,
      specification,
      actorUserId: scope.ownerUserId,
    });
    expect(plan.gates.filter((gate) => gate.status === 'passed').map((gate) => gate.key))
      .toEqual(['specification', 'architecture']);
    expect(plan.gates.find((gate) => gate.key === 'e2e-browser')?.acceptanceCriterionIds)
      .toContain('AC_LOGIN_01');
  });

  it('reports blocked while any mandatory gate is pending', async () => {
    const specification = await approvedSpecification();
    const quality = new SiteQualityGateService(
      new InMemorySiteQualityPlanRepository()
    );
    await quality.createPlan({ scope, specification, actorUserId: scope.ownerUserId });
    const readiness = await quality.evaluateReadiness(scope);
    expect(readiness.ready).toBe(false);
    expect(readiness.status).toBe('blocked');
    expect(readiness.pendingGates).toContain('production-deployment');
  });

  it('requires a real SHA-256 evidence digest for a passing gate', async () => {
    const specification = await approvedSpecification();
    const quality = new SiteQualityGateService(
      new InMemorySiteQualityPlanRepository()
    );
    const plan = await quality.createPlan({
      scope,
      specification,
      actorUserId: scope.ownerUserId,
    });
    await expect(
      quality.recordGate({
        scope,
        gateKey: 'unit-tests',
        expectedPlanVersion: plan.planVersion,
        status: 'passed',
        actorUserId: scope.ownerUserId,
        evidence: {
          evidenceId: 'evidence-unit-01',
          kind: 'test-report',
          uri: 'urn:test:unit',
          digest: 'not-a-digest',
          summary: 'Suíte unitária executada.',
          environment: 'test',
          observedAt: '2026-08-27T10:40:00.000Z',
          recordedBy: scope.ownerUserId,
          reviewerUserId: scope.ownerUserId,
          implementerUserId: scope.ownerUserId,
        },
      })
    ).rejects.toMatchObject({ code: 'invalid_gate_evidence' });
  });

  it('prevents the implementer from approving an independent security gate', async () => {
    const specification = await approvedSpecification();
    const quality = new SiteQualityGateService(
      new InMemorySiteQualityPlanRepository()
    );
    const plan = await quality.createPlan({
      scope,
      specification,
      actorUserId: scope.ownerUserId,
    });
    await expect(
      quality.recordGate({
        scope,
        gateKey: 'security',
        expectedPlanVersion: plan.planVersion,
        status: 'passed',
        actorUserId: scope.ownerUserId,
        evidence: {
          evidenceId: 'security-evidence-001',
          kind: 'security-report',
          uri: 'https://ci.example.com/security/123',
          digest: 'a'.repeat(64),
          summary: 'Relatório de segurança sem achados críticos.',
          environment: 'test',
          observedAt: '2026-08-27T10:40:00.000Z',
          recordedBy: scope.ownerUserId,
          reviewerUserId: scope.ownerUserId,
          implementerUserId: scope.ownerUserId,
        },
      })
    ).rejects.toBeInstanceOf(SiteQualityGateError);
  });

  it('accepts independent evidence only from a different authenticated actor', async () => {
    const specification = await approvedSpecification();
    const quality = new SiteQualityGateService(
      new InMemorySiteQualityPlanRepository()
    );
    const plan = await quality.createPlan({
      scope,
      specification,
      actorUserId: scope.ownerUserId,
    });
    const updated = await quality.recordGate({
      scope,
      gateKey: 'security',
      expectedPlanVersion: plan.planVersion,
      status: 'passed',
      actorUserId: 'independent-reviewer',
      evidence: {
        evidenceId: 'security-evidence-002',
        kind: 'security-report',
        uri: 'https://ci.example.com/security/124',
        digest: 'b'.repeat(64),
        summary: 'Revisão independente confirmou o relatório.',
        environment: 'test',
        observedAt: '2026-08-27T10:41:00.000Z',
        recordedBy: 'forged-value',
        reviewerUserId: 'forged-value',
        implementerUserId: 'forged-value',
      },
    });
    const evidence = updated.gates.find((gate) => gate.key === 'security')!.evidence[0];
    expect(evidence.reviewerUserId).toBe('independent-reviewer');
    expect(evidence.implementerUserId).toBe(scope.ownerUserId);
  });

  it('keeps an explicit external blocker visible in readiness', async () => {
    const specification = await approvedSpecification();
    const quality = new SiteQualityGateService(
      new InMemorySiteQualityPlanRepository()
    );
    const plan = await quality.createPlan({
      scope,
      specification,
      actorUserId: scope.ownerUserId,
    });
    await quality.recordGate({
      scope,
      gateKey: 'preview-deployment',
      expectedPlanVersion: plan.planVersion,
      status: 'external_blocker',
      actorUserId: scope.ownerUserId,
      blockerCode: 'VERCEL_CREDENTIAL_MISSING',
    });
    const readiness = await quality.evaluateReadiness(scope);
    expect(readiness.externalBlockers).toContainEqual({
      gate: 'preview-deployment',
      code: 'VERCEL_CREDENTIAL_MISSING',
    });
  });
});
