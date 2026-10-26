import crypto from 'node:crypto';
import { safeDiagnosticText } from './worker-failure.mjs';

function safeFailure(value) {
  return {
    stage: String(value?.stage || 'unknown').slice(0, 80),
    exitCode: Number.isSafeInteger(value?.exitCode) ? value.exitCode : 1,
    stdoutSha256: String(value?.stdoutSha256 || '').slice(0, 64),
    stderrSha256: String(value?.stderrSha256 || '').slice(0, 64),
    summary: safeDiagnosticText(value?.summary || 'certification failed', 800),
    stdoutTail: safeDiagnosticText(value?.stdoutTail || ''),
    stderrTail: safeDiagnosticText(value?.stderrTail || ''),
    compilerDiagnostics: Array.isArray(value?.compilerDiagnostics)
      ? value.compilerDiagnostics.slice(0, 20).map(line => safeDiagnosticText(line, 1000)) : [],
    ...(Number.isInteger(value?.providerStatus) ? { providerStatus: value.providerStatus } : {}),
  };
}

const hasRegressionTest = patch => patch?.files?.some(file =>
  /^tests\/.+\.test\.(?:ts|tsx)$/.test(file.path || '') && typeof file.content === 'string' && file.content.trim());

export async function executeAutonomousRepairCycle(options) {
  const configuredAttempts = Number(options.maximumAttempts ?? 3);
  const maximumAttempts = Number.isFinite(configuredAttempts) ? Math.min(Math.max(Math.trunc(configuredAttempts), 1), 5) : 3;
  const attempts = [];
  let feedback = null;
  let previousPatch = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    await options.restoreBaseline();
    let patch;
    try { patch = await options.generate({ attempt, feedback, ...(previousPatch ? { previousPatch } : {}) }); }
    catch (error) {
      const failure = safeFailure({ stage: 'generation', summary: error instanceof Error ? error.message : 'generation_failed',
        providerStatus: error?.status });
      attempts.push({ attempt, patchDigest: null, passed: false, failure, evidenceRefs: [] });
      feedback = failure;
      if (error?.retryable !== true) break;
      continue;
    }
    if (patch?.files?.length === 0 && typeof patch.noChangeReason === 'string') {
      await options.restoreBaseline();
      return { schemaVersion: 'autonomous-repair-cycle-v1', passed: false, noChange: true, reason: patch.noChangeReason,
        selectedAttempt: null, attempts, patch: null, digest: crypto.createHash('sha256').update(JSON.stringify(attempts)).digest('hex') };
    }
    const patchDigest = crypto.createHash('sha256').update(JSON.stringify(patch)).digest('hex');
    const discardedTests = hasRegressionTest(previousPatch) && !hasRegressionTest(patch);
    let result;
    if (discardedTests) {
      result = { passed: false, failure: { stage: 'patch_contract', exitCode: 1,
        summary: 'regression_test_removed: repare o teste reprovado ou forneca um teste de regressao substituto; nao descarte todos os testes para aprovar o patch.' } };
    } else {
      await options.apply(patch);
      result = await options.certify({ attempt, patchDigest });
    }
    const record = {
      attempt, patchDigest, passed: result.passed === true,
      failure: result.passed === true ? null : safeFailure(result.failure),
      evidenceRefs: Array.isArray(result.evidenceRefs) ? result.evidenceRefs.map(String).slice(0, 30) : [],
    };
    attempts.push(record);
    if (record.passed) {
      return {
        schemaVersion: 'autonomous-repair-cycle-v1', passed: true, selectedAttempt: attempt,
        attempts, patch, digest: crypto.createHash('sha256').update(JSON.stringify(attempts)).digest('hex'),
      };
    }
    feedback = record.failure;
    // The workspace is restored before generation. Keep the rejected files in
    // memory so the model can repair its own patch rather than guess it again.
    if (!discardedTests) previousPatch = Array.isArray(patch?.files) ? structuredClone(patch) : null;
  }
  await options.restoreBaseline();
  return {
    schemaVersion: 'autonomous-repair-cycle-v1', passed: false, selectedAttempt: null,
    attempts, patch: null, digest: crypto.createHash('sha256').update(JSON.stringify(attempts)).digest('hex'),
  };
}
