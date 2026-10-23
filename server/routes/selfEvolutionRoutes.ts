import { Router } from 'express';
import { z } from 'zod';
import {
  adminDb,
  isFirebaseAdminConfigured
} from '../lib/firebaseAdmin.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { AuthenticatedRequest } from '../types.js';
import { SelfEvolutionPolicyEngine } from '../selfEvolution/selfEvolutionPolicyEngine.js';
import { SelfSiteKnowledgeService } from '../selfEvolution/selfSiteKnowledgeService.js';
import { SelfSiteOwnerService } from '../selfEvolution/selfSiteOwnerService.js';
import { ImprovementPlannerService } from '../selfEvolution/improvementPlannerService.js';
import { SelfEvolutionOrchestrator } from '../selfEvolution/selfEvolutionOrchestrator.js';
import { EvaluationEngine } from '../selfEvolution/evaluationEngine.js';
import { BudgetService } from '../selfEvolution/budgetService.js';
import { AuditService } from '../selfEvolution/auditService.js';
import {
  CommitteeGateService,
  CommitteePersistenceUnavailableError
} from '../selfEvolution/committeeGateService.js';
import {
  COMMITTEE_ROLES,
  CommitteeReview
} from '../selfEvolution/selfEvolutionTypes.js';
import { SpecialistCommitteeExecutionService } from '../selfEvolution/specialistCommitteeExecutionService.js';
import {
  CAPABILITY_CATEGORIES,
  ContinuousCapabilityEvaluationService,
} from '../ai/continuousCapabilityEvaluationService.js';

export const selfEvolutionRouter = Router();

selfEvolutionRouter.get('/site-map', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const knowledge = await SelfSiteKnowledgeService.latest();
    const operations = await SelfSiteOwnerService.operationalSnapshot();
    return res.status(knowledge ? 200 : 503).json({ status: knowledge ? 'indexed' : 'not_indexed', knowledge, operations });
  } catch { return res.status(503).json({ error: 'Nao foi possivel consultar o mapa do proprio projeto.' }); }
});

selfEvolutionRouter.get('/repository/source', requireAuth, requireAdmin, async (req, res) => {
  try {
    const knowledge = await SelfSiteKnowledgeService.latest();
    if (!knowledge) return res.status(503).json({ error: 'Indice do proprio repositorio ainda nao disponivel.' });
    const part = req.query.part === undefined ? 0 : Number(req.query.part);
    const source = await SelfSiteKnowledgeService.readSource(knowledge.commitSha, String(req.query.path || ''), part);
    return res.json(source);
  } catch { return res.status(400).json({ error: 'Arquivo, parte ou acesso indisponivel no indice.' }); }
});

selfEvolutionRouter.post('/control/run', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 10 || reason.length > 5000) return res.status(400).json({ error: 'Descreva o pedido em 10 a 5000 caracteres.' });
  try {
    const receipt = await SelfSiteOwnerService.requestRun(req.user!.uid, reason);
    return res.status(receipt.status === 'blocked' || receipt.status === 'paused' ? 409 : 202).json(receipt);
  } catch { return res.status(503).json({ error: 'O pedido de manutencao nao pode ser confirmado. Consulte o estado antes de repetir.' }); }
});

selfEvolutionRouter.post('/control/enabled', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Informe enabled true ou false.' });
  try {
    const receipt = await SelfSiteOwnerService.setEnabled(req.user!.uid, req.body.enabled, 'Comando autenticado do administrador.');
    return res.status(receipt.status === 'blocked' ? 503 : 200).json(receipt);
  } catch { return res.status(503).json({ error: 'Nao foi possivel confirmar o controle global.' }); }
});

// Middleware: inject correlation ID
selfEvolutionRouter.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  res.setHeader('x-correlation-id', correlationId);
  (req as any).correlationId = correlationId;
  next();
});

// Zod Schemas
const candidateIdSchema = z.object({
  id: z.string().min(1).max(100),
}).strict();

const rollbackBodySchema = z.object({
  reason: z.string().min(3).max(500).optional(),
}).strict();

const emergencyStopSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
}).strict();

const committeeReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) => !/[\x00-\x1F\x7F]/.test(value),
    'Referência contém caractere de controle.'
  );

const committeeReviewSchema = z.object({
  role: z.enum(COMMITTEE_ROLES),
  commitSha: z
    .string()
    .regex(/^[a-f0-9]{7,40}$/i),
  verdict: z.enum([
    'approved',
    'changes_required',
    'blocked'
  ]),
  summary: z.string().trim().min(10).max(2000),
  fileRefs: z
    .array(committeeReferenceSchema)
    .max(100)
    .default([]),
  testRefs: z
    .array(committeeReferenceSchema)
    .max(100)
    .default([]),
  evidenceRefs: z
    .array(committeeReferenceSchema)
    .min(1)
    .max(100),
  risks: z
    .array(committeeReferenceSchema)
    .max(100)
    .default([])
}).strict();

const capabilityRunSchema = z.object({
  version: z.string().min(1).max(100),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/i),
  createdAt: z.string().datetime(),
  scores: z.array(z.object({
    category: z.enum(CAPABILITY_CATEGORIES),
    passed: z.number().int().nonnegative(), total: z.number().int().positive(),
    score: z.number().min(0).max(1),
    evidenceRefs: z.array(z.string().min(1).max(500)).min(1).max(100),
  }).strict()).length(CAPABILITY_CATEGORIES.length),
}).strict();

const capabilityComparisonSchema = z.object({
  baseline: capabilityRunSchema,
  candidate: capabilityRunSchema,
}).strict();

// GET /api/admin/self-evolution/status
selfEvolutionRouter.get(
  '/status',
  requireAuth,
  requireAdmin,
  async (
    _req: AuthenticatedRequest,
    res
  ) => {
    const [
      budget,
      candidates,
      enabled
    ] = await Promise.all([
      BudgetService.getBudgetStatus(),
      ImprovementPlannerService.getCandidates(),
      SelfEvolutionPolicyEngine
        .isSelfEvolutionEnabledPersisted()
    ]);

    return res.json({
      enabled,
      autonomousProductionDeployAllowed:
        SelfEvolutionPolicyEngine
          .isAutonomousProductionDeployAllowed(),
      budget,
      candidatesCount: candidates.length,
      timestamp: new Date().toISOString()
    });
  }
);

selfEvolutionRouter.post(
  '/evaluations/compare',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const parsed = capabilityComparisonSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Avaliação comparativa inválida.' });
    try {
      const comparison = await ContinuousCapabilityEvaluationService.compareAndPersist(
        parsed.data.baseline, parsed.data.candidate
      );
      return res.status(comparison.passed ? 200 : 409).json({ comparison });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Avaliação inválida.' });
    }
  }
);

selfEvolutionRouter.post(
  '/committee/:id/execute-specialists',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const parsed = candidateIdSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: 'ID de candidato inválido.' });
    const candidate = await ImprovementPlannerService.getCandidateById(parsed.data.id);
    if (!candidate) return res.status(404).json({ error: 'Candidato não encontrado.' });
    try {
      const reviews = await SpecialistCommitteeExecutionService.execute(candidate);
      const gate = CommitteeGateService.evaluateReviews({
        candidateId: candidate.id, commitSha: candidate.headCommitSha,
        riskLevel: candidate.riskLevel, reviews,
      });
      await AuditService.logEvent({
        actor: req.user!.uid, action: 'specialist_committee_executed', resource: candidate.id,
        riskLevel: candidate.riskLevel, result: gate.approved ? 'success' : 'rejected',
        commitHash: candidate.headCommitSha, correlationId: req.correlationId,
        reason: gate.reason,
      });
      return res.json({ reviews, gate });
    } catch (error) {
      return res.status(503).json({
        error: { code: 'specialist_committee_unavailable', message: error instanceof Error ? error.message : 'Comitê indisponível.' },
      });
    }
  }
);

// GET /api/admin/self-evolution/candidates
selfEvolutionRouter.get('/candidates', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res) => {
  const candidates = await ImprovementPlannerService.getCandidates();
  return res.json({ candidates });
});

