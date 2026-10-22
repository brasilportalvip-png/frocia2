import { randomUUID } from 'node:crypto';

const RESUMABLE_STATES = new Set([
  'detected',
  'triaged',
  'awaiting_work_approval',
  'approved_for_work',
  'pull_request_opened',
  'ci_pending',
  'ci_passed',
  'preview_deployed',
  'awaiting_release_approval',
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

  if (!isFirebaseAdminConfigured()) {
    throw new Error('Firebase Admin nao configurado.');
  }

  if (!(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted())) {
    console.log('[self-evolution-runner] Autoevolucao desativada.');
    return;
  }

  const snapshot = await adminDb
    .collection('self_evolution_candidates')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const candidate = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => RESUMABLE_STATES.has(String(item.state)))
    .sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt))
    )[0];

   let candidateId = candidate?.id;

  if (!candidateId) {
    const discovery = await OperationalAutoDiscoveryService.discoverOne();

    console.log('[self-evolution-runner] Descoberta:', discovery.status);

    if (discovery.status === 'created' && discovery.candidateId) {
      candidateId = discovery.candidateId;
    } else {
      const innovation = await InnovationDiscoveryService.discoverOne();
      console.log('[self-evolution-runner] Inovacao:', innovation.agentId, innovation.status);
      if (innovation.status !== 'created' || !innovation.candidateId) return;
      candidateId = innovation.candidateId;
    }
  }

  const result = await SelfEvolutionOrchestrator.processCandidateLifecycle(
    candidateId,
    `external-runner-${randomUUID()}`
  );

   console.log('[self-evolution-runner] Resultado:', {
    candidateId,
    state: result.state,
    message: result.message,
  });

  if (['failed', 'tests_failed', 'ci_failed'].includes(result.state)) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(
    '[self-evolution-runner] Erro:',
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
});