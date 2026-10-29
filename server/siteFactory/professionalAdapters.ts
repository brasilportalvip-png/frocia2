import { adminDb } from "../lib/firebaseAdmin.js";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  FactoryAdapter,
  ProfessionalBuild,
} from "./professionalBuildService.js";
import { FactoryError, sourceDigest } from "./professionalContract.js";
import { managedProjectName, ProjectFile } from "./professionalScaffold.js";
import { ProjectVariableService } from "./projectVariableService.js";
import { generateFactoryMedia } from "./professionalMediaService.js";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const key = (b: ProfessionalBuild) =>
  JSON.stringify([b.tenantId, b.userId, b.projectId]);
async function responseJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}
export class ProfessionalAdapters implements FactoryAdapter {
  constructor(
    private readonly vault = new ProjectVariableService(),
    private readonly request: typeof fetch = fetch,
  ) {}
  private async live(b: ProfessionalBuild) {
    const doc = await adminDb.collection("site_factory_builds").doc(b.id).get();
    if (
      doc.data()?.status === "cancelled" ||
      doc.data()?.lease?.token !== b.lease?.token ||
      doc.data()?.lease?.expires < Date.now()
    )
      throw new FactoryError(
        "build_cancelled",
        "A construção foi interrompida.",
      );
  }
  async cancel(b: ProfessionalBuild) {
    const p = b.publication;
    if (!p?.productionId) return { verified: true, notPublished: true };
    const deployment = await this.vercel(
      "/v13/deployments/" + encodeURIComponent(p.productionId),
    );
    if (
      deployment.projectId !== p.projectId ||
      deployment.meta?.frocBuildId !== b.id
    )
      throw new FactoryError(
        "rollback_target_invalid",
        "A versão a restaurar não pertence a esta construção.",
      );
    if (["ERROR", "CANCELED", "BLOCKED"].includes(deployment.readyState))
      return { verified: true, notPublished: true };
    if (deployment.readyState !== "READY") {
      const cancelled = await this.vercel(
        "/v12/deployments/" + encodeURIComponent(p.productionId) + "/cancel",
        "PATCH",
      );
      if (cancelled.readyState !== "CANCELED")
        throw new FactoryError(
          "cancellation_unverified",
          "O cancelamento não foi confirmado.",
        );
      return { verified: true, cancelledPendingDeployment: true };
    }
    const project = await this.vercel(
      "/v9/projects/" + encodeURIComponent(p.projectId),
    );
    if (project.targets?.production?.id !== p.productionId)
      return { verified: true, alreadyReplaced: true };
    if (p.previousDeploymentId) {
      await this.vercel(
        "/v1/projects/" +
          encodeURIComponent(p.projectId) +
          "/rollback/" +
          encodeURIComponent(p.previousDeploymentId) +
          "?description=" +
          encodeURIComponent("Falha ou cancelamento na fábrica profissional."),
        "POST",
      );
      const restored = await this.vercel(
        "/v9/projects/" + encodeURIComponent(p.projectId),
      );
      if (restored.targets?.production?.id !== p.previousDeploymentId)
        throw new FactoryError(
          "rollback_unverified",
          "A restauração da versão anterior não foi confirmada.",
        );
      return { verified: true, deploymentId: p.previousDeploymentId };
    }
    await this.vercel(
      "/v13/deployments/" + encodeURIComponent(p.productionId),
      "DELETE",
    );
    return { verified: true, firstDeploymentRemoved: true };
  }
  media(b: ProfessionalBuild) {
    return generateFactoryMedia(b);
  }
  private async worker(previous: any, body: any) {
    const root = process.env.SELF_EVOLUTION_WORKER_URL?.replace(/\/$/, "");
    const token = process.env.SELF_EVOLUTION_WORKER_TOKEN;
    const secret = process.env.SELF_EVOLUTION_WORKER_SIGNING_SECRET;
    if (!root || !token || !secret)
      return {
        status: "waiting_executor",
        message: "Aguardando o executor automático da fábrica.",
      };
    const nonce = previous?.nonce || randomUUID();
    const requestBody = { ...body, nonce };
    const response = await this.request(
      root +
        (previous?.jobId
          ? "/factory/jobs/" + encodeURIComponent(previous.jobId)
          : "/factory/jobs"),
      {
        method: previous?.jobId ? "GET" : "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        ...(previous?.jobId ? {} : { body: JSON.stringify(requestBody) }),
        signal: AbortSignal.timeout(20000),
      },
    );
    const raw = await response.text();
    if (raw.length > 800000)
      throw new FactoryError(
        "worker_response_too_large",
        "Resposta de verificação inválida.",
      );
    const signature = Buffer.from(
      response.headers.get("x-frocia-worker-signature") || "",
    );
    const expected = Buffer.from(
      "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"),
    );
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    )
      throw new FactoryError(
        "worker_signature_invalid",
        "Não foi possível autenticar a evidência do executor.",
      );
    const receipt = JSON.parse(raw);
    if (response.status === 404 && receipt.status === "expired")
      return { status: "running", nonce, artifactDigest: body.artifactDigest };
    if (
      receipt.nonce !== nonce ||
      receipt.artifactDigest !== body.artifactDigest
    )
      throw new FactoryError(
        "worker_artifact_mismatch",
        "A evidência não pertence ao artefato solicitado.",
      );
    if (response.status === 429)
      return { status: "running", nonce, artifactDigest: body.artifactDigest };
    if (!response.ok)
      throw new FactoryError(
        "worker_request_failed",
        "O executor recusou a verificação.",
      );
    if (!["running", "passed", "failed"].includes(receipt.status))
      throw new FactoryError(
        "worker_status_invalid",
        "Estado de verificação inválido.",
      );
    return receipt;
  }
  async certify(b: ProfessionalBuild, files: ProjectFile[]) {
    const artifactDigest = sourceDigest(files);
    const previous =
      b.certificate?.artifactDigest === artifactDigest ? b.certificate : null;
    const result = await this.worker(previous, {
      kind: "certify",
      artifactDigest,
      files,
    });
    if (result.status === "passed") {
      const required = [
        "install",
        "typecheck",
        "unit",
        "build",
        "browser",
        "dependencies",
      ];
      if (
        !Array.isArray(result.commands) ||
        required.some(
          (id) =>
            result.commands.filter(
              (c: any) =>
                c.id === id &&
                c.exitCode === 0 &&
                /^[a-f0-9]{64}$/.test(c.stdoutSha256) &&
                /^[a-f0-9]{64}$/.test(c.stderrSha256),
            ).length !== 1,
        )
      )
        throw new FactoryError(
          "certificate_incomplete",
          "O executor não comprovou todos os testes obrigatórios.",
        );
    }
    return result;
  }
  private async vercel(path: string, method = "GET", body?: unknown) {
    const token = process.env.VERCEL_TOKEN;
    if (!token)
      throw new FactoryError(
        "vercel_unconfigured",
        "Configure VERCEL_TOKEN no executor da fábrica.",
        503,
      );
    const team = process.env.VERCEL_TEAM_ID;
    const response = await this.request(
      "https://api.vercel.com" +
        path +
        (team
          ? (path.includes("?") ? "&" : "?") +
            "teamId=" +
            encodeURIComponent(team)
          : ""),
      {
        method,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok)
      throw new FactoryError(
        "vercel_http_" + response.status,
        "A Vercel recusou a operação (HTTP " + response.status + ").",
        response.status === 404 ? 404 : 502,
      );
    return responseJson(response);
  }
  private async deploy(
    b: ProfessionalBuild,
    p: any,
    files: ProjectFile[],
    environment: "preview" | "production",
  ) {
    await this.live(b);
    const listed = await this.vercel(
      "/v7/deployments?projectId=" +
        encodeURIComponent(p.projectId) +
        "&limit=20&target=" +
        environment,
    );
    const existing = listed.deployments?.find(
      (d: any) =>
        d.meta?.frocBuildId === b.id &&
        d.meta?.frocArtifactDigest === sourceDigest(files) &&
        !["ERROR", "CANCELED", "BLOCKED"].includes(d.readyState || d.state),
    );
    if (existing) return { id: existing.uid || existing.id };
    const variables = await this.vault.resolve(b, environment);
    const defs = b.bundle!.variables.filter(
      (v) => v.environment === environment || v.environment === "both",
    );
    const entries = defs.map((v) => ({
      key: v.name,
      value: variables[v.name],
      type: "encrypted",
      target: [environment],
    }));
    entries.push({
      key: "FROC_DEPLOYMENT_ENVIRONMENT",
      value: environment,
      type: "encrypted",
      target: [environment],
    });
    await this.vercel(
      "/v10/projects/" + encodeURIComponent(p.projectId) + "/env?upsert=true",
      "POST",
      entries,
    );
    const created = await this.vercel("/v13/deployments", "POST", {
      name: p.projectName,
      project: p.projectId,
      ...(environment === "production" ? { target: "production" } : {}),
      files: files.map((f) => ({
        file: f.path,
        data: Buffer.from(f.content).toString("base64"),
        encoding: "base64",
      })),
      projectSettings: {
        framework: "vite",
        nodeVersion: "22.x",
        buildCommand: "npm run build",
        outputDirectory: "dist",
      },
      meta: { frocBuildId: b.id, frocArtifactDigest: sourceDigest(files) },
    });
    if (typeof created.id !== "string")
      throw new FactoryError(
        "deployment_id_missing",
        "A Vercel não retornou o identificador da publicação.",
      );
    return created;
  }
  private async deployment(
    id: string,
    p: any,
    digest: string,
    production = false,
  ) {
    const d = await this.vercel("/v13/deployments/" + encodeURIComponent(id));
    if (
      d.projectId !== p.projectId ||
      d.meta?.frocArtifactDigest !== digest ||
      d.meta?.frocBuildId !== p.buildId ||
      (production && d.target !== "production")
    )
      throw new FactoryError(
        "deployment_binding_invalid",
        "O deployment não corresponde ao projeto certificado.",
      );
    if (["ERROR", "CANCELED", "BLOCKED"].includes(d.readyState))
      throw new FactoryError(
        "deployment_failed",
        "A Vercel reprovou o build do projeto.",
      );
    if (
      d.readyState === "READY" &&
      (typeof d.url !== "string" || !d.url.endsWith(".vercel.app"))
    )
      throw new FactoryError(
        "deployment_url_invalid",
        "URL de deployment inválida.",
      );
    return d;
  }
  private async browser(
    b: ProfessionalBuild,
    p: any,
    files: ProjectFile[],
    environment: "preview" | "production",
    url: string,
    previous: any,
  ) {
    const all = await this.vault.resolve(b, environment);
    const testVariables = Object.fromEntries(
      Object.entries(all).filter(([name]) => /^TEST_/.test(name)),
    );
    const result = await this.worker(previous, {
      kind: "browser",
      artifactDigest: sourceDigest(files),
      releaseDigest: sourceDigest(b.bundle!.files),
      url,
      environment,
      publicPages: b.bundle!.publicPages,
      journeys: b.bundle!.journeys,
      integrations: b.bundle!.integrations,
      testVariables,
    });
    if (result.status === "passed") {
      const expected = [
        ...b.bundle!.publicPages.flatMap((path) =>
          [360, 768, 1440].map((width) => "page:" + path + ":" + width),
        ),
        "consent",
        "links",
        ...b
          .bundle!.journeys.filter(
            (j) => j.environment === "both" || j.environment === environment,
          )
          .map((j) => j.id),
        ...b.bundle!.integrations.map((i) => "integration:" + i.name),
      ];
      if (
        !Array.isArray(result.results) ||
        expected.some(
          (id) =>
            result.results.filter((r: any) => r.id === id && r.passed === true)
              .length !== 1,
        )
      )
        throw new FactoryError(
          "browser_coverage_incomplete",
          "O executor não comprovou todas as jornadas e tamanhos de tela.",
        );
    }
    return result;
  }
  async paymentCheck(b: ProfessionalBuild) {
    if (!b.bundle!.payments.required) return { required: false };
    const sandbox = await this.vault.resolve(b, "preview"),
      production = await this.vault.resolve(b, "production");
    if (b.bundle!.payments.provider === "stripe") {
      const test = sandbox.STRIPE_SECRET_KEY,
        live = production.STRIPE_SECRET_KEY;
      if (!/^sk_test_/.test(test || "") || !/^sk_live_/.test(live || ""))
        throw new FactoryError(
          "payment_environment_invalid",
          "Configure STRIPE_SECRET_KEY de teste e produção em ambientes separados.",
        );
      let id = sandbox.TEST_PAYMENT_ID;
      if (!id) {
        const created = await this.request(
          "https://api.stripe.com/v1/payment_intents",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + test,
              "Content-Type": "application/x-www-form-urlencoded",
              "Idempotency-Key": "froc-sandbox-" + b.id,
            },
            body: new URLSearchParams({
              amount: "50",
              currency: b.bundle!.payments.currency.toLowerCase(),
              payment_method: "pm_card_visa",
              confirm: "true",
              "automatic_payment_methods[enabled]": "true",
              "automatic_payment_methods[allow_redirects]": "never",
            }).toString(),
            signal: AbortSignal.timeout(15000),
          },
        );
        const payment = await responseJson(created);
        if (!created.ok)
          throw new FactoryError(
            "sandbox_payment_failed",
            "A cobrança exclusivamente de teste não foi concluída pelo Stripe.",
          );
        id = payment.id;
      }
      if (!/^pi_[A-Za-z0-9]+$/.test(id || ""))
        throw new FactoryError(
          "sandbox_payment_required",
          "Identificador do pagamento de teste inválido.",
        );
      const response = await this.request(
        "https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(id),
        {
          headers: { Authorization: "Bearer " + test },
          signal: AbortSignal.timeout(15000),
        },
      );
      const receipt = await responseJson(response);
      if (
        !response.ok ||
        receipt.status !== "succeeded" ||
        receipt.livemode !== false ||
        String(receipt.currency).toUpperCase() !== b.bundle!.payments.currency
      )
        throw new FactoryError(
          "sandbox_payment_not_verified",
          "Não foi possível confirmar o pagamento de teste no provedor.",
        );
      const health = await this.request("https://api.stripe.com/v1/balance", {
        headers: { Authorization: "Bearer " + live },
        signal: AbortSignal.timeout(15000),
      });
      const balance = await responseJson(health);
      if (!health.ok || balance.livemode !== true)
        throw new FactoryError(
          "live_payment_not_configured",
          "A credencial de produção de pagamentos não foi confirmada.",
        );
      return {
        provider: "stripe",
        sandboxPaymentId: receipt.id,
        sandboxVerified: true,
        productionCredentialVerified: true,
      };
    }
    const test = sandbox.MERCADO_PAGO_ACCESS_TOKEN,
      live = production.MERCADO_PAGO_ACCESS_TOKEN,
      id = sandbox.TEST_PAYMENT_ID;
    if (!test || !live || test === live || !/^\d+$/.test(id || ""))
      throw new FactoryError(
        "sandbox_payment_required",
        "Configure contas de teste/produção separadas e TEST_PAYMENT_ID do Mercado Pago.",
      );
    const response = await this.request(
      "https://api.mercadopago.com/v1/payments/" + id,
      {
        headers: { Authorization: "Bearer " + test },
        signal: AbortSignal.timeout(15000),
      },
    );
    const receipt = await responseJson(response);
    if (
      !response.ok ||
      receipt.status !== "approved" ||
      receipt.live_mode !== false ||
      receipt.currency_id !== b.bundle!.payments.currency
    )
      throw new FactoryError(
        "sandbox_payment_not_verified",
        "Pagamento de teste não confirmado no Mercado Pago.",
      );
    const health = await this.request("https://api.mercadopago.com/users/me", {
      headers: { Authorization: "Bearer " + live },
      signal: AbortSignal.timeout(15000),
    });
    const account = await responseJson(health);
    if (!health.ok || !account.id || account.tags?.includes("test_user"))
      throw new FactoryError(
        "live_payment_not_configured",
        "Conta de produção de pagamentos não confirmada.",
      );
    return {
      provider: "mercado-pago",
      sandboxPaymentId: String(receipt.id),
      sandboxVerified: true,
      productionCredentialVerified: true,
    };
  }
  async publish(b: ProfessionalBuild, files: ProjectFile[]) {
    if (
      b.certificate?.status !== "passed" ||
      b.certificate.artifactDigest !== sourceDigest(files)
    )
      throw new FactoryError(
        "certification_required",
        "A publicação exige certificação do artefato exato.",
      );
    let p = b.publication
      ? structuredClone(b.publication)
      : {
          status: "running",
          buildId: b.id,
          projectName: managedProjectName(key(b)),
          artifactDigest: sourceDigest(files),
        };
    if (p.artifactDigest !== sourceDigest(files))
      throw new FactoryError(
        "publication_artifact_changed",
        "O código mudou após iniciar a publicação.",
      );
    try {
      if (!p.projectId) {
        let project;
        let created = false;
        try {
          project = await this.vercel("/v9/projects/" + p.projectName);
        } catch (e) {
          if ((e as any).httpStatus !== 404) throw e;
          project = await this.vercel("/v10/projects", "POST", {
            name: p.projectName,
            framework: "vite",
          });
          created = true;
        }
        if (project.name !== p.projectName || !project.id)
          throw new FactoryError(
            "project_binding_invalid",
            "O projeto Vercel não corresponde à solicitação.",
          );
        if (created)
          await this.vercel(
            "/v9/projects/" + encodeURIComponent(project.id),
            "PATCH",
            { ssoProtection: null },
          );
        p.projectId = project.id;
        p.previousDeploymentId = project.targets?.production?.id || null;
        return p;
      }
      if (!p.previewId) {
        const d = await this.deploy(b, p, files, "preview");
        p.previewId = d.id;
        return p;
      }
      const preview = await this.deployment(
        p.previewId,
        p,
        sourceDigest(files),
      );
      if (preview.readyState !== "READY") return p;
      p.previewUrl = "https://" + preview.url;
      if (p.previewBrowser?.status !== "passed") {
        p.previewBrowser = await this.browser(
          b,
          p,
          files,
          "preview",
          p.previewUrl,
          p.previewBrowser,
        );
        if (p.previewBrowser.status === "failed")
          return {
            ...p,
            status: "failed",
            message: "A prévia foi reprovada nas jornadas de navegador.",
          };
        return p;
      }
      if (!p.paymentProof) {
        p.paymentProof = await this.paymentCheck(b);
        return p;
      }
      if (!p.productionId) {
        const current = await this.vercel("/v9/projects/" + p.projectId);
        if (
          (current.targets?.production?.id || null) !== p.previousDeploymentId
        ) {
          const recovered = await this.deployment(
            current.targets.production.id,
            p,
            sourceDigest(files),
            true,
          );
          p.productionId = recovered.id;
          return p;
        }
        const d = await this.deploy(b, p, files, "production");
        p.productionId = d.id;
        await this.live(b);
        return p;
      }
      const production = await this.deployment(
        p.productionId,
        p,
        sourceDigest(files),
        true,
      );
      if (production.readyState !== "READY") return p;
      p.productionUrl = "https://" + production.url;
      if (p.productionBrowser?.status !== "passed") {
        p.productionBrowser = await this.browser(
          b,
          p,
          files,
          "production",
          p.productionUrl,
          p.productionBrowser,
        );
        if (p.productionBrowser.status === "failed")
          throw new FactoryError(
            "production_browser_failed",
            "A versão de produção foi reprovada nas jornadas.",
          );
        return p;
      }
      const values = await this.vault.resolve(b, "production", true);
      const canonical = new URL(values.PUBLIC_SITE_URL);
      if (
        canonical.protocol !== "https:" ||
        canonical.username ||
        canonical.password ||
        canonical.port ||
        canonical.pathname !== "/" ||
        canonical.search ||
        canonical.hash
      )
        throw new FactoryError(
          "canonical_invalid",
          "A URL final precisa ser uma origem HTTPS válida.",
        );
      const aliases = await this.vercel(
        "/v2/deployments/" + encodeURIComponent(p.productionId) + "/aliases",
      );
      if (!aliases.aliases?.some((a: any) => a.alias === canonical.hostname))
        throw new FactoryError(
          "domain_not_confirmed",
          "O domínio final ainda não está associado a este deployment na Vercel.",
        );
      p.url = canonical.origin;
      if (!p.indexing) {
        try {
          const indexKey = sha(key(b));
          const ack = await this.request("https://api.indexnow.org/indexnow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              host: canonical.hostname,
              key: indexKey,
              keyLocation: canonical.origin + "/" + indexKey + ".txt",
              urlList: b.bundle!.publicPages.map(
                (path) => canonical.origin + path,
              ),
            }),
            signal: AbortSignal.timeout(15000),
          });
          p.indexing = {
            status: ack.ok ? "submitted" : "not_accepted",
            httpStatus: ack.status,
            guaranteesIndexing: false,
          };
        } catch {
          p.indexing = {
            status: "provider_unavailable",
            guaranteesIndexing: false,
          };
        }
        const all = await this.vault.resolve(b, "production");
        if (all.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN) {
          try {
            const r = await this.request(
              "https://www.googleapis.com/webmasters/v3/sites/" +
                encodeURIComponent(canonical.origin + "/") +
                "/sitemaps/" +
                encodeURIComponent(canonical.origin + "/sitemap.xml"),
              {
                method: "PUT",
                headers: {
                  Authorization:
                    "Bearer " + all.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN,
                },
                signal: AbortSignal.timeout(15000),
              },
            );
            p.searchConsole = {
              status: r.ok ? "submitted" : "not_accepted",
              httpStatus: r.status,
            };
          } catch {
            p.searchConsole = { status: "provider_unavailable" };
          }
        }
      }
      return { ...p, status: "ready", verifiedAt: new Date().toISOString() };
    } catch (error) {
      if (p.productionId) {
        try {
          p.rollback = await this.cancel({ ...b, publication: p });
        } catch {
          p.rollback = {
            verified: false,
            message: "A restauração automática não foi confirmada.",
          };
        }
        return {
          ...p,
          status: "failed",
          message:
            error instanceof FactoryError
              ? error.message
              : "A publicação não foi concluída; consulte o estado de recuperação.",
        };
      }
      throw error;
    }
  }
}