// POST /api/admin/self-evolution/committee/simulation
// Executa somente as regras puras do gate. Não persiste, não chama IA, não
// consome créditos e não pode iniciar PR, deploy ou release.
selfEvolutionRouter.post(
  '/committee/simulation',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const candidateId = `simulation-${Date.now()}`;
    const commitSha = 'a'.repeat(40);
    const observedAt = new Date().toISOString();
    const reviews: CommitteeReview[] = COMMITTEE_ROLES.map((role, index) => ({
      id: `${candidateId}-${role}`,
      candidateId,
      role,
      actorUid: `simulation-actor-${index + 1}`,
      commitSha,
      verdict: 'approved',
      summary: `Simulação segura do papel ${role}: referências concretas conferidas sem executar alterações.`,
      fileRefs: ['server/selfEvolution/committeeGateService.ts'],
      testRefs: ['tests/selfEvolutionEngine.test.ts'],
      evidenceRefs: ['npm:test:selfEvolutionEngine:16-passed'],
      risks: ['Simulação somente leitura; não representa aprovação de produção.'],
      createdAt: observedAt,
      updatedAt: observedAt,
    }));
    const gate = CommitteeGateService.evaluateReviews({
      candidateId,
      commitSha,
      riskLevel: 'R1',
      reviews,
    });
    const withoutVerifier = CommitteeGateService.evaluateReviews({
      candidateId,
      commitSha,
      riskLevel: 'R1',
      reviews: reviews.filter((review) => review.role !== 'independent_verifier'),
    });

    await AuditService.logEvent({
      actor: req.user!.uid,
      action: 'committee_safe_simulation_executed',
      resource: candidateId,
      newState: { gateStatus: gate.status, verifierControlStatus: withoutVerifier.status },
      riskLevel: 'R0',
      result: 'success',
      correlationId: (req as any).correlationId,
      commitHash: commitSha,
    });

    return res.json({
      simulation: true,
      candidateId,
      commitSha,
      reviews,
      gate,
      verifierControl: withoutVerifier,
      sideEffects: { credits: 0, aiCalls: 0, pullRequests: 0, deployments: 0 },
      observedAt,
    });
  }
);

selfEvolutionRouter.get(
  '/committee/:id/reviews',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const paramVal = candidateIdSchema.safeParse(req.params);
    if (!paramVal.success) return res.status(400).json({ error: 'ID de candidato inválido.' });
    const candidate = await ImprovementPlannerService.getCandidateById(paramVal.data.id);
    if (!candidate) return res.status(404).json({ error: 'Candidato não encontrado.' });
    try {
      const reviews = await CommitteeGateService.listReviews(candidate.id);
      const gate = CommitteeGateService.evaluateReviews({
        candidateId: candidate.id,
        commitSha: candidate.headCommitSha,
        riskLevel: candidate.riskLevel,
        reviews,
      });
      return res.json({ reviews, gate, commitSha: candidate.headCommitSha || null });
    } catch (error) {
      if (error instanceof CommitteePersistenceUnavailableError) {
        return res.status(503).json({ error: error.message });
      }
      throw error;
    }
  }
);

// GET /api/admin/self-evolution/candidates/:id
selfEvolutionRouter.get('/candidates/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const paramVal = candidateIdSchema.safeParse(req.params);
  if (!paramVal.success) {
    return res.status(400).json({ error: 'ID de candidato inválido.' });
  }

  const candidate = await ImprovementPlannerService.getCandidateById(paramVal.data.id);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidato de melhoria não encontrado.' });
  }
  return res.json({ candidate });
});

