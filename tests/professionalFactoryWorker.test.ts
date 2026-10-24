import { describe, expect, it } from "vitest";
import {
  validateFactoryFiles,
  certifyFactory,
  browseFactory,
} from "../worker/professional-factory.mjs";
import { sourceDigest } from "../server/siteFactory/professionalContract.js";
import { scaffoldProject } from "../server/siteFactory/professionalScaffold.js";
import { fixtureBundle } from "./helpers/professionalFactoryFixture.js";
const files = scaffoldProject(fixtureBundle(), "scope").files;
const body = () => ({
  files,
  artifactDigest: sourceDigest(files),
  nonce: "12345678901234567890",
});
describe("isolated professional factory worker", () => {
  it("rejects traversal, duplicates, secret files and tampered artifacts before execution", () => {
    expect(() => validateFactoryFiles(body())).not.toThrow();
    for (const path of [
      "../outside",
      "/tmp/outside",
      ".env",
      "node_modules/attack.js",
      "x\\y.js",
    ]) {
      const entries = [...files, { path, content: "no" }];
      expect(() =>
        validateFactoryFiles({
          ...body(),
          files: entries,
          artifactDigest: sourceDigest(entries),
        }),
      ).toThrow();
    }
    expect(() =>
      validateFactoryFiles({ ...body(), artifactDigest: "a".repeat(64) }),
    ).toThrow();
  });
  it("runs installation, types, unit tests, build, browser and audit as isolated commands without inherited secrets", async () => {
    const calls: any[] = [];
    const result = await certifyFactory(
      body(),
      async (
        command: string,
        args: string[],
        cwd: string,
        timeout: number,
        extra: any,
        isolated: boolean,
      ) => {
        calls.push({ command, args, cwd, timeout, extra, isolated });
        return {
          exitCode: 0,
          stdout: Buffer.from("ok"),
          stderr: Buffer.from(""),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      },
      async () => {},
    );
    expect(result.status).toBe("passed");
    expect(result.commands.map((c: any) => c.id)).toEqual([
      "install",
      "typecheck",
      "unit",
      "build",
      "browser",
      "dependencies",
    ]);
    expect(
      calls.every(
        (c) =>
          c.isolated &&
          Object.keys(c.extra).length === 0 &&
          c.timeout <= 180000,
      ),
    ).toBe(true);
  });
  it("stops at the first failed executable command rather than certifying later steps", async () => {
    let calls = 0;
    const result = await certifyFactory(
      body(),
      async () => {
        calls++;
        return {
          exitCode: calls === 2 ? 1 : 0,
          stdout: Buffer.from(""),
          stderr: Buffer.from("types failed"),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      },
      async () => {},
    );
    expect(result.status).toBe("failed");
    expect(calls).toBe(2);
    expect(result.commands.at(-1).id).toBe("typecheck");
  });
  it("does not launch a browser for private hosts, arbitrary origins, credentials or HTTP", async () => {
    for (const url of [
      "http://localhost",
      "https://127.0.0.1",
      "https://example.com",
      "https://site.vercel.app.evil.com",
      "https://user:pass@site.vercel.app",
    ])
      await expect(
        browseFactory({ url }, {} as any, {} as any),
      ).rejects.toThrow();
  });
});

describe("stable artifact binding", () => {
  it("keeps the same digest when Firestore changes map-key ordering", () => {
    const reversed = files.map((f) => ({ content: f.content, path: f.path }));
    expect(sourceDigest(reversed)).toBe(sourceDigest(files));
    expect(() =>
      validateFactoryFiles({ ...body(), files: reversed }),
    ).not.toThrow();
  });
});
