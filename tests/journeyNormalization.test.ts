import { beforeEach, describe, expect, it } from "vitest";
import { parseBundle } from "../server/siteFactory/professionalContract.js";
import {
  InMemoryBuildRepository,
  MAX_MANUAL_RESUMES,
  ProfessionalBuildService,
} from "../server/siteFactory/professionalBuildService.js";
import { InMemoryVariableRepository, ProjectVariableService } from "../server/siteFactory/projectVariableService.js";
import { env } from "../server/config/env.js";
import { fixtureBundle } from "./helpers/professionalFactoryFixture.js";

beforeEach(() => {
  env.MEMORY_ENCRYPTION_KEY = "factory-tests-encryption-key";
});

describe("roteiros de teste (jornadas) com formato imperfeito", () => {
  it("corrige id, papel, ação e caminho em vez de reprovar o projeto", () => {
    const raw: any = structuredClone(fixtureBundle());
    const originalId = raw.journeys[0].id;
    raw.journeys[0].id = "Fluxo_Reserva Principal";
    raw.journeys[0].path = "https://meusite.vercel.app/reservar";
    raw.journeys[0].steps = [
      { action: "type", by: "placeholder", locator: "Origem", value: 123 },
      { action: "click", by: "role", role: "tab", locator: "Carona" },
      { action: "click", by: "role", role: "img", locator: "Mapa" },
      { action: "wait", by: "text", locator: "2s" },
      { action: "assert-visible", by: "data-testid", locator: "total" },
    ];
    raw.requirements[0].journeyIds = ["Fluxo_Reserva Principal"];
    const bundle = parseBundle(JSON.stringify(raw));
    const j = bundle.journeys[0];
    expect(j.id).toBe("fluxo_reserva-principal");
    expect(j.path).toBe("/reservar");
    expect(j.steps).toEqual([
      { action: "fill", by: "label", locator: "Origem", value: "123" },
      { action: "click", by: "role", role: "button", locator: "Carona" },
      { action: "click", by: "text", locator: "Mapa" },
      { action: "expect-visible", by: "testid", locator: "total" },
    ]);
    expect(bundle.requirements[0].journeyIds).toEqual([j.id]);
    expect(originalId).not.toBe(j.id);
  });

  it("jornada com login cria as variáveis da conta de teste", () => {
    const raw: any = structuredClone(fixtureBundle());
    raw.journeys[0].authenticated = true;
    const bundle = parseBundle(JSON.stringify(raw));
    expect(bundle.variables.some((v) => v.name === "TEST_LOGIN_EMAIL" && v.visibility === "secret")).toBe(true);
  });

  it("continua recusando requisito ligado a jornada que nunca existiu", () => {
    const raw: any = structuredClone(fixtureBundle());
    raw.requirements[0].journeyIds = ["jornada-inventada"];
    expect(() => parseBundle(JSON.stringify(raw))).toThrow();
  });
});

describe("retomar construção", () => {
  it("libera nova rodada mesmo com muitos erros, até o teto de retomadas manuais", async () => {
    const repo = new InMemoryBuildRepository();
    const service = new ProfessionalBuildService(
      repo,
      { certify: async () => ({}), publish: async () => ({}), media: async () => ({ complete: true }) } as any,
      new ProjectVariableService(new InMemoryVariableRepository()),
      { generate: async () => { throw new Error("modelo indisponível"); } } as any,
      { reserveCredits: async ({ idempotencyKey }: any) => ({ reservationId: idempotencyKey }), confirmConsumption: async () => {}, releaseReservation: async () => {} } as any,
    );
    const scope = { projectId: "p-r", tenantId: "t-r", userId: "u-r" };
    const b = await service.start(scope, { prompt: "Crie um app de corridas como a Uber." }, "resume-123456");
    repo.builds.set(b.id, { ...repo.builds.get(b.id)!, status: "failed", errors: 9, error: "falhou" });
    const resumed = await service.resume(b.id, scope);
    expect(resumed.manualResumes).toBe(1);
    expect(resumed.errors).toBeLessThanOrEqual(4);
    repo.builds.set(b.id, { ...repo.builds.get(b.id)!, status: "failed", manualResumes: MAX_MANUAL_RESUMES });
    await expect(service.resume(b.id, scope)).rejects.toThrow(/Limite de retomadas/);
  });
});

describe("variáveis de pagamento", () => {
  it("separa MERCADO_PAGO_ACCESS_TOKEN 'para ambos' em teste e produção, sem reprovar", () => {
    const raw: any = structuredClone(fixtureBundle());
    raw.productType = "web-application";
    raw.files.push({ path: "api/pagamento.ts", content: "export default function handler(){return process.env.MERCADO_PAGO_ACCESS_TOKEN?1:0}" });
    raw.payments = { required: true, provider: "mercado-pago", currency: "BRL" };
    raw.integrations = [{ name: "Pagamento Mercado Pago", healthPath: "/api/pagamento", required: true }];
    raw.variables = [
      { name: "MERCADO_PAGO_ACCESS_TOKEN", purpose: "Token do Mercado Pago", visibility: "secret", environment: "both" },
      { name: "MERCADO_PAGO_ACCESS_TOKEN", purpose: "Token do Mercado Pago", visibility: "secret", environment: "both" },
      { name: "PUBLIC_SITE_URL", purpose: "Endereço", visibility: "public", environment: "both" },
      { name: "PUBLIC_SITE_URL", purpose: "Endereço", visibility: "public", environment: "production" },
    ];
    const bundle = parseBundle(JSON.stringify(raw));
    const token = bundle.variables.filter((v) => v.name === "MERCADO_PAGO_ACCESS_TOKEN").map((v) => v.environment).sort();
    expect(token).toEqual(["preview", "production"]);
    expect(bundle.variables.filter((v) => v.name === "PUBLIC_SITE_URL").map((v) => v.environment)).toEqual(["production"]);
  });
});

describe("credencial de pagamento só usada no código", () => {
  it("não reprova quando a IA não declara a variável e o código usa process.env", () => {
    const raw: any = structuredClone(fixtureBundle());
    raw.productType = "web-application";
    raw.files.push({ path: "api/pagamento.ts", content: "export default function handler(){return process.env.MERCADO_PAGO_ACCESS_TOKEN?1:0}" });
    raw.payments = { required: true, provider: "mercado-pago", currency: "BRL" };
    raw.integrations = [{ name: "Pagamento Mercado Pago", healthPath: "/api/pagamento", required: true }];
    raw.variables = [];
    const bundle = parseBundle(JSON.stringify(raw));
    expect(
      bundle.variables.filter((v) => v.name === "MERCADO_PAGO_ACCESS_TOKEN").map((v) => v.environment).sort(),
    ).toEqual(["preview", "production"]);
  });
});
