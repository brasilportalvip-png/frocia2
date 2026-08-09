import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { AuthenticatedRequest } from '../types.js';
import { SelfEvolutionPolicyEngine } from '../selfEvolution/selfEvolutionPolicyEngine.js';
import { ImprovementPlannerService } from '../selfEvolution/improvementPlannerService.js';
import { SelfEvolutionOrchestrator } from '../selfEvolution/selfEvolutionOrchestrator.js';
import { EvaluationEngine } from '../selfEvolution/evaluationEngine.js';
import { BudgetService } from '../selfEvolution/budgetService.js';
import { AuditService } from '../selfEvolution/auditService.js';
import { FeedbackCollectorService } from '../selfEvolution/feedbackCollectorService.js';

export const selfEvolutionRouter = Router();

// GET /api/admin/self-evolution/status
selfEvolutionRouter.get('/status', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res) => {
  return res.json({
    enabled: SelfEvolutionPolicyEngine.isSelfEvolutionEnabled(),
    autonomousProductionDeployAllowed: SelfEvolutionPolicyEngine.isAutonomousProductionDeployAllowed(),
    budget: BudgetService.getBudgetStatus(),
    candidatesCount: ImprovementPlannerService.getCandidates().length,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/admin/self-evolution/candidates
selfEvolutionRouter.get('/candidates', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res) => {
  return res.json({ candidates: ImprovementPlannerService.getCandidates() });
});

// GET /api/admin/self-evolution/candidates/:id
selfEvolutionRouter.get('/candidates/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const candidate = ImprovementPlannerService.getCandidateById(req.params.id);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidato de melhoria não encontrado.' });
  }
  return res.json({ candidate });
});

// POST /api/admin/self-evolution/candidates/:id/approve-work
selfEvolutionRouter.post('/candidates/:id/approve-work', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const candidateId = req.params.id;
  const candidate = ImprovementPlannerService.getCandidateById(candidateId);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidato não encontrado.' });
  }

  ImprovementPlannerService.updateCandidateState(candidateId, 'approved_for_work');
  AuditService.logEvent({
    actor: req.user!.uid,
    action: 'approve_work',
    resource: candidateId,
    riskLevel: candidate.riskLevel,
    result: 'success',
  });

  const result = await SelfEvolutionOrchestrator.processCandidateLifecycle(candidateId, req.user!.uid);
  return res.json({ success: true, result });
});

// POST /api/admin/self-evolution/releases/:id/approve
selfEvolutionRouter.post('/releases/:id/approve', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const result = SelfEvolutionOrchestrator.approveRelease(req.params.id, req.user!.uid);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  return res.json(result);
});

// POST /api/admin/self-evolution/releases/:id/rollback
selfEvolutionRouter.post('/releases/:id/rollback', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const { reason = 'Rollback solicitado pelo administrador' } = req.body;
  const result = SelfEvolutionOrchestrator.executeEmergencyRollback(req.params.id, req.user!.uid, reason);
  return res.json(result);
});

// GET /api/admin/self-evolution/evaluations
selfEvolutionRouter.get('/evaluations', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res) => {
  const golden = EvaluationEngine.runSuite('golden');
  const security = EvaluationEngine.runSuite('security');
  return res.json({ evaluations: [golden, security] });
});

// GET /api/admin/self-evolution/budget
selfEvolutionRouter.get('/budget', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res) => {
  return res.json({ budget: BudgetService.getBudgetStatus() });
});

// GET /api/admin/self-evolution/audit
selfEvolutionRouter.get('/audit', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res) => {
  return res.json({ logs: AuditService.getAuditLogs() });
});

// POST /api/admin/self-evolution/emergency-stop
selfEvolutionRouter.post('/emergency-stop', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  process.env.SELF_EVOLUTION_ENABLED = 'false';
  AuditService.logEvent({
    actor: req.user!.uid,
    action: 'emergency_stop',
    resource: 'self_evolution_system',
    riskLevel: 'R3',
    result: 'success',
    reason: 'Interrupção de emergência acionada pelo painel administrativo.',
  });
  return res.json({ success: true, message: 'Parada de emergência executada. Sistema de autoevolução desativado.' });
});
