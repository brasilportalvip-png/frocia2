import crypto from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelfEvolutionOrchestrator } from '../server/selfEvolution/selfEvolutionOrchestrator.js';
import { ImprovementPlannerService } from '../server/selfEvolution/improvementPlannerService.js';
import { SelfEvolutionPolicyEngine } from '../server/selfEvolution/selfEvolutionPolicyEngine.js';
import { BudgetService } from '../server/selfEvolution/budgetService.js';
import { LockService } from '../server/selfEvolution/lockService.js';
import { InMemoryLockRepository } from '../server/selfEvolution/repositories.js';
import { AuditService } from '../server/selfEvolution/auditService.js';
import { CodeAgentService, DefaultCodeAgentAdapter, type PatchResult } from '../server/selfEvolution/codeAgentService.js';
import { REQUIRED_ENGINEERING_COMMANDS } from '../server/selfEvolution/engineeringSandboxEvidenceService.js';
import { CertifiedPatchCheckpointService } from '../server/selfEvolution/certifiedPatchCheckpointService.js';
import { ContinuousCapabilityEvaluationService, CAPABILITY_CATEGORIES } from '../server/ai/continuousCapabilityEvaluationService.js';
import { SpecialistCommitteeExecutionService } from '../server/selfEvolution/specialistCommitteeExecutionService.js';
import { CommitteeGateService } from '../server/selfEvolution/committeeGateService.js';
import { REQUIRED_BROWSER_SCENARIOS } from '../server/selfEvolution/autonomousBrowserValidationService.js';
import { RollbackService } from '../server/selfEvolution/rollbackService.js';
import type { ImprovementCandidate, CommitteeReview } from '../server/selfEvolution/selfEvolutionTypes.js';

const BASE = 'a'.repeat(40), HEAD = 'b'.repeat(40), MERGE = 'c'.repeat(40), TREE = 'd'.repeat(40);
const SECRET = 'test-signing-secret-'.repeat(3);
const commands = REQUIRED_ENGINEERING_COMMANDS.map(id => ({ id, exitCode: 0,
  command: id === 'install' ? 'npm ci' : id === 'test' ? 'npm test' : id === 'security-audit' ? 'npm audit --omit=dev --audit-level=moderate'
    : id === 'production-integrity' ? 'npm run validate:production-integrity' : id === 'diff-check' ? 'git diff --check'
      : id === 'e2e' ? 'npm run test:e2e' : `npm run ${id}`,
  startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0,
  stdoutSha256: '1'.repeat(64), stderrSha256: '2'.repeat(64) }));

