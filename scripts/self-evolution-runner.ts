import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

async function recordOutcome(outcome: Record<string, unknown>, requiresResume: boolean): Promise<void> {
  const json = JSON.stringify({ ...outcome, requiresResume }, null, 2);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `requires_resume=${requiresResume}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## Resultado dos agentes\n\n\`\`\`json\n${json}\n\`\`\`\n`);
  }
  console.log('[self-evolution-runner] Resumo:', json);
  const { adminDb, isFirebaseAdminConfigured } = await import('../server/lib/firebaseAdmin.js');
  if (isFirebaseAdminConfigured()) {
    const record = { ...outcome, requiresResume, recordedAt: new Date().toISOString(),
      autonomousProductionDeployEnabled: process.env.AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED === 'true',
      fullRepositoryAccessEnabled: process.env.SELF_EVOLUTION_FULL_REPOSITORY_ACCESS === 'true' };
    await adminDb.collection('self_evolution_config').doc('last_runner_outcome').set(record);
    if (typeof outcome.candidateId === 'string') await adminDb.collection('self_evolution_candidate_outcomes').doc(outcome.candidateId).set(record);
  }
}

const RESUMABLE_STATES = new Set([
  'detected',
  'triaged',
  'awaiting_work_approval',
  'approved_for_work',
  'agent_running',
  'tests_passed',
  'patch_created',
  'pull_request_opened',
  'ci_pending',
  'ci_passed',
  'preview_deployed',
  'awaiting_release_approval',
  'approved_for_release',
  'monitoring',
]);

