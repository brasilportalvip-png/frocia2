import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  lease: { token: "test-lease", expires: Date.now() + 1000000 },
}));
vi.mock("../server/lib/firebaseAdmin.js", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: async () => ({
          data: () => ({ status: "publishing", lease: state.lease }),
        }),
      }),
    }),
  },
}));
vi.mock("../server/siteFactory/professionalMediaService.js", () => ({
  generateFactoryMedia: vi.fn(),
}));
import { ProfessionalAdapters } from "../server/siteFactory/professionalAdapters.js";
import {
  InMemoryVariableRepository,
  ProjectVariableService,
} from "../server/siteFactory/projectVariableService.js";
import { env } from "../server/config/env.js";
import { sourceDigest } from "../server/siteFactory/professionalContract.js";
import { scaffoldProject } from "../server/siteFactory/professionalScaffold.js";
import { fixtureBundle } from "./helpers/professionalFactoryFixture.js";
const signed = (body: any, valid = true) => {
  const raw = JSON.stringify(body);
  return new Response(raw, {
    headers: {
      "x-frocia-worker-signature": valid
        ? "sha256=" +
          createHmac("sha256", "test-signing-secret").update(raw).digest("hex")
        : "invalid",
    },
  });
};
const fixture = () =>
  ({
    id: "build-test",
    projectId: "project-test",
    tenantId: "tenant-test",
    userId: "owner-test",
    lease: state.lease,
    bundle: fixtureBundle(),
    certificate: null,
    publication: null,
  }) as any;
beforeEach(() => {
  env.MEMORY_ENCRYPTION_KEY = "adapter-test-encryption-key";
  process.env.SELF_EVOLUTION_WORKER_URL = "http://127.0.0.1:8080";
  process.env.SELF_EVOLUTION_WORKER_TOKEN = "test-worker-token";
  process.env.SELF_EVOLUTION_WORKER_SIGNING_SECRET = "test-signing-secret";
  process.env.VERCEL_TOKEN = "test-vercel-token";
  state.lease = { token: "test-lease", expires: Date.now() + 1000000 };
});
describe("professional delivery evidence adapters", () => {
  it("rejects an unsigned worker response", async () => {
    const b = fixture(),
      files = scaffoldProject(b.bundle, "scope").files;
    const adapter = new ProfessionalAdapters(undefined, async (_url, init) =>
      signed(
        {
          status: "passed",
          nonce: JSON.parse(String(init?.body)).nonce,
          artifactDigest: sourceDigest(files),
        },
        false,
      ),
    );
    await expect(adapter.certify(b, files)).rejects.toThrow("autenticar");
  });
  it("rejects a signed certificate with missing commands or wrong artifact", async () => {
    const b = fixture(),
      files = scaffoldProject(b.bundle, "scope").files;
    for (const wrong of [false, true]) {
      const adapter = new ProfessionalAdapters(undefined, async (_url, init) =>
        signed({
          status: "passed",
          nonce: JSON.parse(String(init?.body)).nonce,
          artifactDigest: wrong ? "f".repeat(64) : sourceDigest(files),
          commands: [],
        }),
      );
      await expect(adapter.certify(b, files)).rejects.toThrow();
    }
  });
  it("does not publish a changed artifact or an uncertified project", async () => {
    const b = fixture(),
      files = scaffoldProject(b.bundle, "scope").files;
    const call = vi.fn();
    const adapter = new ProfessionalAdapters(undefined, call as any);
    await expect(adapter.publish(b, files)).rejects.toThrow("certificação");
    b.certificate = { status: "passed", artifactDigest: "0".repeat(64) };
    await expect(adapter.publish(b, files)).rejects.toThrow("certificação");
    expect(call).not.toHaveBeenCalled();
  });
  it("accepts only complete signed installation/test/build/browser evidence", async () => {
    const b = fixture(),
      files = scaffoldProject(b.bundle, "scope").files;
    const adapter = new ProfessionalAdapters(undefined, async (_url, init) =>
      signed({
        status: "passed",
        nonce: JSON.parse(String(init?.body)).nonce,
        artifactDigest: sourceDigest(files),
        commands: [
          "install",
          "typecheck",
          "unit",
          "build",
          "browser",
          "dependencies",
        ].map((id) => ({
          id,
          exitCode: 0,
          stdoutSha256: "a".repeat(64),
          stderrSha256: "b".repeat(64),
        })),
      }),
    );
    expect((await adapter.certify(b, files)).status).toBe("passed");
  });
  it("validates sandbox payments through the provider and never sends a live charge", async () => {
    const vault = new ProjectVariableService(new InMemoryVariableRepository()),
      b = fixture();
    b.bundle.payments = { required: true, provider: "stripe", currency: "BRL" };
    await vault.save(b, 0, [
      {
        name: "STRIPE_SECRET_KEY",
        purpose: "Teste",
        visibility: "secret",
        environment: "preview",
        value: "sk_test_fake",
      },
      {
        name: "STRIPE_SECRET_KEY",
        purpose: "Produção",
        visibility: "secret",
        environment: "production",
        value: "sk_live_fake",
      },
    ]);
    const calls: any[] = [];
    const adapter = new ProfessionalAdapters(vault, async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/balance"))
        return Response.json({ livemode: true });
      if (init?.method === "POST") return Response.json({ id: "pi_sandbox" });
      return Response.json({
        id: "pi_sandbox",
        status: "succeeded",
        livemode: false,
        currency: "brl",
      });
    });
    const proof = await adapter.paymentCheck(b);
    expect(proof.sandboxVerified).toBe(true);
    const writes = calls.filter((c) => c.init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0].init.headers.Authorization).toBe("Bearer sk_test_fake");
    expect(writes[0].init.body).toContain("pm_card_visa");
    expect(
      calls
        .filter((c) => c.init.headers.Authorization === "Bearer sk_live_fake")
        .every((c) => !c.init.method),
    ).toBe(true);
  });
});

