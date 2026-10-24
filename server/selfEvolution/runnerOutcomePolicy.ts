/** A failed delivery must never become the successful daily completion marker. */
export function runnerOutcomePolicy(outcome: Record<string, unknown>, requiresResume: boolean) {
  const state = String(outcome.state || outcome.status || 'unknown');
  const failed = ['failed', 'tests_failed', 'ci_failed', 'preview_failed', 'audit_requires_attention', 'preview_requires_attention'].includes(state);
  const audit = outcome.siteAudit as { findings?: number; coverageComplete?: boolean } | undefined;
  const complete = !failed && !requiresResume && (state === 'accepted' ||
    (state === 'idle' && !audit?.findings && audit?.coverageComplete !== false));
  return { failed, dailyComplete: complete, requiresResume };
}
