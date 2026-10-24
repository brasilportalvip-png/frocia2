import { registerProfessionalFactory } from './professional-factory.mjs';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { buildEngineeringContext } from './engineering-context.mjs';
import { analyzeTypeScriptLanguage } from './typescript-language-engine.mjs';
import { executeAutonomousRepairCycle } from './autonomous-repair-cycle.mjs';
import { auditSelfSiteViews } from './site-navigation-audit.mjs';
import { authenticateSelfSite } from './site-session-audit.mjs';
import { safeDiagnosticText, commandDiagnosticExcerpt, workerFailurePayload } from './worker-failure.mjs';
import { run } from './sandbox-process.mjs';
import { generateStructuredPatch, safeRepoPath } from './patch-generation.mjs';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
const PORT = Number(process.env.PORT || 8080);
const REQUIRED_COMMANDS = ['install', 'typecheck', 'lint', 'test', 'e2e', 'security-audit', 'production-integrity', 'build', 'diff-check'];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function authenticate(req, res, next) {
  const expected = `Bearer ${required('SELF_EVOLUTION_WORKER_TOKEN')}`;
  if (!safeEqual(req.headers.authorization || '', expected)) return res.status(401).json({ error: 'unauthorized' });
  next();
}
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sign(raw) { return `sha256=${crypto.createHmac('sha256', required('SELF_EVOLUTION_WORKER_SIGNING_SECRET')).update(raw).digest('hex')}`; }
function sendSigned(res, payload, status = 200) {
  const raw = JSON.stringify(payload);
  res.setHeader('content-type', 'application/json');
  res.setHeader('x-frocia-worker-signature', sign(raw));
  return res.status(status).send(raw);
}
registerProfessionalFactory(app, authenticate, sendSigned, chromium, AxeBuilder);

async function mustRun(id, command, args, display, cwd, timeout = 10 * 60_000) {
  console.log('[worker:command]', JSON.stringify({ id, event: 'start' }));
  const result = await run(command, args, cwd, timeout, {}, true);
  console.log('[worker:command]', JSON.stringify({ id, event: 'end', exitCode: result.exitCode, durationMs: result.durationMs }));
  const evidence = {
    id, command: display, exitCode: result.exitCode, startedAt: result.startedAt,
    completedAt: result.completedAt, durationMs: result.durationMs,
    stdoutSha256: sha(result.stdout), stderrSha256: sha(result.stderr),
  };
  if (result.exitCode !== 0) {
    const error = new Error(`command_failed:${id}`); error.evidence = evidence;
    error.stderrTail = commandDiagnosticExcerpt(result.stderr.toString());
    error.stdoutTail = commandDiagnosticExcerpt(result.stdout.toString());
    console.error('[worker:command-failure]', JSON.stringify({ id, exitCode: result.exitCode,
      stdout: error.stdoutTail, stderr: error.stderrTail }));
    throw error;
  }
  return evidence;
}
async function workspaceDigest(cwd, isolated = false) {
  const files = await run('git', ['ls-files', '-z'], cwd, 30_000, {}, isolated);
  if (files.exitCode !== 0) throw new Error('git_ls_files_failed');
  const hash = crypto.createHash('sha256');
  for (const relative of files.stdout.toString().split('\0').filter(Boolean).sort()) {
    hash.update(relative); hash.update('\0'); hash.update(await fs.readFile(path.join(cwd, relative))); hash.update('\0');
  }
  return hash.digest('hex');
}
async function repositoryContext(body, cwd) {
  const listed = await run('git', ['ls-files', '-z'], cwd, 30_000);
  if (listed.exitCode !== 0) throw new Error('repository_inventory_failed');
  const files = [];
  for (const relative of listed.stdout.toString().split('\0').filter(Boolean)) {
    const safe = safeRepoPath(relative);
    if (!safe) continue;
    try {
      const stat = await fs.stat(path.join(cwd, safe));
      if (stat.size <= 500_000) files.push({ path: safe, content: await fs.readFile(path.join(cwd, safe), 'utf8') });
    } catch { /* arquivo binário, removido ou ilegível não entra no contexto */ }
  }
  const context = buildEngineeringContext(files, {
    title: body.title, summary: body.summary, hypothesis: body.hypothesis,
    expectedBehavior: body.expectedBehavior, testPlan: body.testPlan,
  }, body.probableFiles || [], {
    allowRepositoryMaintenance: process.env.SELF_EVOLUTION_FULL_REPOSITORY_ACCESS === 'true' && body.executionPolicy?.allowRepositoryMaintenance === true,
  });
  context.languageIntelligence = analyzeTypeScriptLanguage(context.sourceFiles, context.queryTerms);
  const history = await run('git', ['log', '--format=%H%x09%aI%x09%s', '-n', '50', '--', ...context.selectedFiles.slice(0, 20)], cwd, 30_000);
  context.gitHistory = history.exitCode === 0 ? history.stdout.toString().split('\n').filter(Boolean).slice(0, 50) : [];
  return context;
}