describe("preview and production publication protocol", () => {
  it("publishes only after preview checks and verifies production, aliases and indexing separately", async () => {
    const b = fixture(),
      files = scaffoldProject(b.bundle, "scope").files,
      digest = sourceDigest(files),
      vault = new ProjectVariableService(new InMemoryVariableRepository());
    const projectName =
      "froc-" +
      (await import("node:crypto"))
        .createHash("sha256")
        .update(JSON.stringify([b.tenantId, b.userId, b.projectId]))
        .digest("hex")
        .slice(0, 24);
    await vault.save(
      b,
      0,
      b.bundle.variables.map((v: any) => ({
        ...v,
        value:
          v.name === "PUBLIC_CONTACT_EMAIL"
            ? "owner@example.com"
            : v.name === "PUBLIC_SITE_URL"
              ? "https://" + projectName + ".vercel.app"
              : "Empresa de teste",
      })),
    );
    b.certificate = { status: "passed", artifactDigest: digest };
    const deployments = new Map<string, any>();
    const calls: any[] = [];
    const adapter = new ProfessionalAdapters(vault, async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("http://127.0.0.1:8080")) {
        const request = JSON.parse(String(init?.body));
        const ids = [
          ...b.bundle.publicPages.flatMap((p: string) =>
            [360, 768, 1440].map((w) => "page:" + p + ":" + w),
          ),
          "consent",
          "links",
          ...b.bundle.journeys.map((j: any) => j.id),
        ];
        return signed({
          status: "passed",
          nonce: request.nonce,
          artifactDigest: digest,
          results: ids.map((id) => ({ id, passed: true })),
        });
      }
      if (url.includes("/v7/deployments?"))
        return Response.json({ deployments: [] });
      if (url.includes("/v9/projects/"))
        return Response.json({
          id: "prj_test",
          name: projectName,
          targets: {},
        });
      if (url.includes("/env?")) return Response.json({ envs: [] });
      if (url.endsWith("/v13/deployments") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const id = body.target === "production" ? "dpl_prod" : "dpl_preview";
        const d = {
          id,
          projectId: "prj_test",
          meta: body.meta,
          url: id + ".vercel.app",
          target: body.target || null,
          readyState: "READY",
        };
        deployments.set(id, d);
        return Response.json(d);
      }
      if (url.includes("/v13/deployments/"))
        return Response.json(deployments.get(url.split("/").at(-1)!));
      if (url.endsWith("/aliases"))
        return Response.json({
          aliases: [{ alias: projectName + ".vercel.app" }],
        });
      if (url === "https://api.indexnow.org/indexnow")
        return new Response("", { status: 202 });
      throw new Error("Unexpected request " + url);
    });
    for (let i = 0; i < 10; i++) {
      b.publication = await adapter.publish(b, files);
      if (b.publication.status === "ready") break;
    }
    expect(b.publication.status).toBe("ready");
    expect(b.publication.previewBrowser.status).toBe("passed");
    expect(b.publication.productionBrowser.status).toBe("passed");
    expect(b.publication.indexing.status).toBe("submitted");
    const posts = calls.filter(
      (c) => c.url.endsWith("/v13/deployments") && c.init?.method === "POST",
    );
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[0].init.body).target).toBeUndefined();
    expect(JSON.parse(posts[1].init.body).target).toBe("production");
    const prodIndex = calls.findIndex((c) => c === posts[1]);
    expect(
      calls
        .slice(0, prodIndex)
        .some((c) => c.url.startsWith("http://127.0.0.1:8080")),
    ).toBe(true);
    const workerCalls = calls.filter((c) =>
      c.url.startsWith("http://127.0.0.1:8080"),
    );
    expect(
      workerCalls.every(
        (c) => !JSON.stringify(c).includes("test-vercel-token"),
      ),
    ).toBe(true);
  });
});