// POST /api/admin/self-evolution/committee/:id/reviews
selfEvolutionRouter.post(
  '/committee/:id/reviews',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const paramVal = candidateIdSchema.safeParse(
      req.params
    );
    const bodyVal = committeeReviewSchema.safeParse(
      req.body
    );

    if (!paramVal.success || !bodyVal.success) {
      return res.status(400).json({
        error:
          'Parecer do comitê inválido.',
        details: bodyVal.success
          ? []
          : bodyVal.error.issues.map(
              (issue) => issue.message
            )
      });
    }

    const candidate =
      await ImprovementPlannerService
        .getCandidateById(
          paramVal.data.id
        );

    if (!candidate) {
      return res.status(404).json({
        error: 'Candidato não encontrado.'
      });
    }

    if (
      !candidate.headCommitSha ||
      candidate.headCommitSha !==
        bodyVal.data.commitSha
    ) {
      return res.status(409).json({
        error:
          'O parecer não corresponde ao commit atual do candidato.'
      });
    }

    try {
      const review =
        await CommitteeGateService.submitReview({
          candidateId: candidate.id,
          actorUid: req.user!.uid,
          ...bodyVal.data
        });

      await AuditService.logEvent({
        actor: req.user!.uid,
        action: 'committee_review_submitted',
        resource: candidate.id,
        newState: {
          role: review.role,
          verdict: review.verdict,
          commitSha: review.commitSha
        },
        riskLevel: candidate.riskLevel,
        result: 'success',
        correlationId:
          (req as any).correlationId,
        commitHash: review.commitSha,
        prUrl: candidate.pullRequestUrl
      });

      return res.status(201).json({ review });
    } catch (error) {
      if (
        error instanceof
        CommitteePersistenceUnavailableError
      ) {
        return res.status(503).json({
          error: error.message
        });
      }

      console.error(
        'Erro ao persistir parecer do comitê:',
        error
      );

      return res.status(500).json({
        error:
          'Não foi possível persistir o parecer do comitê.'
      });
    }
  }
);

// GET /api/admin/self-evolution/committee/:id/gate
selfEvolutionRouter.get(
  '/committee/:id/gate',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const paramVal = candidateIdSchema.safeParse(
      req.params
    );

    if (!paramVal.success) {
      return res.status(400).json({
        error: 'ID de candidato inválido.'
      });
    }

    const candidate =
      await ImprovementPlannerService
        .getCandidateById(
          paramVal.data.id
        );

    if (!candidate) {
      return res.status(404).json({
        error: 'Candidato não encontrado.'
      });
    }

    const gate =
      await CommitteeGateService
        .evaluateCandidate(candidate);

    return res.status(
      gate.status === 'approved' ? 200 : 409
    ).json({ gate });
  }
);

// POST /api/admin/self-evolution/candidates/:id/approve-work
selfEvolutionRouter.post('/candidates/:id/approve-work', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const paramVal = candidateIdSchema.safeParse(req.params);
  if (!paramVal.success) {
    return res.status(400).json({ error: 'ID de candidato inválido.' });
  }

  const candidateId = paramVal.data.id;
  const candidate = await ImprovementPlannerService.getCandidateById(candidateId);
   if (!candidate) {
    return res.status(404).json({ error: 'Candidato não encontrado.' });
  }

  if (candidate.state !== 'awaiting_work_approval') {
    return res.status(409).json({
      error: `Aprovação de trabalho indisponível para o estado ${candidate.state}.`,
    });
  }

  await ImprovementPlannerService.updateCandidateState(candidateId, 'approved_for_work');
  await AuditService.logEvent({
    actor: req.user!.uid,
    action: 'approve_work',
    resource: candidateId,
    riskLevel: candidate.riskLevel,
    result: 'success',
    correlationId: (req as any).correlationId,
  });

  const result = await SelfEvolutionOrchestrator.processCandidateLifecycle(candidateId, req.user!.uid);
  return res.json({ success: true, result });
});

// Retoma o CI ou o preview sem reiniciar a geracao de codigo.
selfEvolutionRouter.post(
  '/candidates/:id/resume',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const parsed = candidateIdSchema.safeParse(req.params);

    if (!parsed.success) {
      return res.status(400).json({ error: 'ID de candidato invalido.' });
    }

    const candidateId = parsed.data.id;
    const candidate = await ImprovementPlannerService.getCandidateById(candidateId);

    if (!candidate) {
      return res.status(404).json({ error: 'Candidato nao encontrado.' });
    }

    if (candidate.state !== 'ci_pending' && candidate.state !== 'ci_passed') {
      return res.status(409).json({
        error: `Retomada indisponivel para o estado ${candidate.state}.`,
      });
    }

    const result = await SelfEvolutionOrchestrator.processCandidateLifecycle(
      candidateId,
      req.user!.uid
    );

    return res.json({ success: true, result });
  }
);

