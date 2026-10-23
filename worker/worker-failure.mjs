export function safeDiagnosticText(value, limit = 1800) {
  let text = String(value || '');
  for (const [name, secret] of Object.entries(process.env)) {
    if (/(?:TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY)/i.test(name) && secret && secret.length >= 4) {
      text = text.split(secret).join('[REDACTED_SECRET]');
    }
  }
  return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED_SECRET]')
    .replace(/\b(?:AIzaSy[\w-]{20,}|(?:ghp|github_pat|vcp|vercel)_[\w-]{12,})/g, '[REDACTED_SECRET]')
    .replace(/[\r\n]+/g, ' ').slice(-limit);
}

export function workerFailurePayload({ body, stage, error, commands = [], repairCycle = null }) {
  const lastFailure = repairCycle?.attempts?.at(-1)?.failure;
  return {
    schemaVersion: 'engineering-sandbox-failure-v1',
    candidateId: body?.candidateId, requestNonce: body?.requestNonce,
    issuedAt: new Date().toISOString(), stage: safeDiagnosticText(lastFailure?.stage || stage, 80),
    error: safeDiagnosticText(error?.message || error || 'worker_failed'),
    detail: safeDiagnosticText(lastFailure?.stderrTail || lastFailure?.stdoutTail || error?.stderrTail || error?.stdoutTail || ''),
    providerStatus: Number.isInteger(error?.status) ? error.status : null,
    commands: commands.slice(-12),
    attempts: Array.isArray(repairCycle?.attempts) ? repairCycle.attempts.map(a => ({
      attempt: a.attempt, passed: a.passed,
      failure: a.failure ? { stage: safeDiagnosticText(a.failure.stage, 80), exitCode: a.failure.exitCode,
        summary: safeDiagnosticText(a.failure.summary, 400) } : null,
    })) : [],
  };
}
