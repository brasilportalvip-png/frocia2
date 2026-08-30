import { Response, Router } from 'express';
import { z, ZodError } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { AuthenticatedRequest } from '../types.js';
import {
  ArchitectureCompatibilityError,
  listOfficialArchitectures,
} from '../siteFactory/siteArchitectureCatalog.js';
import {
  SiteScope,
  SiteSpecificationError,
} from '../siteFactory/siteSpecificationService.js';
import {
  SiteGateEvidence,
  SiteQualityGateError,
} from '../siteFactory/siteQualityGateService.js';
import {
  getSiteQualityGateService,
  getSiteSpecificationService,
} from '../siteFactory/siteFactoryRuntime.js';
import { buildSiteBrowserTestPlan } from '../siteFactory/siteBrowserTestPlanService.js';

export const siteFactoryRouter = Router();

const siteFactoryLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  keyPrefix: 'site-factory',
});

const projectIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9:_-]{1,160}$/);

const createSpecificationSchema = z
  .object({
    specification: z.unknown(),
  })
  .strict();

const changeRequestSchema = z
  .object({
    requestId: z.string().trim().min(8).max(120),
    baseVersion: z.number().int().positive(),
    reason: z.string().trim().min(8).max(1000),
    changes: z.unknown(),
  })
  .strict();

const approveSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

const qualityGateKeys = [
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
] as const;

const evidenceKinds = [
  'test-report',
  'browser-run',
  'security-report',
  'deployment-receipt',
  'provider-status',
  'runtime-log-query',
  'manual-review',
  'rollback-drill',
  'monitoring-snapshot',
  'specification-approval',
  'architecture-selection',
] as const;

const gateEvidenceSchema = z
  .object({
    evidenceId: z.string().trim().min(8).max(160),
    kind: z.enum(evidenceKinds),
    uri: z.string().trim().min(3).max(2048),
    digest: z.string().regex(/^[a-f0-9]{64}$/i),
    summary: z.string().trim().min(8).max(1000),
    environment: z.enum(['local', 'test', 'preview', 'production']),
    observedAt: z.string().datetime(),
    recordedBy: z.string().trim().min(1).max(160),
    reviewerUserId: z.string().trim().max(160).nullable(),
    implementerUserId: z.string().trim().max(160).nullable(),
  })
  .strict();

const recordGateSchema = z
  .object({
    expectedPlanVersion: z.number().int().positive(),
    status: z.enum(['passed', 'failed', 'external_blocker']),
    evidence: gateEvidenceSchema.optional(),
    failureReason: z.string().trim().max(1000).optional(),
    blockerCode: z.string().trim().max(160).optional(),
  })
  .strict();

function getScope(req: AuthenticatedRequest): SiteScope {
  return {
    projectId: projectIdSchema.parse(req.params.projectId),
    tenantId: req.user!.tenantId,
    ownerUserId: req.user!.uid,
  };
}

function getReviewScope(req: AuthenticatedRequest): SiteScope {
  const requestedOwner =
    typeof req.query.ownerUserId === 'string' &&
    /^[A-Za-z0-9:_-]{1,160}$/.test(req.query.ownerUserId)
      ? req.query.ownerUserId
      : req.user!.uid;
  const canReviewTenantProject =
    req.user!.role === 'admin' ||
    !req.user!.tenantId.startsWith('user:');
  return {
    projectId: projectIdSchema.parse(req.params.projectId),
    tenantId: req.user!.tenantId,
    ownerUserId:
      requestedOwner === req.user!.uid || canReviewTenantProject
        ? requestedOwner
        : req.user!.uid,
  };
}

function sendRouteError(
  error: unknown,
  req: AuthenticatedRequest,
  res: Response
) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'invalid_site_factory_request',
        message: 'A solicitação da fábrica de sites é inválida.',
        details: error.issues,
        correlationId: req.correlationId,
      },
    });
  }
  if (error instanceof ArchitectureCompatibilityError) {
    return res.status(409).json({
      error: {
        code: error.code,
        message: error.message,
        correlationId: req.correlationId,
      },
    });
  }
  if (
    error instanceof SiteSpecificationError ||
    error instanceof SiteQualityGateError
  ) {
    return res.status(error.httpStatus).json({
      error: {
        code: error.code,
        message: error.message,
        correlationId: req.correlationId,
      },
    });
  }
  console.error('site_factory_request_failed', {
    correlationId: req.correlationId,
    message: error instanceof Error ? error.message : String(error),
  });
  return res.status(500).json({
    error: {
      code: 'site_factory_request_failed',
      message: 'A fábrica de sites não conseguiu concluir a solicitação.',
      correlationId: req.correlationId,
    },
  });
}

siteFactoryRouter.use(requireAuth, siteFactoryLimiter);

siteFactoryRouter.get('/architectures', (_req, res) => {
  return res.json({
    architectures: listOfficialArchitectures(),
  });
});