// O worker HTTP e real; Gemini, Firestore, GitHub e Vercel sao fixtures.
// Este teste verifica os contratos entre etapas e nao publica nem usa modelos pagos.
describe('Ciclo integrado com worker HTTP e APIs externas simuladas', () => {
  let server: Server, candidate: ImprovementCandidate, workerCalls: number;
  let invalidSignature: boolean, missingCapabilities: boolean, published: boolean, healthFailed: boolean;
  let failPrPosts: number, prCreated: boolean, branchCreated: boolean, merged: boolean, compared: boolean;
  let checkpoint: PatchResult | undefined;
  let reviews: CommitteeReview[], dispatches: string[], writes: string[];
  const previousReviewAdapter = (SpecialistCommitteeExecutionService as any).adapter;
  function signed(value: unknown) {
    const raw = JSON.stringify(value);
    return new Response(raw, { headers: { 'x-frocia-worker-signature': 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex') } });
  }
  function checks(sha: string) {
    return CAPABILITY_CATEGORIES.map((category, i) => ({ id: i + 1, name: `Capability: ${category}`, head_sha: sha,
      app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' }));
  }
  beforeEach(async () => {
    workerCalls = 0; invalidSignature = false; missingCapabilities = false; published = false; healthFailed = false;
    failPrPosts = 0; prCreated = false; branchCreated = false; merged = false; compared = false;
    checkpoint = undefined; reviews = []; dispatches = []; writes = [];
    candidate = { id: 'whole-cycle', title: 'Corrigir falha de navegacao', summary: 'Defeito observado', evidence: ['audit://fixture'],
      frequency: 1, affectedUsersCount: 1, severity: 'medium', confidence: 1, affectedComponents: ['ui'], probableFiles: ['src/fix.ts'],
      hypothesis: 'Falha de evento', expectedBehavior: 'Navegar', riskLevel: 'R1', estimatedCostCredits: 10,
      testPlan: 'Regressao', rollbackStrategy: 'Reverter', duplicates: [], requiresApproval: false,
      state: 'detected', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    for (const [name, value] of Object.entries({ SELF_EVOLUTION_ENABLED: 'true', AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED: 'true',
      SELF_EVOLUTION_CI_DISPATCH_REQUIRED: 'true', GITHUB_TOKEN: 'fixture-token', GITHUB_OWNER: 'owner', GITHUB_REPO: 'site', GITHUB_BASE_BRANCH: 'main',
      VERCEL_TOKEN: 'fixture-vercel', VERCEL_PROJECT_ID: 'prj_site', SELF_EVOLUTION_TARGET_URL: 'https://site.vercel.app/',
      SELF_EVOLUTION_WORKER_TOKEN: 'fixture-worker', SELF_EVOLUTION_WORKER_SIGNING_SECRET: SECRET, NODE_ENV: 'test' })) vi.stubEnv(name, value);
    server = createServer(async (req, res) => {
      workerCalls++;
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const raw = JSON.stringify({ files: [{ path: 'src/fix.ts', content: 'export const fixed = true;\n' }], linesAdded: 1, linesRemoved: 0, baseSha: BASE,
        executionEvidence: { schemaVersion: 'engineering-sandbox-v1', candidateId: input.candidateId, requestNonce: input.requestNonce,
          sandboxId: 'sandbox:whole-lifecycle', baseSha: BASE, networkPolicy: 'restricted', workspaceBeforeSha256: '3'.repeat(64),
          workspaceAfterSha256: '4'.repeat(64), diffSha256: '5'.repeat(64), rollbackVerified: true, commands, issuedAt: new Date().toISOString() } });
      res.setHeader('x-frocia-worker-signature', 'sha256=' + crypto.createHmac('sha256', invalidSignature ? 'wrong-secret' : SECRET).update(raw).digest('hex'));
      res.end(raw);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    vi.stubEnv('SELF_EVOLUTION_WORKER_URL', `http://127.0.0.1:${(server.address() as { port: number }).port}`);
    CodeAgentService.setAdapter(new DefaultCodeAgentAdapter());
    LockService.setRepository(new InMemoryLockRepository());
    vi.spyOn(LockService, 'acquireLock');
    vi.spyOn(SelfEvolutionPolicyEngine, 'isSelfEvolutionEnabledPersisted').mockResolvedValue(true);
    vi.spyOn(ImprovementPlannerService, 'getCandidateById').mockImplementation(async () => structuredClone(candidate));
    vi.spyOn(ImprovementPlannerService, 'updateCandidateState').mockImplementation(async (_id, state) => { candidate.state = state; return true; });
    vi.spyOn(ImprovementPlannerService, 'updateCandidateMetadata').mockImplementation(async (_id, fields) => { Object.assign(candidate, fields); return true; });
    vi.spyOn(BudgetService, 'canExecuteAgentRun').mockResolvedValue(true);
    vi.spyOn(BudgetService, 'consumeBudget').mockResolvedValue(true);
    vi.spyOn(AuditService, 'logEvent').mockResolvedValue({} as any);
    vi.spyOn(CertifiedPatchCheckpointService, 'save').mockImplementation(async (_id, patch) => { checkpoint = structuredClone(patch); });
    vi.spyOn(CertifiedPatchCheckpointService, 'load').mockImplementation(async () => checkpoint ? structuredClone(checkpoint) : null);
    vi.spyOn(ContinuousCapabilityEvaluationService, 'hasPassingComparison').mockImplementation(async () => compared);
    vi.spyOn(ContinuousCapabilityEvaluationService, 'compareVerifiedGithubAndPersist').mockImplementation(async (base, next) => {
      const comparison = ContinuousCapabilityEvaluationService.compare(base, next); compared = comparison.passed; return comparison;
    });
    SpecialistCommitteeExecutionService.setAdapter({ review: async role => ({ verdict: 'approved', summary: `Parecer com evidencia para ${role}.`,
      fileRefs: ['src/fix.ts'], testRefs: ['regressao'], evidenceRefs: ['fixture://checked'], risks: [] }) });
    vi.spyOn(CommitteeGateService, 'submitReview').mockImplementation(async input => {
      const review = { id: crypto.randomUUID(), ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      reviews.push(review); return review;
    });
    vi.spyOn(CommitteeGateService, 'listReviews').mockImplementation(async () => reviews);
    vi.stubGlobal('fetch', vi.fn(async (rawUrl: string | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(rawUrl); const method = init?.method || 'GET';
      if (method !== 'GET') writes.push(url.pathname);
      if (url.pathname.endsWith('/api/worker/browser-validate')) {
        const body = JSON.parse(String(init?.body));
        return signed({ schemaVersion: 'browser-validation-v1', requestNonce: body.requestNonce, sandboxId: 'browser:fixture',
          commitSha: body.commitSha, previewUrl: body.previewUrl, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
          scenarios: REQUIRED_BROWSER_SCENARIOS.map(id => ({ id, status: 'passed', durationMs: 1, traceSha256: '6'.repeat(64), details: 'fixture' })),
          consoleErrors: [], failedRequests: [], passed: true });
      }
      if (url.hostname === 'api.github.com') {
        if (url.pathname.endsWith('/dispatches')) { dispatches.push(url.pathname); return new Response(null, { status: 204 }); }
        if (url.pathname.endsWith('/check-runs')) {
          const sha = url.pathname.split('/').at(-2)!;
          return Response.json({ check_runs: [
            { name: 'Build & Verify', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' },
            ...(missingCapabilities ? [] : checks(sha)),
          ], total_count: missingCapabilities ? 1 : 10 });
        }
        if (url.pathname.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: BASE } });
        if (url.pathname.includes('/git/ref/heads/froc-evolution/')) return Response.json({ object: { sha: HEAD } });
        if (url.pathname.includes('/git/commits/') && method === 'GET') return Response.json({ tree: { sha: TREE }, parents: [{ sha: BASE }] });
        if (url.pathname.endsWith('/git/blobs') || url.pathname.endsWith('/git/trees')) return Response.json({ sha: TREE });
        if (url.pathname.endsWith('/git/commits')) return Response.json({ sha: HEAD });
        if (url.pathname.endsWith('/git/refs')) { const status = branchCreated ? 422 : 201; branchCreated = true; return Response.json({}, { status }); }
        if (url.pathname.endsWith('/pulls') && method === 'GET') return Response.json(prCreated ? [{ number: 1, html_url: 'https://github.com/owner/site/pull/1', head: { sha: HEAD } }] : []);
        if (url.pathname.endsWith('/pulls') && method === 'POST') {
          if (failPrPosts-- > 0) return Response.json({}, { status: 503 });
          prCreated = true; return Response.json({ number: 1, html_url: 'https://github.com/owner/site/pull/1' }, { status: 201 });
        }
        if (url.pathname.endsWith('/pulls/1/merge')) { merged = true; return Response.json({ merged: true, sha: MERGE }); }
        if (url.pathname.endsWith('/pulls/1')) return Response.json({ state: merged ? 'closed' : 'open', merged,
          head: { sha: HEAD }, base: { sha: BASE }, merge_commit_sha: merged ? MERGE : undefined });
      }
      if (url.hostname === 'api.vercel.com') {
        if (url.pathname === '/v6/deployments') return Response.json({ deployments: [{ uid: 'dpl_preview', state: 'READY', meta: { githubCommitSha: HEAD } }] });
        if (url.pathname.includes('/aliases/')) return Response.json({ alias: 'site.vercel.app', projectId: 'prj_site', deploymentId: 'dpl_prod' });
        if (url.pathname.endsWith('/dpl_preview')) return Response.json({ id: 'dpl_preview', projectId: 'prj_site', target: null,
          readyState: 'READY', gitSource: { sha: HEAD }, url: 'preview.vercel.app' });
        if (url.pathname.endsWith('/dpl_prod')) return Response.json({ id: 'dpl_prod', projectId: 'prj_site', target: 'production',
          readyState: 'READY', gitSource: { sha: published ? MERGE : BASE } });
      }
      if (url.hostname === 'preview.vercel.app' || url.hostname === 'site.vercel.app')
        return new Response('health fixture', { status: url.hostname === 'site.vercel.app' && healthFailed ? 503 : 200 });
      throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`);
    }));
  });
  afterEach(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    SpecialistCommitteeExecutionService.setAdapter(previousReviewAdapter);
    CodeAgentService.setAdapter(new DefaultCodeAgentAdapter());
    vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });
  const step = () => SelfEvolutionOrchestrator.processCandidateLifecycle('whole-cycle', 'fixture-runner');

  it('atravessa patch, PR, dois CIs, preview, dez pareceres, merge e confirmacao do dominio', async () => {
    expect((await step()).state).toBe('ci_pending');
    expect(dispatches).toHaveLength(2);
    expect((await step()).state).toBe('approved_for_release');
    expect(reviews).toHaveLength(10);
    expect(merged).toBe(true);
    expect((await step()).state).toBe('monitoring');
    published = true;
    expect((await step()).state).toBe('accepted');
    expect(candidate.productionMergeSha).toBe(MERGE);
    expect(workerCalls).toBe(1);
    expect(BudgetService.consumeBudget).toHaveBeenCalledTimes(1);
    expect(LockService.acquireLock).toHaveBeenCalledWith('whole-cycle', 'fixture-runner', 65 * 60_000);
  });

  it('retoma o PR depois de falha de API sem gerar nem cobrar outro patch', async () => {
    failPrPosts = 1;
    expect((await step()).state).toBe('patch_created');
    expect(checkpoint?.success).toBe(true);
    expect((await step()).state).toBe('ci_pending');
    expect(workerCalls).toBe(1);
    expect(BudgetService.consumeBudget).toHaveBeenCalledTimes(1);
  });

  it('conserva a espera por capacidades ausentes sem executar preview nem merge', async () => {
    expect((await step()).state).toBe('ci_pending'); missingCapabilities = true;
    expect((await step()).state).toBe('ci_passed');
    expect(reviews).toHaveLength(0); expect(merged).toBe(false); expect(workerCalls).toBe(1);
  });

  it('recusa assinatura invalida antes de qualquer escrita no GitHub', async () => {
    invalidSignature = true;
    expect((await step()).state).toBe('tests_failed');
    expect(writes).toHaveLength(0); expect(checkpoint).toBeUndefined(); expect(merged).toBe(false);
  });

  it('solicita rollback se a versao publicada falhar no health', async () => {
    await step(); await step(); published = true; healthFailed = true;
    const rollback = vi.spyOn(RollbackService, 'executeRollback').mockResolvedValue({ status: 'success', success: true, message: 'Reversao solicitada.' });
    expect((await step()).state).toBe('rolled_back');
    expect(rollback).toHaveBeenCalledOnce(); expect(candidate.state).not.toBe('accepted');
  });

  it('preserva para retomada um executor interrompido depois de expirar seu lease', async () => {
    candidate.state = 'agent_running';
    expect((await step()).state).toBe('tests_failed');
    expect(workerCalls).toBe(0); expect(BudgetService.consumeBudget).not.toHaveBeenCalled();
  });
});