async function generatePatch(body, cwd, allowed, engineeringContext, repairFeedback = null, attempt = 1) {
  const ai = new GoogleGenAI({ apiKey: required('GEMINI_API_KEY') });
  const sourceFiles = [];
  for (const relative of allowed) {
    try { sourceFiles.push({ path: relative, content: (await fs.readFile(path.join(cwd, relative), 'utf8')).slice(0, 150_000) }); }
    catch { sourceFiles.push({ path: relative, content: null }); }
  }
  return generateStructuredPatch({
    generateContent: request => ai.models.generateContent(request),
    model: process.env.ENGINEERING_MODEL || 'gemini-3.1-pro-preview', allowed, attempt, feedback: repairFeedback,
    input: {
      task: { title: body.title, summary: body.summary, hypothesis: body.hypothesis, expectedBehavior: body.expectedBehavior, testPlan: body.testPlan },
      allowedPaths: [...allowed], sourceFiles, engineeringContext,
    },
    onDiagnostic: diagnostic => console.log('[worker:generation]', JSON.stringify({ candidateId: body.candidateId, attempt, ...diagnostic })),
  });
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'frocia-engineering-worker' }));
app.post('/api/worker/patch', authenticate, async (req, res) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'frocia-worker-'));
  const cwd = path.join(temp, 'repo'); const commands = [];
  const body = req.body || {};
  let stage = 'request'; let repairCycleReport;
  const markStage = next => { stage = next; console.log('[worker:patch]', JSON.stringify({ candidateId: body.candidateId, stage })); };
  try {
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(body.candidateId || '') || !/^[a-f0-9]{48}$/i.test(body.requestNonce || '')) throw new Error('request_invalid');
    if (body.executionPolicy?.networkPolicy !== 'restricted' || process.env.SANDBOX_NETWORK_POLICY !== 'restricted') throw new Error('restricted_network_policy_required');
    const repository = new URL(required('SANDBOX_REPOSITORY_URL'));
    if (repository.protocol !== 'https:' || repository.username || repository.password) throw new Error('repository_https_without_embedded_credentials_required');
    markStage('clone');
    const clone = await run('git', ['clone', '--no-tags', '--depth', '50', '--branch', process.env.GITHUB_BASE_BRANCH || 'main', repository.toString(), cwd], temp, 120_000);
    if (clone.exitCode !== 0) { const error = new Error('clone_failed'); error.stderrTail = safeDiagnosticText(clone.stderr.toString()); throw error; }
    markStage('repository_context');
    const head = await run('git', ['rev-parse', 'HEAD'], cwd, 10_000);
    const baseSha = head.stdout.toString().trim();
    if (!/^[a-f0-9]{40}$/i.test(baseSha)) throw new Error('base_sha_invalid');
    const before = await workspaceDigest(cwd);
    const engineeringContext = await repositoryContext(body, cwd);
    const allowed = new Set([...(body.probableFiles || []), ...engineeringContext.editablePaths].map(safeRepoPath).filter(Boolean));
    if (!allowed.size) throw new Error('allowed_paths_required');
    markStage('ownership');
    const initialOwnership = await run('chown', ['-R', '10001:10001', temp], temp, 30_000);
    if (initialOwnership.exitCode !== 0) throw new Error('sandbox_initial_ownership_failed');
    let outputFiles = [];
    const repairCycle = await executeAutonomousRepairCycle({
      maximumAttempts: Number(process.env.ENGINEERING_MAX_REPAIR_ATTEMPTS || 3),
      restoreBaseline: async () => {
        markStage('restore_baseline');
        const reset = await run('git', ['reset', '--hard', baseSha], cwd, 30_000, {}, true);
        const clean = await run('git', ['clean', '-fd'], cwd, 30_000, {}, true);
        if (reset.exitCode !== 0 || clean.exitCode !== 0) throw new Error('repair_baseline_restore_failed');
      },
      generate: async ({ feedback, attempt }) => { markStage('generation'); return generatePatch(body, cwd, allowed, engineeringContext, feedback, attempt); },
      apply: async (patch) => {
        markStage('apply');
        const nextFiles = [];
        for (const file of patch.files) {
          const relative = safeRepoPath(file.path);
          const isTest = relative && /^tests\/[A-Za-z0-9._/-]+\.test\.(?:ts|tsx)$/.test(relative);
          if (!relative || (!allowed.has(relative) && !isTest) || typeof file.content !== 'string' || Buffer.byteLength(file.content) > 1_000_000) throw new Error('generated_file_out_of_scope');
          const target = path.join(cwd, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.content, 'utf8');
          nextFiles.push({ path: relative, content: file.content });
        }
        outputFiles = nextFiles;
        const ownership = await run('chown', ['-R', '10001:10001', cwd], temp, 30_000);
        if (ownership.exitCode !== 0) throw new Error('sandbox_ownership_failed');
      },
      certify: async () => {
        markStage('certification');
        const attemptCommands = [];
        try {
          const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
          attemptCommands.push(await mustRun('install', 'npm', ['ci'], 'npm ci', cwd));
          attemptCommands.push(pkg.scripts?.typecheck ? await mustRun('typecheck', 'npm', ['run', 'typecheck'], 'npm run typecheck', cwd) : await mustRun('typecheck', 'npm', ['run', 'lint'], 'npm run lint', cwd));
          attemptCommands.push(pkg.scripts?.lint ? await mustRun('lint', 'npm', ['run', 'lint'], 'npm run lint', cwd) : await mustRun('lint', 'npm', ['run', 'typecheck'], 'npm run typecheck', cwd));
          attemptCommands.push(await mustRun('test', 'npm', ['test'], 'npm test', cwd));
          attemptCommands.push(await mustRun('e2e', 'npm', ['run', 'test:e2e'], 'npm run test:e2e', cwd, 15 * 60_000));
          attemptCommands.push(await mustRun('security-audit', 'npm', ['audit', '--omit=dev', '--audit-level=moderate'], 'npm audit --omit=dev --audit-level=moderate', cwd));
          attemptCommands.push(await mustRun('production-integrity', 'npm', ['run', 'validate:production-integrity'], 'npm run validate:production-integrity', cwd));
          attemptCommands.push(await mustRun('build', 'npm', ['run', 'build'], 'npm run build', cwd));
          attemptCommands.push(await mustRun('diff-check', 'git', ['diff', '--check'], 'git diff --check', cwd));
          commands.splice(0, commands.length, ...attemptCommands);
          return { passed: true, evidenceRefs: attemptCommands.map((item) => `${item.id}:${item.stdoutSha256}`) };
        } catch (error) {
          const evidence = error?.evidence;
          commands.splice(0, commands.length, ...attemptCommands, ...(evidence ? [evidence] : []));
          return { passed: false, failure: { stage: evidence?.id || 'certification', exitCode: evidence?.exitCode || 1, stdoutSha256: evidence?.stdoutSha256, stderrSha256: evidence?.stderrSha256, summary: error instanceof Error ? error.message : 'certification_failed', stderrTail: error?.stderrTail, stdoutTail: error?.stdoutTail } };
        }
      },
    });
    repairCycleReport = repairCycle;
    if (!repairCycle.passed || !repairCycle.patch) throw new Error('autonomous_repair_exhausted');
    const generated = repairCycle.patch;
    if (!REQUIRED_COMMANDS.every((id) => commands.some((command) => command.id === id))) throw new Error('required_commands_missing');
    markStage('diff');
    const diff = await run('git', ['diff', '--binary', '--no-ext-diff'], cwd, 30_000, {}, true);
    const after = await workspaceDigest(cwd, true);
    const stats = await run('git', ['diff', '--numstat'], cwd, 30_000, {}, true);
    if (diff.exitCode !== 0 || stats.exitCode !== 0) throw new Error('git_diff_failed');
    let linesAdded = 0; let linesRemoved = 0;
    for (const line of stats.stdout.toString().split('\n')) {
      const [added, removed] = line.split('\t');
      if (/^\d+$/.test(added)) linesAdded += Number(added); if (/^\d+$/.test(removed)) linesRemoved += Number(removed);
    }
    markStage('rollback');
    await mustRun('rollback-reset', 'git', ['reset', '--hard', baseSha], 'git reset --hard', cwd);
    await mustRun('rollback-clean', 'git', ['clean', '-fd'], 'git clean -fd', cwd);
    const status = await run('git', ['status', '--porcelain'], cwd, 10_000, {}, true);
    const rollbackVerified = status.exitCode === 0 && status.stdout.length === 0 && (await workspaceDigest(cwd, true)) === before;
    if (!rollbackVerified) throw new Error('rollback_verification_failed');
    return sendSigned(res, {
      files: outputFiles, linesAdded, linesRemoved,
      repairCycle: {
        schemaVersion: repairCycle.schemaVersion, selectedAttempt: repairCycle.selectedAttempt,
        attempts: repairCycle.attempts, digest: repairCycle.digest,
      }, engineeringContext: {
        schemaVersion: engineeringContext.schemaVersion, digest: engineeringContext.digest,
        selectedFiles: engineeringContext.selectedFiles, editablePaths: engineeringContext.editablePaths,
        relatedTests: engineeringContext.relatedTests, rootCauseQuestions: engineeringContext.rootCauseQuestions,
      },
      testFileCreated: outputFiles.find((file) => file.path.startsWith('tests/'))?.path,
      commitMessage: String(generated.commitMessage || `fix: ${body.title}`).replace(/[\r\n]+/g, ' ').slice(0, 120), baseSha,
      executionEvidence: {
        schemaVersion: 'engineering-sandbox-v1', candidateId: body.candidateId,
        requestNonce: body.requestNonce, sandboxId: process.env.SANDBOX_INSTANCE_ID || `container:${crypto.randomUUID()}`,
        baseSha, networkPolicy: 'restricted', workspaceBeforeSha256: before,
        workspaceAfterSha256: after, diffSha256: sha(diff.stdout), rollbackVerified,
        commands, issuedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const failure = workerFailurePayload({ body, stage, error, commands, repairCycle: repairCycleReport });
    console.error('[worker:patch]', JSON.stringify({ candidateId: body.candidateId, stage: failure.stage, error: failure.error }));
    return sendSigned(res, failure, 422);
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(error => console.error('[worker:cleanup]', safeDiagnosticText(error.message)));
  }
});

