import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { run } from "./sandbox-process.mjs";
const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");
const digest = (files) =>
  hash(
    JSON.stringify(
      [...files]
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map((f) => [f.path, f.content]),
    ),
  );
const jobs = new Map();
let active = 0;
export function validateFactoryFiles(body) {
  if (
    !/^[a-f0-9]{64}$/.test(body.artifactDigest || "") ||
    !/^[a-zA-Z0-9-]{20,100}$/.test(body.nonce || "")
  )
    throw new Error("invalid_request");
  if (
    !Array.isArray(body.files) ||
    body.files.length < 5 ||
    body.files.length > 120 ||
    Buffer.byteLength(JSON.stringify(body.files)) > 1800000
  )
    throw new Error("invalid_files");
  const paths = new Set();
  for (const f of body.files) {
    if (
      typeof f.path !== "string" ||
      f.path.length > 200 ||
      f.path.includes("\\") ||
      f.path.startsWith("/") ||
      f.path.split("/").some((v) => !v || v === "." || v === "..") ||
      /(?:^|\/)(?:node_modules(?:\/|$)|\.git(?:\/|$)|\.env(?:\.|$))|\.(?:pem|key)$/i.test(
        f.path,
      ) ||
      typeof f.content !== "string" ||
      paths.has(f.path)
    )
      throw new Error("invalid_file");
    paths.add(f.path);
  }
  if (digest(body.files) !== body.artifactDigest)
    throw new Error("artifact_digest_mismatch");
  return body;
}
async function chownTree(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) await chownTree(p);
    await fs.chown(p, 10001, 10001);
  }
  await fs.chown(dir, 10001, 10001);
}
export async function certifyFactory(
  body,
  runner = run,
  ownership = chownTree,
) {
  validateFactoryFiles(body);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "froc-factory-"));
  const commands = [];
  try {
    for (const file of body.files) {
      const target = path.join(cwd, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content);
    }
    await ownership(cwd);
    for (const [id, args, timeout] of [
      ["install", ["ci", "--no-audit", "--no-fund"], 180000],
      ["typecheck", ["run", "typecheck"], 120000],
      ["unit", ["run", "test"], 120000],
      ["build", ["run", "build"], 120000],
      ["browser", ["run", "test:browser"], 180000],
      ["dependencies", ["audit", "--omit=dev", "--audit-level=high"], 60000],
    ]) {
      const result = await runner("npm", args, cwd, timeout, {}, true);
      commands.push({
        id,
        exitCode: result.exitCode,
        stdoutSha256: hash(result.stdout),
        stderrSha256: hash(result.stderr),
        startedAt: result.startedAt,
        completedAt: result.completedAt,
      });
      if (result.exitCode !== 0)
        return {
          status: "failed",
          nonce: body.nonce,
          artifactDigest: body.artifactDigest,
          commands,
          message: "Etapa " + id + " reprovada.",
          diagnostic: result.stderr.toString().slice(-3000),
        };
    }
    return {
      status: "passed",
      nonce: body.nonce,
      artifactDigest: body.artifactDigest,
      commands,
    };
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}
function deployedUrl(input) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".vercel.app") ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("invalid_deployment_url");
  return url.origin;
}
export async function browseFactory(body, chromium, AxeBuilder) {
  const origin = deployedUrl(body.url);
  if (
    !/^[a-f0-9]{64}$/.test(body.artifactDigest || "") ||
    !Array.isArray(body.journeys) ||
    !Array.isArray(body.publicPages) ||
    body.journeys.length > 30 ||
    body.publicPages.length > 50 ||
    !["preview", "production"].includes(body.environment)
  )
    throw new Error("invalid_browser_request");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const timer = setTimeout(() => browser.close().catch(() => {}), 360000);
  const results = [];
  const failures = [];
  const internalLinks = new Set();
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: false });
    const allowed = (host) =>
      host === new URL(origin).hostname ||
      /^(?:fonts\.googleapis\.com|fonts\.gstatic\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firestore\.googleapis\.com|firebasestorage\.googleapis\.com|storage\.googleapis\.com|checkout\.stripe\.com|js\.stripe\.com|api\.stripe\.com|sdk\.mercadopago\.com|api\.mercadopago\.com|www\.mercadopago\.com(?:\.br)?)$/.test(
        host,
      ) ||
      host.endsWith(".firebaseapp.com");
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.protocol === "data:" ||
        url.protocol === "blob:" ||
        (url.protocol === "https:" && allowed(url.hostname))
        ? route.continue()
        : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", () => failures.push("Erro de execução no navegador."));
    const release = await context.request.get(
      origin + "/.well-known/froc-release.json",
    );
    if (
      !release.ok() ||
      (await release.json()).releaseDigest !== body.releaseDigest
    )
      throw new Error("published_artifact_mismatch");
    for (const relative of body.publicPages) {
      if (!/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(relative))
        throw new Error("invalid_public_path");
      for (const width of [360, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const response = await page.goto(origin + relative, {
          waitUntil: "domcontentloaded",
        });
        if (!response?.ok()) throw new Error("page_http_failure");
        await page.evaluate(() => window.FrocConfigReady);
        await page.locator("main").first().waitFor({ state: "visible" });
        if (
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 2,
          )
        )
          throw new Error("horizontal_overflow");
        const analysis = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        if (
          analysis.violations.some((v) =>
            ["critical", "serious"].includes(v.impact),
          )
        )
          throw new Error("accessibility_failure");
        await page.keyboard.press("Tab");
        if (
          !(await page.evaluate(() => document.activeElement !== document.body))
        )
          throw new Error("keyboard_focus_failure");
        await page.waitForFunction(
          () =>
            [...document.images]
              .filter((img) => {
                const r = img.getBoundingClientRect();
                return r.bottom > 0 && r.top < innerHeight;
              })
              .every((img) => img.complete),
          {},
          { timeout: 15000 },
        );
        const brokenVisibleImages = await page.evaluate(
          () =>
            [...document.images].filter((img) => {
              const r = img.getBoundingClientRect();
              return (
                r.bottom > 0 &&
                r.top < innerHeight &&
                (!img.complete || !img.naturalWidth)
              );
            }).length,
        );
        if (brokenVisibleImages) throw new Error("visible_image_failure");
        for (const href of await page
          .locator("a[href]")
          .evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
          if (!href || href.startsWith("#") || /^(?:mailto:|tel:)/.test(href))
            continue;
          const target = new URL(href, origin + relative);
          if (target.protocol === "javascript:") throw new Error("unsafe_link");
          if (target.origin === origin && !target.pathname.startsWith("/api/"))
            internalLinks.add(target.origin + target.pathname + target.search);
        }
        results.push({
          id: "page:" + relative + ":" + width,
          passed: true,
          screenshotSha256: hash(await page.screenshot()),
        });
      }
    }
    for (const url of internalLinks) {
      const response = await context.request.get(url, { maxRedirects: 0 });
      if (response.status() >= 400) throw new Error("broken_internal_link");
    }
    results.push({ id: "links", passed: true, count: internalLinks.size });
    await context.clearCookies();
    await page.evaluate(() => localStorage.removeItem("froc-consent-v1"));
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Rejeitar opcionais", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Alterar preferências de cookies",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Personalizar", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Salvar preferências", exact: true })
      .click();
    results.push({ id: "consent", passed: true });
    const substitute = (value) =>
      String(value || "").replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, name) => {
        if (!name.startsWith("TEST_") || !body.testVariables?.[name])
          throw new Error("test_variable_missing");
        return body.testVariables[name];
      });
    for (const journey of body.journeys.filter(
      (j) => j.environment === "both" || j.environment === body.environment,
    )) {
      if (
        !/^\/(?!\/)[A-Za-z0-9/_?=&.%-]*$/.test(journey.path) ||
        !Array.isArray(journey.steps) ||
        journey.steps.length > 30
      )
        throw new Error("invalid_journey");
      await context.clearCookies();
      await page.goto(origin);
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.goto(origin + journey.path);
      const reject = page.getByRole("button", {
        name: "Rejeitar opcionais",
        exact: true,
      });
      if (await reject.isVisible()) await reject.click();
      for (const step of journey.steps) {
        let locator;
        if (step.by === "label")
          locator = page.getByLabel(step.locator, { exact: true });
        else if (step.by === "role")
          locator = page.getByRole(step.role || "button", {
            name: step.locator,
            exact: true,
          });
        else if (step.by === "testid") locator = page.getByTestId(step.locator);
        else locator = page.getByText(step.locator, { exact: true });
        if (step.action === "click") await locator.click();
        else if (step.action === "fill")
          await locator.fill(substitute(step.value));
        else if (step.action === "select")
          await locator.selectOption(substitute(step.value));
        else if (step.action === "expect-visible") {
          if (!(await locator.isVisible()))
            throw new Error("expected_control_missing");
        } else if (step.action === "expect-text") {
          if (!(await locator.textContent())?.includes(substitute(step.value)))
            throw new Error("expected_result_missing");
        } else throw new Error("invalid_journey_step");
      }
      results.push({
        id: journey.id,
        passed: true,
        screenshotSha256: hash(await page.screenshot()),
      });
    }
    for (const integration of body.integrations || []) {
      if (!/^\/api\/[a-z0-9/_-]+$/.test(integration.healthPath))
        throw new Error("invalid_health_path");
      const response = await context.request.get(
        origin + integration.healthPath,
      );
      const health = await response.json();
      if (
        !response.ok() ||
        health.ok !== true ||
        health.environment !== body.environment ||
        !Array.isArray(health.checks) ||
        !health.checks.length ||
        health.checks.some((c) => c.status !== "passed" || !c.receiptId)
      )
        throw new Error("integration_health_failure");
      results.push({
        id: "integration:" + integration.name,
        passed: true,
        receiptDigest: hash(JSON.stringify(health.checks)),
      });
    }
    for (const pathname of [
      "/robots.txt",
      "/sitemap.xml",
      "/legal/privacy.html",
      "/legal/terms.html",
      "/legal/cookies.html",
    ]) {
      const response = await context.request.get(origin + pathname);
      if (!response.ok()) throw new Error("required_document_missing");
    }
    if (failures.length) throw new Error("browser_runtime_failure");
    return {
      status: "passed",
      nonce: body.nonce,
      artifactDigest: body.artifactDigest,
      results,
    };
  } catch (e) {
    return {
      status: "failed",
      nonce: body.nonce,
      artifactDigest: body.artifactDigest,
      results,
      message: String(e.message || "browser_failed")
        .replace(/https?:\/\/\S+/g, "[URL]")
        .slice(0, 250),
    };
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}
export function registerProfessionalFactory(
  app,
  authenticate,
  sendSigned,
  chromium,
  AxeBuilder,
) {
  app.post("/factory/jobs", authenticate, async (req, res) => {
    try {
      const b = req.body;
      if (!["certify", "browser"].includes(b.kind))
        throw new Error("invalid_job_kind");
      if (b.kind === "certify") validateFactoryFiles(b);
      else deployedUrl(b.url);
      for (const [key, value] of jobs)
        if (Date.now() - value.created > 21600000 && !value.running)
          jobs.delete(key);
      const key = hash(JSON.stringify([b.nonce, b.artifactDigest, b.kind]));
      const existing = jobs.get(key);
      if (existing)
        return sendSigned(res, {
          ...existing.result,
          jobId: key,
          nonce: b.nonce,
          artifactDigest: b.artifactDigest,
        });
      if (active || jobs.size > 100)
        return sendSigned(
          res,
          { status: "busy", nonce: b.nonce, artifactDigest: b.artifactDigest },
          429,
        );
      active++;
      const job = {
        created: Date.now(),
        running: true,
        result: {
          status: "running",
          nonce: b.nonce,
          artifactDigest: b.artifactDigest,
        },
      };
      jobs.set(key, job);
      (b.kind === "certify"
        ? certifyFactory(b)
        : browseFactory(b, chromium, AxeBuilder)
      )
        .then((result) => {
          job.result = result;
        })
        .catch(() => {
          job.result = {
            status: "failed",
            nonce: b.nonce,
            artifactDigest: b.artifactDigest,
            message: "O executor não concluiu a verificação.",
          };
        })
        .finally(() => {
          job.running = false;
          active--;
        });
      return sendSigned(res, { ...job.result, jobId: key });
    } catch {
      return sendSigned(
        res,
        { status: "failed", message: "Requisição de fábrica inválida." },
        400,
      );
    }
  });
  app.get("/factory/jobs/:id", authenticate, (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return sendSigned(res, { status: "expired" }, 404);
    return sendSigned(res, { ...job.result, jobId: req.params.id });
  });
}
