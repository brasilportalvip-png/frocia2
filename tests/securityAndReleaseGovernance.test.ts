import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  inspectPayloadIntegrity,
  requestIntegrityMiddleware,
} from '../server/middlewares/requestIntegrity.js';
import {
  InMemorySecurityEventRepository,
  SecurityEventService,
} from '../server/security/securityEventService.js';
import {
  InMemoryProductionReleaseRepository,
  PRODUCTION_GATE_KEYS,
  ProductionGateEvidence,
  ProductionGateKey,
  ProductionReleaseService,
} from '../server/release/productionReleaseService.js';
import { CapabilityRegistryService } from '../server/services/capabilityRegistryService.js';
import {
  CONTINUOUS_EVALUATION_VERSION,
  evaluateContinuousEvaluationGate,
  listContinuousEvaluations,
} from '../server/ai/continuousEvaluationCatalog.js';

function securityApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { correlationId: string }).correlationId = 'corr-security-test';
    next();
  });
  app.use(requestIntegrityMiddleware);
  app.post('/api/change', (_req, res) => res.json({ accepted: true }));
  return app;
}

const commitSha = 'a'.repeat(40);
const baseCommitSha = '9'.repeat(40);

function evidence(
  gate: ProductionGateKey,
  actor = 'implementer',
  environment: ProductionGateEvidence['environment'] = 'test'
): ProductionGateEvidence {
  return {
    evidenceId: `evidence-${gate.replace(/[^a-z]/g, '-')}-001`,
    uri: `urn:frocia:test:${gate}`,
    digest: 'b'.repeat(64),
    commitSha,
    environment,
    command: `npm run gate:${gate}`,
    result: `Gate ${gate} executado com resultado aprovado.`,
    observedAt: new Date().toISOString(),
    recordedBy: actor,
    reviewerUserId: actor,
  };
}

describe('Request integrity and abuse protection', () => {
  it('accepts a regular bounded JSON payload', () => {
    expect(inspectPayloadIntegrity({ profile: { name: 'Flavio' } })).toEqual({ safe: true });
  });

  it('blocks prototype-pollution keys at any depth', () => {
    const malicious = JSON.parse('{"safe":{"constructor":{"prototype":{"admin":true}}}}');
    expect(inspectPayloadIntegrity(malicious)).toMatchObject({
      safe: false,
      reason: 'forbidden_key',
    });
  });

  it('blocks payloads deeper than the bounded parser policy', () => {
    let value: Record<string, unknown> = {};
    for (let index = 0; index < 30; index += 1) value = { nested: value };
    expect(inspectPayloadIntegrity(value)).toMatchObject({
      safe: false,
      reason: 'payload_too_deep',
    });
  });

  it('rejects cross-site mutations before the route handler', async () => {
    const response = await request(securityApp())
      .post('/api/change')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ value: 1 });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('cross_site_mutation_blocked');
  });

  it('requires JSON content type for a request body', async () => {
    const response = await request(securityApp())
      .post('/api/change')
      .set('Content-Type', 'text/plain')
      .send('value=1');
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('json_content_type_required');
  });

  it('allows same-origin or server-to-server JSON mutations', async () => {
    const response = await request(securityApp()).post('/api/change').send({ value: 1 });
    expect(response.status).toBe(200);
    expect(response.body.accepted).toBe(true);
  });
});

describe('Security event detection and incident response', () => {
  it('redacts secrets before persisting a security event', async () => {
    const repository = new InMemorySecurityEventRepository();
    const service = new SecurityEventService(repository, () => new Date('2026-08-27T16:00:00.000Z'), () => 'event-0001');
    await service.record({
      category: 'secret_exposure_attempt',
      severity: 'high',
      correlationId: 'corr-1',
      details: { token: 'Bearer secret-value', nested: { password: 'hidden' } },
    });
    expect(repository.events[0].details).toEqual({
      token: '[REDACTED_SECRET]',
      nested: { password: '[REDACTED_SECRET]' },
    });
  });

  it('opens one incident and increments it for repeated high-severity events', async () => {
    const repository = new InMemorySecurityEventRepository();
    const service = new SecurityEventService(repository);
    const input = {
      category: 'unsafe_payload' as const,
      severity: 'high' as const,
      correlationId: 'corr-repeat',
      route: '/api/change',
    };
    await service.record(input);
    await service.record(input);
    const incidents = await service.listIncidents();
    expect(incidents).toHaveLength(1);
    expect(incidents[0].eventCount).toBe(2);
  });

  it('requires a concrete resolution before closing an incident', async () => {
    const repository = new InMemorySecurityEventRepository();
    const service = new SecurityEventService(repository);
    await service.record({
      category: 'cross_site_mutation',
      severity: 'critical',
      correlationId: 'corr-close',
    });
    const [incident] = await service.listIncidents();
    await expect(
      service.transitionIncident({
        incidentId: incident.incidentId,
        status: 'contained',
        actorUserId: 'admin-1',
      })
    ).resolves.toMatchObject({ status: 'contained' });
    await expect(
      service.transitionIncident({
        incidentId: incident.incidentId,
        status: 'resolved',
        actorUserId: 'admin-1',
        resolutionSummary: 'curto',
      })
    ).rejects.toThrow('security_incident_resolution_required');
  });
});

