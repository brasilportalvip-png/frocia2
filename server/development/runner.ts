import { randomUUID } from 'node:crypto';
import { db, getBlob, putBlob, type DevelopmentScope } from './persistence.js';
import { DevelopmentError, LIMITS, readArchive, writeArchive, sourceManifest, sha256 } from './archive.js';
import { developProject, DEVELOPMENT_INSTRUCTION } from './agent.js';
import { DockerProjectSandbox } from './dockerSandbox.js';
import { portablePreview } from './preview.js';
import { GeminiProvider } from '../ai/providers/geminiProvider.js';
import { CostService } from '../ai/costService.js';
import { CreditWalletService } from '../services/creditWalletService.js';
import { RedactionService } from '../selfEvolution/redactionService.js';
import { projectDiff } from './gitDiff.js';

export async function runDevelopmentJob(jobId: string, runId: string) {
  if (!/^devjob-[a-f0-9]{40}$/.test(jobId) || !/^\d+$/.test(runId)) throw new DevelopmentError('invalid_development_run', 'Identificador do executor inválido.');
  const ref = db().collection('development_jobs').doc(jobId), lease = randomUUID(), started = Date.now();
  const claimed = await db().runTransaction(async tx => {
    const snap = await tx.get(ref), job = snap.data();
    if (!job || ['ready', 'cancelled', 'validated'].includes(job.status)) return null;
    if (job.leaseUntil > Date.now()) return null;
    tx.set(ref, { status: 'running', lease, leaseUntil: Date.now() + 120_000, runId,
      runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY || 'brasilportalvip-png/frocia2'}/actions/runs/${runId}`, updatedAt: new Date().toISOString() }, { merge: true });
    return job;
  });
  if (!claimed) return { claimed: false };
  const scope: DevelopmentScope = { userId: claimed.userId, tenantId: claimed.tenantId };
  const workspaceRef = db().collection('development_workspaces').doc(claimed.workspaceId);
  const abort = new AbortController(); let controlError: DevelopmentError | undefined, credits = Number(claimed.consumedCredits || 0);
  const checkControl = async () => {
    const [jobSnap, wsSnap, systemSnap] = await Promise.all([ref.get(), workspaceRef.get(), db().collection('development_config').doc('system').get()]);
    const job = jobSnap.data(), ws = wsSnap.data();
    if (!job || job.lease !== lease || ws?.userId !== scope.userId || ws.tenantId !== scope.tenantId) throw new DevelopmentError('development_lease_lost', 'A execução perdeu a exclusividade do workspace.');
    if (job.cancelRequested) throw new DevelopmentError('job_cancelled', 'Execução cancelada pelo proprietário.');
    if (ws.paused || systemSnap.data()?.enabled === false) throw new DevelopmentError('job_paused', 'Execução pausada pelo controle persistente.');
    if (Date.now() - started > LIMITS.jobMs) throw new DevelopmentError('job_time_limit', 'Limite de 30 minutos atingido; estado preservado.');
    await ref.set({ leaseUntil: Date.now() + 120_000 }, { merge: true });
  };
  const heartbeat = setInterval(() => { void checkControl().catch(error => { controlError = error; abort.abort(); }); }, 10_000);
  let settled = false;
  const settle = async () => {
    if (settled || !claimed.reservationId) return;
    if ((await ref.get()).data()?.lease !== lease) return;
    await CreditWalletService.confirmConsumption({ userId: scope.userId, reservationId: claimed.reservationId, amountConsumed: Math.max(0, credits - Number(claimed.reservationBaseCredits || 0)),
      operation: 'project_development', idempotencyKey: `${jobId}:settled:${claimed.reservationId}` }); settled = true;
    await ref.set({ reservationId: null, reservationAttempt: Number(claimed.reservationAttempt || 0) + 1 }, { merge: true });
  };
  try {
    await checkControl();
    if (!claimed.reservationId) throw new DevelopmentError('development_budget_required', 'Não há reserva autorizada para esta execução.');
    if (!await DockerProjectSandbox.available()) throw new DevelopmentError('isolated_executor_unavailable', 'O executor não confirmou Docker. Nenhum código do usuário foi executado.');
    const baseline = readArchive(await getBlob(scope, claimed.baseRevision));
    const files = claimed.workingRevision ? readArchive(await getBlob(scope, claimed.workingRevision)) : new Map([...baseline].map(([path, file]) => [path, { ...file, bytes: file.bytes.slice() }]));
    const sandbox = new DockerProjectSandbox(abort.signal);
    const result = await developProject({ files, baseline, instruction: claimed.instruction, startStep: claimed.steps,
      checkControl: async () => { if (controlError) throw controlError; await checkControl(); },
      checkpoint: async (state, files, detail) => {
        const revision = await putBlob(scope, writeArchive(files)), current = (await ref.get()).data();
        if (current?.lease !== lease) throw new DevelopmentError('development_lease_lost', 'Outra execução assumiu o projeto.');
        await ref.set({ status: state, workingRevision: revision, steps: Number(detail.step || 0), consumedCredits: credits,
          events: [...(current.events || []).slice(-99), { state, at: new Date().toISOString(), ...detail }], updatedAt: new Date().toISOString() }, { merge: true });
      },
      generate: async context => {
        const model = process.env.GEMINI_CODE_MODEL || process.env.GEMINI_DEFAULT_MODEL || 'gemini-3.7-flash';
        const worst = CostService.calculateCreditCost(model, Buffer.byteLength(DEVELOPMENT_INSTRUCTION + context) + 512, 4096);
        if (credits + worst > claimed.authorizedCredits) throw new DevelopmentError('development_credit_limit', 'O orçamento restante não cobre a próxima chamada. O estado foi preservado.');
        const response = await GeminiProvider.generate({ model, systemInstruction: DEVELOPMENT_INSTRUCTION,
          userMessage: RedactionService.redactSensitiveData(context), responseFormat: 'json', maxOutputTokens: 4096, maxRetries: 0, temperature: 0.1, abortSignal: abort.signal });
        credits += CostService.calculateCreditCost(model, response.inputTokens, response.outputTokens);
        if (credits > claimed.authorizedCredits) {
          credits = claimed.authorizedCredits; await ref.set({ consumedCredits: credits, providerUsageOverBudget: true }, { merge: true });
          throw new DevelopmentError('development_credit_limit', 'O provedor excedeu a estimativa. Execução interrompida e cobrança limitada ao valor autorizado.');
        }
        await ref.set({ consumedCredits: credits }, { merge: true });
        try { return JSON.parse(response.text); } catch { throw new DevelopmentError('development_agent_json_invalid', 'Resposta do agente inválida. Nenhum texto foi aplicado como edição.'); }
      },
      validate: async source => {
        const receipt = await sandbox.validate(source);
        for (const command of receipt.commands) {
          command.rawStdoutSha256 = command.stdoutSha256; command.rawStderrSha256 = command.stderrSha256;
          command.stdout = RedactionService.redactSensitiveData(command.stdout); command.stderr = RedactionService.redactSensitiveData(command.stderr);
          command.stdoutSha256 = sha256(command.stdout); command.stderrSha256 = sha256(command.stderr);
        }
        const logs = await putBlob(scope, Buffer.from(JSON.stringify({ ...receipt, preview: undefined })));
        await ref.set({ commandLog: logs, checks: receipt.commands.map(({ command, exitCode, startedAt, durationMs, stdoutSha256, stderrSha256 }) => ({ command, exitCode, startedAt, durationMs, stdoutSha256, stderrSha256 })), isolation: receipt.isolation }, { merge: true });
        return receipt;
      },
    });
    await checkControl();
    const revision = await putBlob(scope, writeArchive(result.files)), manifest = sourceManifest(result.files);
    const diffBlob = await putBlob(scope, await projectDiff(baseline, result.files));
    let previewHtml: string | null = null, previewDiagnostic: string | null = null;
    if (result.validation.preview) {
      try { previewHtml = await putBlob(scope, Buffer.from(await portablePreview(result.validation.preview))); }
      catch (error) { previewDiagnostic = error instanceof DevelopmentError ? error.message : 'O framework exige adaptador de prévia; ZIP e testes estão disponíveis.'; }
    } else previewDiagnostic = 'Build sem saída estática em dist/index.html. A prévia precisa de um adaptador de execução.';
    await db().runTransaction(async tx => {
      const current = await tx.get(ref), workspace = await tx.get(workspaceRef);
      if (current.data()?.lease !== lease || workspace.data()?.revision !== claimed.baseRevision) throw new DevelopmentError('workspace_revision_conflict', 'A versão do projeto mudou durante a execução. Nenhuma versão foi sobrescrita.');
      tx.set(workspaceRef, { revision, digest: manifest.digest, fileCount: manifest.fileCount, bytes: manifest.bytes, status: previewHtml ? 'ready' : 'validated', activeJobId: null, updatedAt: new Date().toISOString() }, { merge: true });
      tx.set(ref, { status: previewHtml ? 'ready' : 'validated', revision, diffBlob, previewHtml, previewDiagnostic, changes: result.changes,
        summary: result.summary, consumedCredits: credits, leaseUntil: 0, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
    });
    await settle(); return { claimed: true, status: previewHtml ? 'ready' : 'validated', digest: manifest.digest };
  } catch (error) {
    const failure = controlError || error, code = failure instanceof DevelopmentError ? failure.code : 'development_failed';
    const status = code === 'job_cancelled' ? 'cancelled' : code === 'job_paused' ? 'paused' : 'blocked';
    const retained = await db().runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.data()?.lease !== lease) return false;
      tx.set(ref, { status, diagnostic: failure instanceof DevelopmentError ? failure.message : 'O executor encontrou uma falha; logs e workspace foram preservados.',
        errorCode: code, leaseUntil: 0, dispatchAccepted: false, consumedCredits: credits, updatedAt: new Date().toISOString() }, { merge: true }); return true;
    });
    if (!retained) return { claimed: false, status: 'lease_lost' };
    if (status === 'cancelled') await workspaceRef.set({ activeJobId: null }, { merge: true });
    await settle(); return { claimed: true, status, code };
  } finally { clearInterval(heartbeat); abort.abort(); }
}