async function main(): Promise<void> {
  if (!process.argv.includes('--run')) {
    console.log('[self-evolution-runner] Arquivo carregado com sucesso.');
    console.log('Modo seguro: nenhuma tarefa executada.');
    return;
  }

  if (process.env.SELF_EVOLUTION_RUNNER_ENABLED !== 'true') {
    throw new Error('Executor externo ainda nao habilitado.');
  }

  if (
    !process.env.SELF_EVOLUTION_WORKER_URL ||
    !process.env.SELF_EVOLUTION_WORKER_TOKEN ||
    !process.env.SELF_EVOLUTION_WORKER_SIGNING_SECRET
  ) {
    throw new Error('Worker externo ainda nao configurado.');
  }

  const { adminDb, isFirebaseAdminConfigured } =
    await import('../server/lib/firebaseAdmin.js');
  const { SelfEvolutionPolicyEngine } =
    await import('../server/selfEvolution/selfEvolutionPolicyEngine.js');
  const { OperationalAutoDiscoveryService } =
    await import('../server/selfEvolution/operationalAutoDiscoveryService.js');
  const { InnovationDiscoveryService } =
    await import('../server/selfEvolution/innovationDiscoveryService.js');
  const { SelfEvolutionOrchestrator } =
    await import('../server/selfEvolution/selfEvolutionOrchestrator.js');
  const { ProductionSiteAuditDiscoveryService } =
    await import('../server/selfEvolution/productionSiteAuditDiscoveryService.js');
  const { GithubAutomationService } =
    await import('../server/selfEvolution/githubAutomationService.js');
  const { PreviewDeploymentService } =
    await import('../server/selfEvolution/previewDeploymentService.js');
  const { SelfSiteKnowledgeService } =
    await import('../server/selfEvolution/selfSiteKnowledgeService.js');
  const { WorkerFailureRecoveryService } =
    await import('../server/selfEvolution/workerFailureRecoveryService.js');

  if (!isFirebaseAdminConfigured()) {
    throw new Error('Firebase Admin nao configurado.');
  }

  if (!(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted())) {
    console.log('[self-evolution-runner] Autoevolucao desativada.');
    console.warn('::warning::Autoevolucao desativada na configuracao persistente.');
    await recordOutcome({ status: 'disabled' }, false);
    return;
  }

  const knowledge = await SelfSiteKnowledgeService.refresh();
  console.log('[self-evolution-runner] Conhecimento do projeto:', {
    commitSha: knowledge.commitSha, files: knowledge.filesCount, sources: knowledge.sourceFilesCount,
    routes: knowledge.routes.length, views: knowledge.navigation.length, agents: knowledge.agents.length,
    incompleteFiles: knowledge.incompleteFiles,
  });
  // A auditoria real precede a fila e as novidades externas, mesmo com tarefas pendentes.
  const siteAudit = await ProductionSiteAuditDiscoveryService.discoverOne(new Date(), {
    force: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch',
    knowledge,
  });
  console.log('[self-evolution-runner] Auditoria do site:', siteAudit);
  if (siteAudit.status === 'not_configured') {
    throw new Error(`Auditoria do site nao configurada: ${siteAudit.limitations?.join(' ')}`);
  }
  if (siteAudit.coverageComplete === false || siteAudit.status === 'partial') {
    console.warn('::warning::A auditoria do site foi parcial. Consulte as limitacoes; isto nao comprova ausencia de erros.');
  }

  const snapshot = await adminDb
    .collection('self_evolution_candidates')
    .where('state', 'in', [...RESUMABLE_STATES])
    .get();

  const candidate = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => RESUMABLE_STATES.has(String(item.state)))
    .sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt))
    )[0];

  let candidateId = candidate?.id;

  if (!candidateId) {
    candidateId = await WorkerFailureRecoveryService.recoverNext({
      sourceSha: knowledge.commitSha,
      runId: `${process.env.GITHUB_RUN_ID || randomUUID()}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`,
      manual: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch', now: new Date(),
    });
    if (candidateId) console.log('[self-evolution-runner] Retomando tarefa apos falha do worker:', candidateId);
  }

  if (!candidateId) {
    if ((siteAudit.findings || 0) > 0) {
      console.warn('::warning::Ha falhas reais no site, mas nenhuma tarefa retomavel. Confira candidatos que falharam, rejeicoes e bloqueios.');
      await recordOutcome({ status: 'audit_requires_attention', siteAudit,
        message: 'Falhas pendentes; a retomada pode estar limitada para evitar cobrancas repetidas. Consulte o ultimo diagnostico do candidato.' }, true);
      return;
    }
    const discovery = await OperationalAutoDiscoveryService.discoverOne();

    console.log('[self-evolution-runner] Descoberta:', discovery);

    if (discovery.status === 'created' && discovery.candidateId) {
      candidateId = discovery.candidateId;
    } else {
      const innovation = await InnovationDiscoveryService.discoverOne();
      console.log('[self-evolution-runner] Inovacao:', innovation.agentId, innovation.status);
      if (innovation.status !== 'created' || !innovation.candidateId) {
        await recordOutcome({ status: 'idle', siteAudit, discovery, innovation }, Boolean(siteAudit.requiresResume));
        return;
      }
      candidateId = innovation.candidateId;
    }
  }

  // Confirmar as integracoes antes de cobrar a geracao de um patch.
  const githubAccess = await GithubAutomationService.verifyRepositoryAccess();
  if (!githubAccess.success) throw new Error(githubAccess.message);
  // Um site doente precisa continuar elegivel para reparo; aqui so se verifica acesso a API.
  const vercelAccess = await PreviewDeploymentService.verifyProjectAccess();
  if (vercelAccess.status === 'not_configured' || vercelAccess.status === 'failed') {
    throw new Error(`Vercel indisponivel no executor externo: ${vercelAccess.errorMessage}`);
  }
  console.log('[self-evolution-runner] Integracoes:', {
    github: githubAccess.message, vercel: vercelAccess.status,
    autonomousProductionDeploy: SelfEvolutionPolicyEngine.isAutonomousProductionDeployAllowed(),
  });
  await adminDb.collection('self_evolution_config').doc('runner_integrations').set({
    scope: 'external_runner', checkedAt: new Date().toISOString(), commitSha: knowledge.commitSha,
    runId: process.env.GITHUB_RUN_ID || null,
    github: { contentsWriteVerified: true, message: githubAccess.message },
    vercel: { projectAccessVerified: true, status: vercelAccess.status },
    autonomousProductionDeployAllowed: SelfEvolutionPolicyEngine.isAutonomousProductionDeployAllowed(),
    note: 'Prova dos acessos desta rodada. Nao comprova correcao nem publicacao; a credencial do chat e verificada separadamente.',
  });

  const result = await SelfEvolutionOrchestrator.processCandidateLifecycle(
    candidateId,
    `external-runner-${randomUUID()}`
  );

   console.log('[self-evolution-runner] Resultado:', {
    candidateId,
    state: result.state,
    message: result.message,
  });

  const moreCandidates = snapshot.docs.some(doc => doc.id !== candidateId && RESUMABLE_STATES.has(String(doc.data().state)));
  await recordOutcome({ candidateId, siteAudit, state: result.state, message: result.message },
    Boolean(siteAudit.requiresResume) || moreCandidates || RESUMABLE_STATES.has(result.state) || result.state === 'tests_failed');

  if (['failed', 'tests_failed', 'ci_failed'].includes(result.state)) {
    process.exitCode = 1;
  }
}

void main().catch(async (error: unknown) => {
  console.error(
    '[self-evolution-runner] Erro:',
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
  const { RedactionService } = await import('../server/selfEvolution/redactionService.js');
  try { await recordOutcome({ status: 'failed', message: RedactionService.redactSensitiveData(error instanceof Error ? error.message : String(error)) }, true); }
  catch { console.warn('::warning::Nao foi possivel persistir o diagnostico da falha do executor.'); }
});
