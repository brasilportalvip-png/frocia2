import { Router } from 'express';
import { z } from 'zod';
import { adminDb } from '../lib/firebaseAdmin.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { AuthenticatedRequest } from '../types.js';
import { SelfEvolutionPolicyEngine } from '../selfEvolution/selfEvolutionPolicyEngine.js';
import { ImprovementPlannerService } from '../selfEvolution/improvementPlannerService.js';
import { SelfEvolutionOrchestrator } from '../selfEvolution/selfEvolutionOrchestrator.js';
import { EvaluationEngine } from '../selfEvolution/evaluationEngine.js';
import { BudgetService } from '../selfEvolution/budgetService.js';
import { AuditService } from '../selfEvolution/auditService.js';

export const selfEvolutionRouter = Router();

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

// GET /api/admin/self-evolution/status
selfEvolutionRouter.get('/status', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res) => {
  const budget = await BudgetService.getBudgetStatus();
  const candidates = await ImprovementPlannerService.getCandidates();

  return res.json({
    enabled: SelfEvolutionPolicyEngine.isSelfEvolutionEnabled(),
    autonomousProductionDeployAllowed: SelfEvolutionPolicyEngine.isAutonomousProductionDeployAllowed(),
    budget,
    candidatesCount: candidates.length,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/admin/self-evolution/candidates
selfEvolutionRouter.get('/candidates', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res) => {
  const candidates = await ImprovementPlannerService.getCandidates();
  return res.json({ candidates });
});

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
  const golden = EvaluationEngine.runSuite('golden');
  const security = EvaluationEngine.runSuite('security');
  return res.json({ evaluations: [golden, security] });
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
selfEvolutionRouter.post('/emergency-stop', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const bodyVal = emergencyStopSchema.safeParse(req.body || {});
  const reason = bodyVal.success && bodyVal.data.reason ? bodyVal.data.reason : 'Interrupção de emergência acionada pelo painel administrativo.';

  const previousState = process.env.SELF_EVOLUTION_ENABLED ?? 'true';
  process.env.SELF_EVOLUTION_ENABLED = 'false';

  if (adminDb) {
    try {
      await adminDb.collection('self_evolution_config').doc('system').set({
        SELF_EVOLUTION_ENABLED: false,
        stoppedBy: req.user!.uid,
        stoppedAt: new Date().toISOString(),
        reason,
      }, { merge: true });
    } catch (err) {
      console.error('Erro ao salvar estado de parada de emergência no Firestore:', err);
    }
  }

  await AuditService.logEvent({
    actor: req.user!.uid,
    action: 'emergency_stop',
    resource: 'self_evolution_system',
    previousState: { SELF_EVOLUTION_ENABLED: previousState },
    newState: { SELF_EVOLUTION_ENABLED: 'false' },
    riskLevel: 'R3',
    result: 'success',
    reason,
    correlationId: (req as any).correlationId,
  });

  return res.json({ success: true, message: 'Parada de emergência executada. Sistema de autoevolução desativado.' });
});

