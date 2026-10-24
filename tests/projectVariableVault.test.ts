import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../server/config/env.js";
import {
  InMemoryVariableRepository,
  ProjectVariableService,
  projectVariableSchema,
} from "../server/siteFactory/projectVariableService.js";

const scope = {
  tenantId: "tenant-a",
  userId: "user-a",
  projectId: "project-a",
};
const secret = (value = "sk_test_abc123") => ({
  name: "PAYMENT_SECRET",
  purpose: "Conectar o pagamento de teste",
  visibility: "secret" as const,
  environment: "preview" as const,
  value,
});

describe("project variable encrypted vault", () => {
  beforeEach(() => {
    env.MEMORY_ENCRYPTION_KEY = "test-key-only-not-a-production-key";
  });
  it("encrypts at rest and never returns a saved secret to the client", async () => {
    const repo = new InMemoryVariableRepository();
    const vault = new ProjectVariableService(repo);
    const saved = await vault.save(scope, 0, [secret()]);
    expect(saved.variables[0]).toMatchObject({
      configured: true,
      name: "PAYMENT_SECRET",
    });
    expect(saved.variables[0]).not.toHaveProperty("value");
    expect(JSON.stringify([...repo.docs.values()])).not.toContain(
      "sk_test_abc123",
    );
    expect(await vault.resolve(scope, "preview")).toEqual({
      PAYMENT_SECRET: "sk_test_abc123",
    });
    expect(await vault.resolve(scope, "production")).toEqual({});
    expect(await vault.resolve(scope, "preview", true)).toEqual({});
  });
  it("isolates users, tenants and projects, including tampered encrypted documents", async () => {
    const repo = new InMemoryVariableRepository();
    const vault = new ProjectVariableService(repo);
    await vault.save(scope, 0, [secret()]);
    const copy = structuredClone([...repo.docs.values()][0]);
    for (const other of [
      { ...scope, tenantId: "tenant-b" },
      { ...scope, userId: "user-b" },
      { ...scope, projectId: "project-b" },
    ])
      expect((await vault.list(other)).variables).toEqual([]);
    await vault.save({ ...scope, projectId: "project-b" }, 0, [
      secret("another-secret"),
    ]);
    const keys = [...repo.docs.keys()];
    repo.docs.set(keys[1], copy);
    await expect(
      vault.list({ ...scope, projectId: "project-b" }),
    ).rejects.toThrow();
  });
  it("preserves masked secrets, rejects stale writes and does not promote them to public", async () => {
    const vault = new ProjectVariableService(new InMemoryVariableRepository());
    await vault.save(scope, 0, [secret()]);
    const { value, ...masked } = secret();
    await vault.save(scope, 1, [masked]);
    expect(await vault.resolve(scope, "preview")).toHaveProperty(
      "PAYMENT_SECRET",
      value,
    );
    await expect(vault.save(scope, 1, [secret("wrong")])).rejects.toThrow(
      "mudaram",
    );
    await expect(
      vault.save(scope, 2, [
        {
          name: "WELCOME",
          purpose: "Texto público",
          visibility: "public",
          environment: "both",
        },
      ]),
    ).rejects.toThrow("variable_value_required");
  });
  it("separates preview and production credentials and rejects overlaps", async () => {
    const vault = new ProjectVariableService(new InMemoryVariableRepository());
    await vault.save(scope, 0, [
      secret("sandbox"),
      { ...secret("live"), environment: "production" },
    ]);
    expect(await vault.resolve(scope, "preview")).toEqual({
      PAYMENT_SECRET: "sandbox",
    });
    expect(await vault.resolve(scope, "production")).toEqual({
      PAYMENT_SECRET: "live",
    });
    await expect(
      vault.save(scope, 1, [secret(), { ...secret(), environment: "both" }]),
    ).rejects.toThrow("overlapping_variable_environments");
  });
  it("rejects reserved names, secret exposure and missing encryption configuration", async () => {
    for (const name of [
      "GITHUB_TOKEN",
      "MEMORY_ENCRYPTION_KEY",
      "VERCEL_TOKEN",
      "NODE_OPTIONS",
      "PATH",
    ])
      expect(
        projectVariableSchema.safeParse({ ...secret(), name }).success,
      ).toBe(false);
    expect(
      projectVariableSchema.safeParse({
        ...secret(),
        name: "NEXT_PUBLIC_PAYMENT_SECRET",
      }).success,
    ).toBe(false);
    expect(
      projectVariableSchema.safeParse({ ...secret(), visibility: "public" })
        .success,
    ).toBe(false);
    expect(
      projectVariableSchema.safeParse({
        name: "WELCOME",
        purpose: "Texto público",
        environment: "both",
        visibility: "public",
        value: "sk_live_abc",
      }).success,
    ).toBe(false);
    env.MEMORY_ENCRYPTION_KEY = "";
    const repo = new InMemoryVariableRepository();
    await expect(
      new ProjectVariableService(repo).save(scope, 0, [secret()]),
    ).rejects.toThrow();
    expect(repo.docs.size).toBe(0);
  });
  it("handles concurrent writes without losing the first accepted change", async () => {
    const vault = new ProjectVariableService(new InMemoryVariableRepository());
    await vault.save(scope, 0, [secret()]);
    const results = await Promise.allSettled([
      vault.save(scope, 1, [secret("first")]),
      vault.save(scope, 1, [secret("second")]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await vault.list(scope)).revision).toBe(2);
  });
});

describe("variable visibility remains private across environments", () => {
  it("rejects a public preview name reused as a production secret", async () => {
    env.MEMORY_ENCRYPTION_KEY = "test-key";
    const vault = new ProjectVariableService(new InMemoryVariableRepository());
    await expect(
      vault.save(scope, 0, [
        {
          name: "ENDPOINT_CONFIG",
          purpose: "Público de teste",
          visibility: "public",
          environment: "preview",
          value: "https://example.com",
        },
        {
          name: "ENDPOINT_CONFIG",
          purpose: "Segredo de produção",
          visibility: "secret",
          environment: "production",
          value: "private-value",
        },
      ]),
    ).rejects.toThrow("visibility_mismatch");
  });
});