describe('Fail-closed production release gates', () => {
  function releaseService() {
    return new ProductionReleaseService(new InMemoryProductionReleaseRepository());
  }

  it('creates all mandatory gates as pending', async () => {
    const service = releaseService();
    const plan = await service.create({
      releaseId: 'release-20260827',
      version: '2026.08.27',
      baseCommitSha,
      commitSha,
      implementerUserId: 'implementer',
    });
    expect(plan.gates.map((gate) => gate.key)).toEqual(PRODUCTION_GATE_KEYS);
    expect(plan.gates.every((gate) => gate.status === 'pending')).toBe(true);
    await expect(service.evaluate(plan.releaseId)).resolves.toMatchObject({ ready: false });
  });

  it('rejects evidence from another commit', async () => {
    const service = releaseService();
    const plan = await service.create({ releaseId: 'release-wrong-commit', version: '1', baseCommitSha, commitSha, implementerUserId: 'implementer' });
    await expect(
      service.recordGate({
        releaseId: plan.releaseId,
        expectedPlanVersion: 1,
        gateKey: 'clean-install',
        status: 'passed',
        actorUserId: 'implementer',
        evidence: { ...evidence('clean-install'), commitSha: 'c'.repeat(40) },
      })
    ).rejects.toMatchObject({ code: 'invalid_evidence' });
  });

  it('blocks staging until its local dependencies passed', async () => {
    const service = releaseService();
    const plan = await service.create({ releaseId: 'release-dependency', version: '1', baseCommitSha, commitSha, implementerUserId: 'implementer' });
    await expect(
      service.recordGate({
        releaseId: plan.releaseId,
        expectedPlanVersion: 1,
        gateKey: 'staging',
        status: 'passed',
        actorUserId: 'implementer',
        evidence: evidence('staging', 'implementer', 'staging'),
      })
    ).rejects.toMatchObject({ code: 'gate_dependency_pending' });
  });

  it('prevents the implementer from approving security and independent audit', async () => {
    const service = releaseService();
    const plan = await service.create({ releaseId: 'release-independent', version: '1', baseCommitSha, commitSha, implementerUserId: 'implementer' });
    await expect(
      service.recordGate({
        releaseId: plan.releaseId,
        expectedPlanVersion: 1,
        gateKey: 'security-audit',
        status: 'passed',
        actorUserId: 'implementer',
        evidence: evidence('security-audit'),
      })
    ).rejects.toMatchObject({ code: 'independent_review_required' });
  });

  it('keeps external blockers visible instead of treating them as success', async () => {
    const service = releaseService();
    const plan = await service.create({ releaseId: 'release-blocked', version: '1', baseCommitSha, commitSha, implementerUserId: 'implementer' });
    await service.recordGate({
      releaseId: plan.releaseId,
      expectedPlanVersion: 1,
      gateKey: 'backup',
      status: 'external_blocker',
      actorUserId: 'implementer',
      blockerCode: 'AUTOMATIC_BACKUP_NOT_CONFIGURED',
    });
    await expect(service.evaluate(plan.releaseId)).resolves.toMatchObject({
      ready: false,
      externalBlockers: [{ gate: 'backup', code: 'AUTOMATIC_BACKUP_NOT_CONFIGURED' }],
    });
  });

  it('produces an honest final report without invented evidence', async () => {
    const service = releaseService();
    const plan = await service.create({ releaseId: 'release-report', version: '1', baseCommitSha, commitSha, implementerUserId: 'implementer' });
    const report = await service.finalReport(plan.releaseId);
    expect(report.evidenceInvented).toBe(false);
    expect(report.decision.ready).toBe(false);
    expect(report.residualRisks.length).toBe(PRODUCTION_GATE_KEYS.length);
  });
});

describe('Capability evidence honesty', () => {
  it('does not manufacture a verification timestamp from configuration checks', () => {
    const registry = CapabilityRegistryService.getCapabilityRegistry();
    expect(registry.capabilities.every((capability) => capability.lastVerifiedAt === null)).toBe(true);
    expect(registry.capabilities.every((capability) => Boolean(capability.checkedAt))).toBe(true);
  });
});

describe('Versioned continuous evaluation gate', () => {
  it('covers all 17 required evaluation categories', () => {
    const catalog = listContinuousEvaluations();
    expect(catalog).toHaveLength(17);
    expect(new Set(catalog.map((definition) => definition.category)).size).toBe(17);
    expect(catalog.every((definition) => definition.version === CONTINUOUS_EVALUATION_VERSION)).toBe(true);
  });

  it('fails closed when evaluation results are absent', () => {
    const decision = evaluateContinuousEvaluationGate({
      commitSha,
      implementerUserId: 'implementer',
      results: [],
    });
    expect(decision.ready).toBe(false);
    expect(decision.missing).toHaveLength(17);
  });

  it('does not accept the implementer as independent reviewer', () => {
    const definition = listContinuousEvaluations().find(
      (item) => item.independentReviewRequired
    )!;
    const decision = evaluateContinuousEvaluationGate({
      commitSha,
      implementerUserId: 'implementer',
      results: [
        {
          definitionId: definition.id,
          version: CONTINUOUS_EVALUATION_VERSION,
          score: 1,
          commitSha,
          evidenceDigest: 'd'.repeat(64),
          evidenceUri: 'urn:frocia:evaluation:test',
          executedAt: new Date().toISOString(),
          executedBy: 'implementer',
          reviewerUserId: 'implementer',
        },
      ],
    });
    expect(decision.independentReviewMissing).toContain(definition.id);
  });
});
