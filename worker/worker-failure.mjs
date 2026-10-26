function redact(value) {
  let text = String(value || '');
  for (const [name, secret] of Object.entries(process.env)) {
    if (/(?:TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY)/i.test(name) && secret && secret.length >= 4) {
      text = text.split(secret).join('[REDACTED_SECRET]');
    }
  }
  return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED_SECRET]')
    .replace(/\b(?:AIzaSy[\w-]{20,}|(?:ghp|github_pat|vcp|vercel)_[\w-]{12,})/g, '[REDACTED_SECRET]');
}

export function safeDiagnosticText(value, limit = 1800) {
  return redact(value).replace(/[\r\n]+/g, ' ').slice(-limit);
}

export function safeSourceText(value, limit) {
  return redact(value).slice(0, limit);
}

export function compilerDiagnosticLines(stdout, stderr) {
  const text = redact(`${stdout || ''}\n${stderr || ''}`).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  return [...new Set(text.split(/\r?\n/).filter(line => /error TS\d+:/i.test(line)))]
    .slice(0, 20).map(line => line.slice(0, 1000));
}

export function commandDiagnosticExcerpt(value) {
  const text = redact(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex(line => /Error:|TimeoutError|EACCES|ENOSPC|Executable doesn't exist|Cannot find module|error TS\d+/i.test(line));
  return first < 0 ? safeDiagnosticText(text)
    : lines.slice(Math.max(0, first - 1), first + 9).join(' ').slice(0, 1800);
}

function failureDetail(failure, error) {
  const stdout = safeDiagnosticText(failure?.stdoutTail || error?.stdoutTail || '');
  const stderr = safeDiagnosticText(failure?.stderrTail || error?.stderrTail || '');
  if (!stdout || !stderr) return stdout || stderr;
  return `stdout: ${stdout.slice(0, 1100)} | stderr: ${stderr.slice(0, 600)}`;
}

export function workerFailurePayload({ body, stage, error, commands = [], repairCycle = null }) {
  const lastFailure = repairCycle?.attempts?.at(-1)?.failure;
  return {
    schemaVersion: 'engineering-sandbox-failure-v1',
    candidateId: body?.candidateId, requestNonce: body?.requestNonce,
    issuedAt: new Date().toISOString(), stage: safeDiagnosticText(lastFailure?.stage || stage, 80),
    error: safeDiagnosticText(error?.message || error || 'worker_failed'),
    detail: failureDetail(lastFailure, error) || safeDiagnosticText(lastFailure?.summary || ''),
    providerStatus: Number.isInteger(lastFailure?.providerStatus) ? lastFailure.providerStatus : Number.isInteger(error?.status) ? error.status : null,
    commands: commands.slice(-12),
    attempts: Array.isArray(repairCycle?.attempts) ? repairCycle.attempts.map(a => ({
      attempt: a.attempt, passed: a.passed,
      failure: a.failure ? { stage: safeDiagnosticText(a.failure.stage, 80), exitCode: a.failure.exitCode,
        summary: safeDiagnosticText(a.failure.summary, 400) } : null,
    })) : [],
  };
}