siteFactoryRouter.post(
  '/projects/:projectId/specifications',
  async (req: AuthenticatedRequest, res) => {
    try {
      const body = createSpecificationSchema.parse(req.body);
      const specification = await getSiteSpecificationService().create({
        scope: getScope(req),
        specification: body.specification,
        actorUserId: req.user!.uid,
      });
      return res.status(201).json({
        specification,
        correlationId: req.correlationId,
      });
    } catch (error) {
      return sendRouteError(error, req, res);
    }
  }
);

siteFactoryRouter.get(
  '/projects/:projectId/specifications/current',
  async (req: AuthenticatedRequest, res) => {
    try {
      const specification = await getSiteSpecificationService().getCurrent(
        getScope(req)
      );
      return res.json({ specification, correlationId: req.correlationId });
    } catch (error) {
      return sendRouteError(error, req, res);
    }
  }
);

siteFactoryRouter.get(
  '/projects/:projectId/specifications/versions',
  async (req: AuthenticatedRequest, res) => {
    try {
      const versions = await getSiteSpecificationService().listVersions(
        getScope(req)
      );
      return res.json({ versions, correlationId: req.correlationId });
    } catch (error) {
      return sendRouteError(error, req, res);
    }
  }
);

siteFactoryRouter.post(
  '/projects/:projectId/specifications/change-requests',
  async (req: AuthenticatedRequest, res) => {
    try {
      const body = changeRequestSchema.parse(req.body);
      const specification = await getSiteSpecificationService().applyChange({
        scope: getScope(req),
        ...body,
        actorUserId: req.user!.uid,
      });
      return res.status(201).json({
        specification,
        correlationId: req.correlationId,
      });
    } catch (error) {
      return sendRouteError(error, req, res);
    }
  }
);

siteFactoryRouter.post(
  '/projects/:projectId/specifications/approve',
  async (req: AuthenticatedRequest, res) => {
    try {
      const body = approveSchema.parse(req.body);
      const scope = getScope(req);
      const specification = await getSiteSpecificationService().approve({
        scope,
        expectedVersion: body.expectedVersion,
        actorUserId: req.user!.uid,
      });
      const qualityPlan = await getSiteQualityGateService().createPlan({
        scope,
        specification,
        actorUserId: req.user!.uid,
      });
      return res.json({
        specification,
        qualityPlan,
        correlationId: req.correlationId,
      });
    } catch (error) {
      return sendRouteError(error, req, res);
    }
  }
);

siteFactoryRouter.get(
  '/projects/:projectId/quality-gates',
  async (req: AuthenticatedRequest, res) => {
    try {
      const qualityPlan = await getSiteQualityGateService().getPlan(getReviewScope(req));
      return res.json({ qualityPlan, correlationId: req.correlationId });
    } catch (error) {
      return sendRouteError(error, req, res);
    }
  }
);

siteFactoryRouter.get(
  '/projects/:projectId/browser-test-plan',
  async (req: AuthenticatedRequest, res) => {
    try {
      const specification = await getSiteSpecificationService().getCurrent(
        getReviewScope(req)
      );
      if (specification.status !== 'approved') {
        throw new SiteQualityGateError(
          'specification_not_approved',
          'A especificação precisa estar aprovada para gerar o plano de navegador.',
          409
        );
      }
      const browserTestPlan = buildSiteBrowserTestPlan(specification);
      return res.json({
        browserTestPlan,
        correlationId: req.correlationId,
      });
    } catch (error) {
      return sendRouteError(error, req, res);
    }
  }
);

siteFactoryRouter.post(
  '/projects/:projectId/quality-gates/:gateKey',
  async (req: AuthenticatedRequest, res) => {
    try {
      const gateKey = z.enum(qualityGateKeys).parse(req.params.gateKey);
      const body = recordGateSchema.parse(req.body);
      const qualityPlan = await getSiteQualityGateService().recordGate({
        scope: getReviewScope(req),
        gateKey,
        expectedPlanVersion: body.expectedPlanVersion,
        status: body.status,
        actorUserId: req.user!.uid,
        evidence: body.evidence as SiteGateEvidence | undefined,
        failureReason: body.failureReason,
        blockerCode: body.blockerCode,
      });
      return res.json({ qualityPlan, correlationId: req.correlationId });
    } catch (error) {
      return sendRouteError(error, req, res);
    }
  }
);

siteFactoryRouter.get(
  '/projects/:projectId/readiness',
  async (req: AuthenticatedRequest, res) => {
    try {
      const readiness = await getSiteQualityGateService().evaluateReadiness(
        getReviewScope(req)
      );
      return res.status(readiness.ready ? 200 : 409).json({
        readiness,
        correlationId: req.correlationId,
      });
    } catch (error) {
      return sendRouteError(error, req, res);
    }
  }
);
