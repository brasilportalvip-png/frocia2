import { beforeEach, describe, expect, it, vi } from "vitest";
import { FACTORY_STAGES } from "../shared/advancedAgentCatalog.js";
import {
  CHUNKED_FILES_PROTOCOL,
  CHUNKED_PLAN_PROTOCOL,
  FILE_BATCH_SIZE,
  PARALLEL_FILE_BATCHES,
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
import { sourceDigest, placeholderIn, fileProblem } from "../server/siteFactory/professionalContract.js";
import { describeBuildForChat } from "../server/siteFactory/factoryChatContext.js";
import { fixtureBundle, stageReport } from "./helpers/professionalFactoryFixture.js";

const scope = { projectId: "project-c", tenantId: "tenant-c", userId: "owner-c" };

/** Projeto com muitos arquivos, para exigir vários lotes. */
function bigBundle() {
  const base = fixtureBundle();
  const extra = Array.from({ length: 20 }, (_, i) => ({
    path: `src/parts/part${i}.ts`,
    content: `export const part${i} = ${i};`,
  }));
  return { ...base, files: [...base.files, ...extra] };
}

function setup(options: { chunked: boolean }) {
  const repo = new InMemoryBuildRepository();
  const vault = new ProjectVariableService(new InMemoryVariableRepository());
  const target = bigBundle();
  let planning = 0;
  const model: FactoryModel = {
    generate: vi.fn(async (input) => {
      let value: any;
      if (input.systemInstruction.includes("Cada perfil precisa"))
        value = stageReport(FACTORY_STAGES[planning++ % 10].id);
      else if (input.systemInstruction.startsWith("Revise independentemente"))
        value = { passed: true, issues: [] };
      else if (input.systemInstruction.includes(CHUNKED_PLAN_PROTOCOL)) {
        if (!options.chunked) value = target;
        else {
          const { files, ...meta } = target;
          value = {
            ...meta,
            fileManifest: files.map((f) => ({ path: f.path, purpose: "Arquivo " + f.path })),
          };
        }
      } else if (input.systemInstruction.includes(CHUNKED_FILES_PROTOCOL)) {
        const request = JSON.parse(input.userMessage);
        value = {
          files: request.writeNow.map((w: any) => target.files.find((f) => f.path === w.path)),
        };
      } else throw new Error("chamada inesperada");
      return { text: JSON.stringify(value), model: "m", inputTokens: 1, outputTokens: 1 };
    }),
  };
  const wallet = {
    reserveCredits: vi.fn(async ({ idempotencyKey }: any) => ({ reservationId: idempotencyKey })),
    confirmConsumption: vi.fn(async () => {}),
    releaseReservation: vi.fn(async () => {}),
  };
  const adapter: FactoryAdapter = {
    certify: vi.fn(async (_b, files) => ({ status: "passed", artifactDigest: sourceDigest(files), commands: [] })),
    publish: vi.fn(async () => ({ status: "ready", url: "https://x.vercel.app" })),
    media: vi.fn(async () => ({ complete: true, assets: [] })),
  };
  const service = new ProfessionalBuildService(repo, adapter, vault, model, wallet as any);
  return { service, repo, model, target };
}

beforeEach(() => {
  env.MEMORY_ENCRYPTION_KEY = "factory-tests-encryption-key";
});

describe("geração do projeto em partes (não estoura o tempo do servidor)", () => {
  it("planeja, escreve em lotes pequenos e monta o projeto completo", async () => {
    const s = setup({ chunked: true });
    const b = await s.service.start(scope, { prompt: "Crie um app de corridas como a Uber." }, "chunked-123456");
    for (let i = 0; i < 10; i++) await s.service.advance(b.id, scope);
    let current = await s.service.get(b.id, scope);
    expect(current.phase).toBe(10);

    // Plano: nenhuma chamada pede o projeto inteiro de uma vez.
    current = await s.service.advance(b.id, scope);
    expect(current.phase).toBe(10);
    expect(current.generation?.manifest.length).toBe(s.target.files.length);
    expect(current.generation?.files.length).toBe(0);
    const view = await s.service.publicView(current);
    expect(view.generation).toEqual({ planned: s.target.files.length, written: 0 });

    const perStep = FILE_BATCH_SIZE * PARALLEL_FILE_BATCHES;
    const steps = Math.ceil(s.target.files.length / perStep);
    for (let i = 0; i < steps; i++) current = await s.service.advance(b.id, scope);
    expect(current.phase).toBe(11);
    expect(current.generation).toBeNull();
    expect(current.bundle?.files.map((f) => f.path).sort()).toEqual(
      s.target.files.map((f) => f.path).sort(),
    );
    for (const call of vi.mocked(s.model.generate).mock.calls)
      expect(call[0].maxOutputTokens).toBeLessThanOrEqual(32768);
  });

  it("aceita o projeto pronto em uma chamada quando o modelo já devolve os arquivos", async () => {
    const s = setup({ chunked: false });
    const b = await s.service.start(scope, { prompt: "Crie um app de corridas como a Uber." }, "single-123456");
    for (let i = 0; i < 11; i++) await s.service.advance(b.id, scope);
    expect((await s.service.get(b.id, scope)).phase).toBe(11);
  });

  it("lote vazio é refeito automaticamente sem perder o que já foi escrito", async () => {
    const s = setup({ chunked: true });
    const b = await s.service.start(scope, { prompt: "Crie um app de corridas como a Uber." }, "retry-123456");
    for (let i = 0; i < 12; i++) await s.service.advance(b.id, scope);
    const before = await s.service.get(b.id, scope);
    const perStep = FILE_BATCH_SIZE * PARALLEL_FILE_BATCHES;
    expect(before.generation?.files.length).toBe(perStep);
    const remainingGroups = Math.ceil((s.target.files.length - perStep) / FILE_BATCH_SIZE);
    for (let i = 0; i < remainingGroups; i++)
      vi.mocked(s.model.generate).mockResolvedValueOnce({ text: '{"files":[]}', model: "m", inputTokens: 1, outputTokens: 1 });
    const failed = await s.service.advance(b.id, scope);
    expect(failed.status).toBe("generating");
    expect(failed.generation?.files.length).toBe(perStep);
    const resumed = await s.service.advance(b.id, scope);
    expect(resumed.phase).toBe(11);
    expect(resumed.bundle?.files.length).toBe(s.target.files.length);
  });

  it("arquivo com marcador provisório é recusado sozinho e refeito, sem derrubar o projeto", async () => {
    const s = setup({ chunked: true });
    const b = await s.service.start(scope, { prompt: "Crie um app de corridas como a Uber." }, "todo-123456");
    for (let i = 0; i < 11; i++) await s.service.advance(b.id, scope);
    const original = vi.mocked(s.model.generate).getMockImplementation()!;
    let poisoned = false;
    vi.mocked(s.model.generate).mockImplementation(async (input) => {
      const result = await original(input);
      if (!poisoned && input.systemInstruction.includes(CHUNKED_FILES_PROTOCOL)) {
        poisoned = true;
        const out = JSON.parse(result.text);
        out.files[0].content += "\n// TODO terminar";
        return { ...result, text: JSON.stringify(out) };
      }
      return result;
    });
    const step = await s.service.advance(b.id, scope);
    expect(step.generation?.retryNotes?.[0]?.reason).toContain("TODO");
    let current = step;
    for (let i = 0; i < 4 && current.phase === 10; i++) current = await s.service.advance(b.id, scope);
    expect(current.phase).toBe(11);
    expect(current.bundle?.files.some((f) => /\bTODO\b/.test(f.content))).toBe(false);
  });

  it("'todo' em português não é marcador provisório", () => {
    expect(placeholderIn("<p>Veja todo o histórico do dia todo</p>")).toBeNull();
    expect(placeholderIn("// TODO: implementar")).toBe("TODO");
    expect(placeholderIn("Lorem ipsum dolor")).not.toBeNull();
    expect(fileProblem("src/App.tsx", "Mostrar todo o percurso")).toBeNull();
  });

  it("alteração pelo chat reaproveita o planejamento e reescreve só o necessário", async () => {
    const s = setup({ chunked: true });
    const b = await s.service.start(scope, { prompt: "Crie um app de corridas como a Uber." }, "base-123456");
    for (let i = 0; i < 16; i++) await s.service.advance(b.id, scope);
    const done = await s.service.get(b.id, scope);
    s.repo.builds.set(done.id, { ...structuredClone(done), status: "ready" });
    const changed = await s.service.change(b.id, scope, "Troque a cor do botão para azul.", "change-123456");
    expect(changed.phase).toBe(10);
    expect(changed.reports.length).toBe(done.reports.length);
    expect(changed.feedback.join(" ")).toContain("Troque a cor do botão para azul.");
  });

  it("o chat recebe o estado real da construção e o código", async () => {
    const s = setup({ chunked: true });
    const b = await s.service.start(scope, { prompt: "Crie um app de corridas como a Uber." }, "chat-123456");
    for (let i = 0; i < 12; i++) await s.service.advance(b.id, scope);
    const text = describeBuildForChat(await s.service.get(b.id, scope), []);
    expect(text).toContain("Crie um app de corridas como a Uber.");
    expect(text).toContain("Plano de arquivos");
    expect(text).toContain("src/main.tsx");
    expect(text).toContain("CÓDIGO ATUAL");
  });
});
