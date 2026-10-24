import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  data: new Map<string, any>(),
  configured: true,
}));
vi.mock("../server/lib/firebaseAdmin.js", () => {
  const ref = (collection: string, id: string) => ({
    key: collection + "/" + id,
    get: async () => {
      const data = state.data.get(collection + "/" + id);
      return { exists: Boolean(data), data: () => data };
    },
  });
  return {
    isFirebaseAdminConfigured: () => state.configured,
    adminDb: {
      collection: (name: string) => ({ doc: (id: string) => ref(name, id) }),
      runTransaction: async (fn: any) =>
        fn({
          get: (r: any) => r.get(),
          set: (r: any, data: any) =>
            state.data.set(r.key, structuredClone(data)),
        }),
    },
  };
});
vi.mock("../server/middlewares/requireAuth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user"])
      return res.status(401).json({ error: { code: "unauthenticated" } });
    req.user = {
      uid: req.headers["x-test-user"],
      tenantId: req.headers["x-test-tenant"] || "tenant-a",
      role: "user",
    };
    next();
  },
}));
vi.mock("../server/middlewares/rateLimiter.js", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../server/services/featureFlagService.js", () => ({
  FeatureFlagService: { assertEnabled: vi.fn(async () => {}) },
  FeatureFlagDisabledError: class extends Error {},
}));
vi.mock("../server/services/creditWalletService.js", () => ({
  CreditWalletService: {
    reserveCredits: vi.fn(async () => ({ reservationId: "reserve-1" })),
    confirmConsumption: vi.fn(async () => ({})),
    releaseReservation: vi.fn(async () => ({})),
  },
  InsufficientCreditsError: class extends Error {},
}));
vi.mock("../server/ai/geminiFailoverService.js", () => ({
  configuredGeminiFailoverChain: (m: string) => [m],
  GeminiFailoverService: { generate: vi.fn() },
}));
import { env } from "../server/config/env.js";
import { projectVariableRouter } from "../server/routes/projectVariableRoutes.js";
import { siteBuilderRouter } from "../server/routes/siteBuilderRoutes.js";
import { GeminiFailoverService } from "../server/ai/geminiFailoverService.js";
import { CREATION_AGENTS } from "../shared/advancedAgentCatalog.js";
const app = express();
app.use(express.json());
app.use("/variables", projectVariableRouter);
app.use("/api", siteBuilderRouter);
const authenticated = (r: any) =>
  r.set("x-test-user", "owner-a").set("x-test-tenant", "tenant-a");

describe("advanced factory HTTP integration", () => {
  beforeEach(() => {
    state.data.clear();
    state.configured = true;
    vi.clearAllMocks();
    state.data.set("projects/project-a", {
      userId: "owner-a",
      tenantId: "tenant-a",
    });
    env.MEMORY_ENCRYPTION_KEY = "test-encryption-key-only";
  });
  it("requires authenticated ownership and tenant before reading or writing variables", async () => {
    expect((await request(app).get("/variables/project-a")).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/variables/project-a")
          .set("x-test-user", "another-owner")
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get("/variables/project-a")
          .set("x-test-user", "owner-a")
          .set("x-test-tenant", "tenant-b")
      ).status,
    ).toBe(404);
    const response = await authenticated(
      request(app).get("/variables/project-a"),
    );
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ revision: 0, variables: [] });
  });
  it("masks secrets, prevents stale overwrites and does not echo invalid secret input", async () => {
    const variables = [
      {
        name: "PAYMENT_TOKEN",
        purpose: "Processador de pagamento",
        visibility: "secret",
        environment: "preview",
        value: "super-private-test",
      },
    ];
    const saved = await authenticated(
      request(app).put("/variables/project-a"),
    ).send({ revision: 0, variables });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain("super-private-test");
    expect(saved.body.variables[0]).toMatchObject({ configured: true });
    expect(
      (
        await authenticated(request(app).put("/variables/project-a")).send({
          revision: 0,
          variables,
        })
      ).status,
    ).toBe(409);
    const bad = await authenticated(
      request(app).put("/variables/project-a"),
    ).send({
      revision: 1,
      variables: [{ ...variables[0], visibility: "public" }],
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain("super-private-test");
    expect(JSON.stringify([...state.data.values()])).not.toContain(
      "super-private-test",
    );
  });
  it("sends all 50 creation profiles into the actual generation request and keeps delivery unverified", async () => {
    const html =
      '<!DOCTYPE html><html lang="pt-BR"><head><title>Projeto</title></head><body><button>Detalhes</button><script>document.querySelector("button").addEventListener("click",()=>{document.body.dataset.open="true"})</script></body></html>';
    vi.mocked(GeminiFailoverService.generate).mockResolvedValue({
      model: env.GEMINI_DEFAULT_MODEL,
      fallbackUsed: false,
      attemptedModels: [env.GEMINI_DEFAULT_MODEL],
      response: {
        text: JSON.stringify({
          siteTitle: "Projeto",
          description: "Projeto completo",
          html,
          suggestedRefinements: [],
        }),
        inputTokens: 10,
        outputTokens: 20,
      },
    });
    const generated = await authenticated(
      request(app).post("/api/generate-site"),
    ).send({
      prompt: "Crie uma página institucional com detalhes do serviço.",
    });
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    const options = vi.mocked(GeminiFailoverService.generate).mock.calls[0][0];
    for (const agent of CREATION_AGENTS)
      expect(options.systemInstruction).toContain(agent.id);
    expect(generated.body.delivery.productionReady).toBe(false);
    expect(generated.body.delivery.appliedProfileIds).toHaveLength(50);
    expect(
      generated.body.delivery.checklist.every(
        (g: any) => g.status === "pending",
      ),
    ).toBe(true);
  });
});