// POST /api/admin/self-evolution/releases/:id/approve
selfEvolutionRouter.post('/releases/:id/approve', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const paramVal = candidateIdSchema.safeParse(req.params);
  if (!paramVal.success) {
    return res.status(400).json({ error: 'ID de candidato/release inválido.' });
  }

  const result = await SelfEvolutionOrchestrator.approveRelease(paramVal.data.id, req.user!.uid);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  return res.json(result);
});

// POST /api/admin/self-evolution/releases/:id/rollback
selfEvolutionRouter.post('/releases/:id/rollback', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const paramVal = candidateIdSchema.safeParse(req.params);
  if (!paramVal.success) {
    return res.status(400).json({ error: 'ID de candidato/release inválido.' });
  }

  const bodyVal = rollbackBodySchema.safeParse(req.body || {});
  if (!bodyVal.success) {
    return res.status(400).json({ error: 'Corpo da requisição inválido para rollback.' });
  }

  const reason = bodyVal.data.reason || 'Rollback solicitado pelo administrador';
  const result = await SelfEvolutionOrchestrator.executeEmergencyRollback(paramVal.data.id, req.user!.uid, reason);
  return res.json(result);
});

// GET /api/admin/self-evolution/evaluations
selfEvolutionRouter.get('/evaluations', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res) => {
  const evaluations = await EvaluationEngine.listResults();
  return res.json({
    evaluations,
    executionEndpoint: '/api/admin/ai/evaluations/run',
    readOnly: true,
  });
});

// GET /api/admin/self-evolution/budget
selfEvolutionRouter.get('/budget', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res) => {
  const budget = await BudgetService.getBudgetStatus();
  return res.json({ budget });
});

// GET /api/admin/self-evolution/audit
selfEvolutionRouter.get('/audit', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res) => {
  const logs = await AuditService.getAuditLogs();
  return res.json({ logs });
});

// POST /api/admin/self-evolution/emergency-stop
selfEvolutionRouter.post(
  '/emergency-stop',
  requireAuth,
  requireAdmin,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    const bodyVal =
      emergencyStopSchema.safeParse(
        req.body || {}
      );

    if (!bodyVal.success) {
      return res.status(400).json({
        error:
          'Corpo da requisição inválido para parada emergencial.'
      });
    }

    const reason =
      bodyVal.data.reason ||
      'Interrupção de emergência acionada pelo painel administrativo.';

    if (!isFirebaseAdminConfigured()) {
      SelfEvolutionPolicyEngine.setSystemEnabled(
        false
      );

      return res.status(503).json({
        success: false,
        error:
          'A instância local foi interrompida, mas a parada global não pôde ser confirmada porque o Firebase Admin não está configurado.'
      });
    }

    try {
      await adminDb
        .collection('self_evolution_config')
        .doc('system')
        .set(
          {
            SELF_EVOLUTION_ENABLED: false,
            stoppedBy: req.user!.uid,
            stoppedAt:
              new Date().toISOString(),
            reason
          },
          { merge: true }
        );
    } catch (error) {
      console.error(
        'Erro ao salvar estado de parada de emergência no Firestore:',
        error
      );

      SelfEvolutionPolicyEngine.setSystemEnabled(
        false
      );

      return res.status(503).json({
        success: false,
        error:
          'A instância local foi interrompida, mas não foi possível confirmar a parada global no Firestore.'
      });
    }

    SelfEvolutionPolicyEngine.setSystemEnabled(
      false
    );

    await AuditService.logEvent({
      actor: req.user!.uid,
      action: 'emergency_stop',
      resource: 'self_evolution_system',
      previousState: {
        SELF_EVOLUTION_ENABLED: true
      },
      newState: {
        SELF_EVOLUTION_ENABLED: false
      },
      riskLevel: 'R3',
      result: 'success',
      reason,
      correlationId:
        (req as any).correlationId
    });

    return res.json({
      success: true,
      message:
        'Parada de emergência persistida no Firestore e aplicada globalmente.'
    });
  }
);
