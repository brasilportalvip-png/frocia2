import { beforeEach, describe, expect, it, vi } from "vitest";
import { FACTORY_STAGES } from "../shared/advancedAgentCatalog.js";
import {
  InMemoryBuildRepository,
  ProfessionalBuildService,
  type FactoryAdapter,
  type FactoryModel,
} from "../server/siteFactory/professionalBuildService.js";
import {
  InMemoryVariableRepository,
  ProjectVariableService,
} from "../server/siteFactory/projectVariableService.js";
import { env } from "../server/config/env.js";
import {
  sourceDigest,
  parseBundle,
} from "../server/siteFactory/professionalContract.js";
import { scaffoldProject } from "../server/siteFactory/professionalScaffold.js";
import {
  fixtureBundle,
  stageReport,
} from "./helpers/professionalFactoryFixture.js";
const scope = {
  projectId: "project-a",
  tenantId: "tenant-a",
  userId: "owner-a",
};
function setup() {
  const repo = new InMemoryBuildRepository(),
    vault = new ProjectVariableService(new InMemoryVariableRepository());
  let planning = 0;
  const model: FactoryModel = {
    generate: vi.fn(async (options) => {
      if (
        typeof options.userMessage !== "string" ||
        typeof options.maxOutputTokens !== "number"
      )
        throw new Error("invalid model invocation");
      let value;
      if (options.systemInstruction.includes("Cada perfil precisa"))
        value = stageReport(FACTORY_STAGES[planning++ % 10].id);
      else if (options.systemInstruction.startsWith("Revise independentemente"))
        value = { passed: true, issues: [] };
      else value = fixtureBundle();
      return {
        text: JSON.stringify(value),
        model: "configured-test-model",
        inputTokens: 100,
        outputTokens: 100,
      };
    }),
  };
  const confirmed = new Set<string>();
  const wallet = {
    reserveCredits: vi.fn(async ({ idempotencyKey }: any) => ({
      reservationId: idempotencyKey,
    })),
    confirmConsumption: vi.fn(async ({ idempotencyKey }: any) => {
      confirmed.add(idempotencyKey);
    }),
    releaseReservation: vi.fn(async () => {}),
  };
  const adapter: FactoryAdapter = {
    certify: vi.fn(async (_b, files) => ({
      status: "passed",
      artifactDigest: sourceDigest(files),
      commands: [],
    })),
    publish: vi.fn(async () => ({
      status: "ready",
      url: "https://project-test.vercel.app",
      verifiedAt: new Date().toISOString(),
    })),
    media: vi.fn(async () => ({ complete: true, assets: [] })),
  };
  const service = new ProfessionalBuildService(
    repo,
    adapter,
    vault,
    model,
    wallet as any,
  );
  return { service, repo, vault, adapter, model, wallet, confirmed };
}
async function planned(s: ReturnType<typeof setup>) {
  const b = await s.service.start(
    scope,
    { prompt: "Crie uma calculadora de orçamento profissional." },
    "request-123456",
  );
  for (let i = 0; i < 12; i++) await s.service.advance(b.id, scope);
  return s.service.get(b.id, scope);
}
async function configured(s: ReturnType<typeof setup>) {
  const b = await planned(s);
  await s.vault.save(
    scope,
    0,
    b.bundle!.variables.map((v) => ({
      ...v,
      value:
        v.name === "PUBLIC_CONTACT_EMAIL"
          ? "owner@example.com"
          : v.name === "PUBLIC_SITE_URL"
            ? "https://project-test.vercel.app"
            : "Empresa de teste",
    })),
  );
  return b;
}
beforeEach(() => {
  env.MEMORY_ENCRYPTION_KEY = "factory-tests-encryption-key";
});
describe("professional build durable lifecycle", () => {
  it("executes ten disciplines with five recorded experts each, preserving all 50 identities", async () => {
    const s = setup(),
      b = await planned(s);
    expect(b.phase).toBe(12);
    expect(b.reports).toHaveLength(10);
    expect(
      new Set(b.reports.flatMap((r) => r.contributions.map((c) => c.agentId)))
        .size,
    ).toBe(50);
    expect(s.model.generate).toHaveBeenCalledTimes(12);
    expect(b.consumedCredits).toBe(45);
    expect(b.status).not.toBe("ready");
  });
  it("blocks missing configuration and proceeds through certification before publishing", async () => {
    const s = setup();
    const b = await planned(s);
    const missing = await s.service.advance(b.id, scope);
    expect(missing.status).toBe("configuration_required");
    expect(s.adapter.certify).not.toHaveBeenCalled();
    await s.vault.save(
      scope,
      0,
      missing.bundle!.variables.map((v) => ({
        ...v,
        value:
          v.name === "PUBLIC_CONTACT_EMAIL"
            ? "owner@example.com"
            : v.name === "PUBLIC_SITE_URL"
              ? "https://project-test.vercel.app"
              : "Empresa",
      })),
    );
    await s.service.advance(b.id, scope);
    expect((await s.service.advance(b.id, scope)).phase).toBe(14);
    expect(s.adapter.publish).not.toHaveBeenCalled();
    expect((await s.service.advance(b.id, scope)).status).toBe("ready");
  });
  it("deduplicates starts and rejects reused requests with different prompts or cross-tenant reads", async () => {
    const s = setup();
    const a = await s.service.start(
      scope,
      { prompt: "Crie um portal institucional completo." },
      "request-dedup",
    );
    const b = await s.service.start(
      scope,
      { prompt: "Crie um portal institucional completo." },
      "request-dedup",
    );
    expect(a.id).toBe(b.id);
    await expect(
      s.service.start(
        scope,
        { prompt: "Crie outro sistema completamente diferente." },
        "request-dedup",
      ),
    ).rejects.toThrow("já foi usada");
    await expect(
      s.service.get(a.id, { ...scope, tenantId: "other" }),
    ).rejects.toThrow("não encontrado");
  });
  it("recovers truncated JSON without certifying it or consuming credits for the failed result", async () => {
    const s = setup();
    const b = await s.service.start(
      scope,
      { prompt: "Crie um portal institucional completo." },
      "request-bad-json",
    );
    vi.mocked(s.model.generate).mockResolvedValueOnce({
      text: '{"contributions":["unfinished',
      model: "test",
      inputTokens: 10,
      outputTokens: 10,
    });
    const failed = await s.service.advance(b.id, scope);
    expect(failed.phase).toBe(0);
    expect(failed.status).toBe("planning");
    expect(s.wallet.releaseReservation).toHaveBeenCalledTimes(1);
    expect(s.wallet.confirmConsumption).not.toHaveBeenCalled();
    expect(s.adapter.certify).not.toHaveBeenCalled();
  });
  it("retries pending billing without repeating a completed model operation", async () => {
    const s = setup();
    const b = await s.service.start(
      scope,
      { prompt: "Crie um portal institucional completo." },
      "request-billing",
    );
    vi.mocked(s.wallet.confirmConsumption).mockRejectedValueOnce(
      new Error("wallet temporarily unavailable"),
    );
    const failed = await s.service.advance(b.id, scope);
    expect(failed.phase).toBe(1);
    expect(failed.pendingBilling).not.toBeNull();
    expect(s.model.generate).toHaveBeenCalledTimes(1);
    await s.service.resume(b.id, scope);
    expect(s.model.generate).toHaveBeenCalledTimes(2);
    expect((await s.service.get(b.id, scope)).consumedCredits).toBe(4);
  });
  it("prevents parallel stage execution and discards results after cancellation", async () => {
    const s = setup();
    const b = await s.service.start(
      scope,
      { prompt: "Crie um portal institucional completo." },
      "request-concurrent",
    );
    let complete: any;
    vi.mocked(s.model.generate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const running = s.service.advance(b.id, scope);
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    await s.service.advance(b.id, scope);
    expect(s.model.generate).toHaveBeenCalledTimes(1);
    await s.service.cancel(b.id, scope);
    complete({
      text: JSON.stringify(stageReport("discovery")),
      model: "test",
      inputTokens: 10,
      outputTokens: 10,
    });
    await running;
    expect((await s.service.get(b.id, scope)).status).toBe("cancelled");
    expect(s.wallet.confirmConsumption).not.toHaveBeenCalled();
  });
  it("does not send configured secrets to the model or put them in exported source", async () => {
    const s = setup();
    await s.vault.save(scope, 0, [
      {
        name: "EXTERNAL_SECRET",
        purpose: "Credencial externa",
        visibility: "secret",
        environment: "both",
        value: "private-value-never-in-model",
      },
    ]);
    const b = await planned(s);
    expect(
      JSON.stringify(vi.mocked(s.model.generate).mock.calls),
    ).not.toContain("private-value-never-in-model");
    expect(JSON.stringify(s.service.files(b))).not.toContain(
      "private-value-never-in-model",
    );
  });
  it("regenerates code after failed executable certification within the repair budget", async () => {
    const s = setup();
    const b = await configured(s);
    await s.service.advance(b.id, scope);
    vi.mocked(s.adapter.certify).mockResolvedValueOnce({
      status: "failed",
      message: "unit tests failed",
      diagnostic: "Expected quantity validation",
    });
    const repaired = await s.service.advance(b.id, scope);
    expect(repaired.phase).toBe(10);
    expect(repaired.repairs).toBe(1);
    expect(repaired.feedback).toContain("Expected quantity validation");
    expect(s.adapter.publish).not.toHaveBeenCalled();
  });
  it("scaffolds real legal, consent, sitemap, robots and runtime public configuration without secrets", () => {
    const bundle = fixtureBundle();
    const result = scaffoldProject(bundle, "scope");
    const files = new Map(result.files.map((f) => [f.path, f.content]));
    for (const p of [
      "api/froc-public-config.ts",
      "api/froc-sitemap.ts",
      "api/froc-robots.ts",
      "public/legal/privacy.html",
      "public/legal/terms.html",
      "public/legal/cookies.html",
      "public/froc-consent.js",
      "package-lock.json",
      "tests/froc-browser.spec.ts",
    ])
      expect(files.has(p)).toBe(true);
    expect(files.get("public/froc-consent.js")).toContain("Rejeitar opcionais");
    expect(files.get("public/froc-consent.js")).toContain("Personalizar");
    expect(files.get("public/froc-consent.js")).toContain("location.reload()");
    expect(files.get("api/froc-public-config.ts")).not.toContain("SECRET");
  });
  it("rejects path traversal, secret literals, missing backend and false requirement coverage", () => {
    for (const change of [
      (b: any) => (b.files[0].path = "../outside.ts"),
      (b: any) => (b.files[1].content += "sk_live_1234567890"),
      (b: any) => (b.productType = "web-application"),
      (b: any) => (b.requirements[0].journeyIds = ["not-a-real-journey"]),
    ]) {
      const b = fixtureBundle();
      change(b);
      expect(() => parseBundle(JSON.stringify(b))).toThrow();
    }
  });
});

describe("professional configuration redeployment", () => {
  it("reuses the complete project but requires new certification and publication after configuration changes", async () => {
    const s = setup(),
      b = await configured(s);
    await s.service.advance(b.id, scope);
    await s.service.advance(b.id, scope);
    await s.service.advance(b.id, scope);
    expect((await s.service.get(b.id, scope)).status).toBe("ready");
    const calls = vi.mocked(s.model.generate).mock.calls.length;
    const next = await s.service.reconfigure(
      b.id,
      scope,
      "reconfigure-new-values",
    );
    expect(next.id).not.toBe(b.id);
    expect(next.phase).toBe(12);
    expect(next.certificate).toBeNull();
    expect(next.publication).toBeNull();
    expect(next.bundle).toEqual(b.bundle);
    await s.service.advance(next.id, scope);
    await s.service.advance(next.id, scope);
    await s.service.advance(next.id, scope);
    expect((await s.service.get(next.id, scope)).status).toBe("ready");
    expect(s.model.generate).toHaveBeenCalledTimes(calls);
  });
});