describe("bounded production recovery", () => {
  it("restores the previous deployment and checks the provider target before claiming rollback success", async () => {
    const b = fixture();
    b.publication = {
      projectId: "prj_test",
      productionId: "dpl_new",
      previousDeploymentId: "dpl_old",
    };
    let target = "dpl_new";
    const methods: any[] = [];
    const adapter = new ProfessionalAdapters(undefined, async (input, init) => {
      const url = String(input);
      methods.push({ url, method: init?.method });
      if (url.includes("/v13/deployments/"))
        return Response.json({
          projectId: "prj_test",
          meta: { frocBuildId: b.id },
          readyState: "READY",
        });
      if (url.includes("/rollback/")) {
        target = "dpl_old";
        return new Response("", { status: 201 });
      }
      return Response.json({ targets: { production: { id: target } } });
    });
    expect(await adapter.cancel(b)).toMatchObject({
      verified: true,
      deploymentId: "dpl_old",
    });
    expect(
      methods.some(
        (m) => m.url.includes("/rollback/dpl_old") && m.method === "POST",
      ),
    ).toBe(true);
  });
  it("does not roll back a newer deployment published outside this build", async () => {
    const b = fixture();
    b.publication = {
      projectId: "prj_test",
      productionId: "dpl_new",
      previousDeploymentId: "dpl_old",
    };
    const call = vi.fn(async (input: any, init: any) => {
      if (String(input).includes("/v13/deployments/"))
        return Response.json({
          projectId: "prj_test",
          meta: { frocBuildId: b.id },
          readyState: "READY",
        });
      return Response.json({
        targets: { production: { id: "dpl_other_newer" } },
      });
    });
    const adapter = new ProfessionalAdapters(undefined, call as any);
    expect(await adapter.cancel(b)).toMatchObject({
      verified: true,
      alreadyReplaced: true,
    });
    expect(
      call.mock.calls.every((c) => !c[1]?.method || c[1].method === "GET"),
    ).toBe(true);
  });
});
