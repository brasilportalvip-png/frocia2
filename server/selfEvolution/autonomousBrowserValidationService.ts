import crypto from 'node:crypto';

export const REQUIRED_BROWSER_SCENARIOS = [
  'public-navigation', 'direct-route-refresh', 'mobile-responsive',
  'tablet-responsive', 'desktop-responsive', 'keyboard-accessibility',
  'automated-accessibility', 'broken-links', 'console-errors',
  'network-errors', 'authenticated-session', 'expired-session',
] as const;

export type BrowserScenarioId = (typeof REQUIRED_BROWSER_SCENARIOS)[number];

export interface BrowserScenarioEvidence {
  id: BrowserScenarioId;
  status: 'passed' | 'failed' | 'external_blocker';
  durationMs: number;
  screenshotSha256?: string;
  traceSha256: string;
  details: string;
}

export interface AutonomousBrowserReport {
  schemaVersion: 'browser-validation-v1';
  requestNonce: string;
  sandboxId: string;
  commitSha: string;
  previewUrl: string;
  startedAt: string;
  completedAt: string;
  scenarios: BrowserScenarioEvidence[];
  consoleErrors: string[];
  failedRequests: string[];
  passed: boolean;
}

function sha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export class AutonomousBrowserValidationService {
  static async validate(input: {
    previewUrl: string;
    commitSha: string;
    candidateId: string;
  }): Promise<AutonomousBrowserReport> {
    const workerUrl = process.env.SELF_EVOLUTION_WORKER_URL?.trim().replace(/\/+$/, '');
    const token = process.env.SELF_EVOLUTION_WORKER_TOKEN?.trim();
    const signingSecret = process.env.SELF_EVOLUTION_WORKER_SIGNING_SECRET?.trim();
    if (!workerUrl || !token || !signingSecret || signingSecret.length < 32) {
      throw new Error('browser_worker_not_configured');
    }
    const preview = new URL(input.previewUrl);
    if (preview.protocol !== 'https:' || !/^[a-f0-9]{40}$/i.test(input.commitSha)) {
      throw new Error('invalid_browser_validation_target');
    }
    const nonce = crypto.randomBytes(24).toString('hex');
    const response = await fetch(`${workerUrl}/api/worker/browser-validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        schemaVersion: 'browser-validation-v1', requestNonce: nonce,
        previewUrl: preview.toString(), commitSha: input.commitSha,
        candidateId: input.candidateId, requiredScenarios: REQUIRED_BROWSER_SCENARIOS,
      }),
      signal: AbortSignal.timeout(5 * 60_000),
    });
    if (!response.ok) throw new Error(`browser_worker_http_${response.status}`);
    const raw = await response.text();
    const supplied = response.headers.get('x-frocia-worker-signature')?.match(/^sha256=([a-f0-9]{64})$/i)?.[1];
    const expected = crypto.createHmac('sha256', signingSecret).update(raw).digest('hex');
    if (!supplied || !crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))) {
      throw new Error('browser_worker_signature_invalid');
    }
    const report = JSON.parse(raw) as AutonomousBrowserReport;
    if (
      report.schemaVersion !== 'browser-validation-v1' || report.requestNonce !== nonce ||
      report.commitSha !== input.commitSha || report.previewUrl !== preview.toString() ||
      !Array.isArray(report.scenarios) || !Array.isArray(report.consoleErrors) ||
      !Array.isArray(report.failedRequests)
    ) throw new Error('browser_report_invalid');
    const ids = new Set<BrowserScenarioId>();
    for (const scenario of report.scenarios) {
      if (!REQUIRED_BROWSER_SCENARIOS.includes(scenario.id) || ids.has(scenario.id) ||
        !sha(scenario.traceSha256) || (scenario.screenshotSha256 && !sha(scenario.screenshotSha256)) ||
        !Number.isSafeInteger(scenario.durationMs) || scenario.durationMs < 0) {
        throw new Error('browser_scenario_evidence_invalid');
      }
      ids.add(scenario.id);
    }
    if (REQUIRED_BROWSER_SCENARIOS.some((id) => !ids.has(id))) throw new Error('browser_scenarios_missing');
    const computedPassed = report.scenarios.every((scenario) => scenario.status === 'passed') &&
      report.consoleErrors.length === 0 && report.failedRequests.length === 0;
    if (report.passed !== computedPassed) throw new Error('browser_report_conclusion_invalid');
    return report;
  }
}