function publicHttps(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)) throw new Error('browser_target_invalid');
  return url.toString();
}
app.post('/api/worker/browser-validate', authenticate, async (req, res) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'frocia-browser-'));
  const validationStartedAt = new Date().toISOString();
  let browser;
  try {
    const body = req.body || {}; const target = publicHttps(body.previewUrl);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(); const page = await context.newPage();
    const consoleErrors = []; const failedRequests = [];
    let navigation = []; let navigationCatalog = [];
    const navigationOptions = {
      ...(Array.isArray(body.navigationViews) ? { views: body.navigationViews.filter(v => typeof v === 'string' && v.length <= 160) } : {}),
      ...(Array.isArray(body.expectedNavigationViews) ? { expectedViews: body.expectedNavigationViews.filter(v => typeof v === 'string' && v.length <= 160) } : {}),
    };
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500)); });
    page.on('pageerror', error => consoleErrors.push(String(error.message).slice(0, 500)));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      const url = new URL(request.url()); url.search = ''; url.hash = '';
      failedRequests.push(`${request.method()} ${url.toString()}`.slice(0, 800));
    });
    page.on('response', response => {
      const url = new URL(response.url()); url.search = ''; url.hash = '';
      if (response.status() >= 500 && url.origin === new URL(target).origin) {
        failedRequests.push(`HTTP ${response.status()} ${url.toString()}`.slice(0, 800));
      }
    });
    const scenarios = [];
    const record = async (id, action, screenshot = true) => {
      const started = Date.now(); let status = 'passed'; let details = 'ok'; let screenshotSha256;
      try { await action(); }
      catch (error) { status = 'failed'; details = error instanceof Error ? error.message : 'failed'; }
      if (screenshot) {
        const file = path.join(temp, `${id}.png`); await page.screenshot({ path: file, fullPage: true }); screenshotSha256 = sha(await fs.readFile(file));
      }
      const traceSha256 = sha(JSON.stringify({ id, status, details, url: page.url(), title: await page.title().catch(() => '') }));
      scenarios.push({ id, status, durationMs: Date.now() - started, screenshotSha256, traceSha256, details });
    };
    await record('public-navigation', async () => {
      const response = await page.goto(target, { waitUntil: 'networkidle' });
      if (!response?.ok()) throw new Error(`HTTP ${response?.status()}`);
      navigation = await auditSelfSiteViews(page, target, navigationOptions);
      navigationCatalog = navigation.catalog;
      if (navigation.some(view => view.status === 'failed')) throw new Error('Uma ou mais vistas internas falharam; consulte navigation.');
    });
    await record('direct-route-refresh', async () => { await page.reload({ waitUntil: 'networkidle' }); });
    for (const [id, viewport] of [['mobile-responsive', { width: 390, height: 844 }], ['tablet-responsive', { width: 820, height: 1180 }], ['desktop-responsive', { width: 1440, height: 900 }]]) {
      await record(id, async () => { await page.setViewportSize(viewport); if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)) throw new Error('horizontal-overflow'); });
    }
    await record('keyboard-accessibility', async () => { await page.keyboard.press('Tab'); const tag = await page.evaluate(() => document.activeElement?.tagName); if (!tag || tag === 'BODY') throw new Error('no-keyboard-focus'); });
    await record('automated-accessibility', async () => { const result = await new AxeBuilder({ page }).analyze(); if (result.violations.some((v) => ['critical', 'serious'].includes(v.impact || ''))) throw new Error(`a11y:${result.violations.length}`); });
    await record('broken-links', async () => { const links = await page.locator('a[href]').evaluateAll((nodes) => nodes.slice(0, 50).map((node) => node.href)); for (const href of links) { const link = new URL(href); if (link.origin !== new URL(target).origin) continue; const response = await context.request.get(link.toString(), { timeout: 10_000 }); if (response.status() >= 400) throw new Error(`broken:${response.status()}:${href}`); } });
    await record('console-errors', async () => { if (consoleErrors.length) throw new Error(`${consoleErrors.length}-console-errors`); }, false);
    await record('network-errors', async () => { if (failedRequests.length) throw new Error(`${failedRequests.length}-network-errors`); }, false);
    const loginUrl = process.env.BROWSER_TEST_LOGIN_URL; const user = process.env.BROWSER_TEST_USER; const password = process.env.BROWSER_TEST_PASSWORD;
    if (loginUrl && user && password) {
      await record('authenticated-session', async () => {
        await authenticateSelfSite(page, target, {
          loginUrl: publicHttps(loginUrl), user, password,
          useTargetOrigin: process.env.BROWSER_LOGIN_USE_TARGET_ORIGIN === 'true',
          openSelector: process.env.BROWSER_LOGIN_OPEN_SELECTOR,
          userSelector: process.env.BROWSER_USER_SELECTOR,
          passwordSelector: process.env.BROWSER_PASSWORD_SELECTOR,
          submitSelector: process.env.BROWSER_SUBMIT_SELECTOR,
          authenticatedSelector: process.env.BROWSER_AUTHENTICATED_SELECTOR,
        });
        navigation = await auditSelfSiteViews(page, target, navigationOptions);
        navigationCatalog = navigation.catalog;
        if (navigation.some(view => view.status !== 'passed')) throw new Error('Vistas autenticadas nao foram validadas integralmente.');
      });
      await record('expired-session', async () => { await context.clearCookies(); await page.reload({ waitUntil: 'networkidle' }); });
    } else {
      for (const id of ['authenticated-session', 'expired-session']) scenarios.push({ id, status: 'external_blocker', durationMs: 0, traceSha256: sha(`${id}:credentials-missing`), details: 'Credenciais E2E não configuradas.' });
    }
    const passed = scenarios.every((scenario) => scenario.status === 'passed') &&
      navigation.every(view => view.status === 'passed') && !consoleErrors.length && !failedRequests.length;
    return sendSigned(res, {
      schemaVersion: 'browser-validation-v1', requestNonce: body.requestNonce,
      sandboxId: process.env.SANDBOX_INSTANCE_ID || `browser:${crypto.randomUUID()}`,
      commitSha: body.commitSha, previewUrl: target, startedAt: validationStartedAt,
      completedAt: new Date().toISOString(), scenarios, navigation, navigationCatalog, consoleErrors, failedRequests, passed,
    });
  } catch (error) {
    return sendSigned(res, { error: error instanceof Error ? error.message : 'browser_failed' }, 422);
  } finally {
    if (browser) await browser.close(); await fs.rm(temp, { recursive: true, force: true });
  }
});

app.listen(PORT, () => console.log(`Froc.IA engineering worker listening on ${PORT}`));
