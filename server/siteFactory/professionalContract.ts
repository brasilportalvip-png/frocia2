import { createHash } from "node:crypto";
import { z } from "zod";
import { projectVariableSchema } from "./projectVariableService.js";
export class FactoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 409,
  ) {
    super(message);
  }
}
export const buildBriefSchema = z
  .object({
    prompt: z.string().trim().min(10).max(16000),
    category: z.string().max(100).default("Geral"),
    colorPalette: z.string().max(200).default(""),
    tone: z.string().max(100).default("Profissional"),
    features: z.array(z.string().max(200)).max(40).default([]),
    language: z.string().max(20).default("pt-BR"),
    autoPublish: z.boolean().default(true),
    githubTarget: z.object({
      installationId: z.number().int().positive(),
      owner: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
      repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    }).strict().optional(),
    githubBaseSha: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
    media: z
      .object({ images: z.number().int().min(0).max(3), video: z.boolean() })
      .default({ images: 0, video: false }),
  })
  .strict();
export type BuildBrief = z.infer<typeof buildBriefSchema>;
export const journeySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{2,60}$/),
    name: z.string().min(5).max(160),
    path: z
      .string()
      .regex(/^\/(?!\/)[A-Za-z0-9/_?=&.%-]*$/)
      .max(250),
    environment: z.enum(["preview", "production", "both"]).default("both"),
    authenticated: z.boolean().default(false),
    steps: z
      .array(
        z
          .object({
            action: z.enum([
              "click",
              "fill",
              "select",
              "expect-visible",
              "expect-text",
            ]),
            by: z.enum(["label", "role", "testid", "text"]),
            locator: z.string().min(1).max(160),
            role: z
              .enum([
                "button",
                "link",
                "textbox",
                "heading",
                "checkbox",
                "combobox",
                "alert",
              ])
              .optional(),
            value: z.string().max(300).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
const pathSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (p) =>
      !p.includes("\\") &&
      !p.split("/").some((v) => !v || v === "." || v === "..") &&
      /^(?:index\.html|(?:src|api|public|tests)\/[A-Za-z0-9_./-]+)$/.test(p) &&
      !/(?:^|\/)(?:\.env|node_modules|\.git)|\.(?:pem|key|p12)$/i.test(p),
    "Caminho de arquivo inválido",
  );
export const bundleSchema = z
  .object({
    title: z.string().min(3).max(150),
    description: z.string().min(10).max(1000),
    productType: z.enum(["website", "web-application"]),
    files: z
      .array(
        z
          .object({ path: pathSchema, content: z.string().min(1).max(200000) })
          .strict(),
      )
      .min(3)
      .max(70),
    publicPages: z
      .array(
        z
          .string()
          .regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/)
          .max(200),
      )
      .min(1)
      .max(50),
    variables: z.array(projectVariableSchema).max(45),
    requirements: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            description: z.string().min(8).max(400),
            files: z.array(pathSchema).min(1),
            journeyIds: z.array(z.string()).min(1),
          })
          .strict(),
      )
      .min(1)
      .max(60),
    journeys: z.array(journeySchema).min(1).max(30),
    integrations: z
      .array(
        z
          .object({
            name: z.string().min(2).max(80),
            healthPath: z.string().regex(/^\/api\/[a-z0-9/_-]+$/),
            required: z.literal(true),
          })
          .strict(),
      )
      .max(15),
    payments: z
      .object({
        required: z.boolean(),
        provider: z.enum(["none", "stripe", "mercado-pago"]),
        currency: z.string().regex(/^[A-Z]{3}$/),
      })
      .strict(),
    legal: z
      .object({
        privacy: z.string().min(200).max(12000),
        terms: z.string().min(200).max(12000),
        cookies: z.string().min(100).max(6000),
      })
      .strict(),
  })
  .strict();
export type ProfessionalBundle = z.infer<typeof bundleSchema>;
export function sourceDigest(files: Array<{ path: string; content: string }>) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...files]
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
          .map((f) => [f.path, f.content]),
      ),
    )
    .digest("hex");
}
export function parseBundle(raw: string): ProfessionalBundle {
  if (Buffer.byteLength(raw) > 650000)
    throw new FactoryError(
      "bundle_too_large",
      "O projeto excedeu o limite de geração.",
    );
  const bundle = bundleSchema.parse(
    JSON.parse(raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")),
  );
  const paths = new Set<string>();
  for (const file of bundle.files) {
    if (
      paths.has(file.path) ||
      /^(?:public\/(?:\.well-known\/froc-release\.json|froc-|sitemap|robots|legal\/|consent)|api\/froc-|tests\/froc-|src\/froc-)/.test(
        file.path,
      )
    )
      throw new FactoryError(
        "reserved_file",
        "Arquivo duplicado ou reservado ao sistema de entrega.",
      );
    if (
      /(?:sk_live_|sk_test_|ghp_|github_pat_)[a-zA-Z0-9]{8}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(
        file.content,
      )
    )
      throw new FactoryError(
        "credential_in_source",
        "A geração tentou colocar uma credencial no código.",
      );
    if (
      /\b(?:TODO|FIXME|LOREM IPSUM|YOUR_API_KEY|COLOQUE_AQUI)\b/i.test(
        file.content,
      )
    )
      throw new FactoryError(
        "incomplete_source",
        "A geração deixou conteúdo provisório.",
      );
    paths.add(file.path);
  }
  if (
    !paths.has("index.html") ||
    !bundle.files.some((f) => /^src\/.*\.[jt]sx?$/.test(f.path)) ||
    !bundle.files.some((f) => /^tests\/.*\.test\.[jt]s$/.test(f.path))
  )
    throw new FactoryError(
      "missing_project_files",
      "Projeto sem entrada, implementação ou testes.",
    );
  const html = bundle.files.find((f) => f.path === "index.html")!.content;
  if (
    !/<!doctype html>/i.test(html) ||
    !/name=["']viewport["']/i.test(html) ||
    !/<title>[^<]+<\/title>/i.test(html) ||
    /cdn.tailwindcss.com/.test(html)
  )
    throw new FactoryError(
      "invalid_document",
      "Documento sem metadados essenciais ou dependente de compilação CSS em produção.",
    );
  const ids = new Set(bundle.journeys.map((j) => j.id));
  if (ids.size !== bundle.journeys.length)
    throw new FactoryError("duplicate_journey", "Jornadas duplicadas.");
  for (const r of bundle.requirements)
    if (
      r.files.some((p) => !paths.has(p)) ||
      r.journeyIds.some((j) => !ids.has(j))
    )
      throw new FactoryError(
        "uncovered_requirement",
        "Requisito sem arquivo ou jornada de verificação.",
      );
  for (const a of bundle.variables)
    for (const b of bundle.variables)
      if (
        a !== b &&
        a.name === b.name &&
        (a.visibility !== b.visibility ||
          a.environment === b.environment ||
          a.environment === "both" ||
          b.environment === "both")
      )
        throw new FactoryError(
          "invalid_variable_definition",
          "Variável com ambientes sobrepostos ou visibilidade divergente.",
        );
  if (bundle.variables.some((v) => v.value !== undefined))
    throw new FactoryError(
      "variable_value_in_bundle",
      "O modelo deve definir variáveis sem valores.",
    );
  if (
    (bundle.productType === "web-application" ||
      bundle.payments.required ||
      bundle.integrations.length) &&
    !bundle.files.some((f) => /^api\/.*\.[jt]s$/.test(f.path))
  )
    throw new FactoryError(
      "backend_required",
      "Este projeto exige backend real.",
    );
  if (
    bundle.payments.required &&
    (bundle.payments.provider === "none" ||
      !bundle.integrations.some((i) =>
        /pagamento|payment|stripe|mercado/i.test(i.name),
      ))
  )
    throw new FactoryError(
      "payment_not_covered",
      "Pagamento sem integração verificável.",
    );
  if (
    bundle.journeys.some((j) => j.authenticated) &&
    !bundle.variables.some(
      (v) => v.name === "TEST_LOGIN_EMAIL" && v.visibility === "secret",
    )
  )
    throw new FactoryError(
      "test_account_required",
      "Fluxos autenticados exigem conta de teste configurável.",
    );
  const platformNames = new Set([
    "NODE_ENV",
    "VERCEL_URL",
    "FROC_DEPLOYMENT_ENVIRONMENT",
  ]);
  for (const file of bundle.files)
    for (const match of file.content.matchAll(
      /process\.env\.([A-Z][A-Z0-9_]*)/g,
    )) {
      const name = match[1];
      if (
        !platformNames.has(name) &&
        !bundle.variables.some((v) => v.name === name)
      )
        bundle.variables.push(
          projectVariableSchema.parse({
            name,
            purpose: "Configuração da integração " + name,
            visibility: name.startsWith("PUBLIC_") ? "public" : "secret",
            environment: "both",
          }),
        );
    }
  if (bundle.payments.required) {
    const secretName =
      bundle.payments.provider === "stripe"
        ? "STRIPE_SECRET_KEY"
        : "MERCADO_PAGO_ACCESS_TOKEN";
    if (
      bundle.variables.some(
        (v) => v.name === secretName && v.environment === "both",
      )
    )
      throw new FactoryError(
        "payment_environment_not_separated",
        "Defina " + secretName + " separadamente para preview e production.",
      );
    for (const environment of ["preview", "production"] as const)
      if (
        !bundle.variables.some(
          (v) => v.name === secretName && v.environment === environment,
        )
      )
        bundle.variables.push({
          name: secretName,
          purpose: "Credencial de pagamento " + environment,
          visibility: "secret",
          environment,
        });
    if (
      bundle.payments.provider === "mercado-pago" &&
      !bundle.variables.some((v) => v.name === "TEST_PAYMENT_ID")
    )
      bundle.variables.push({
        name: "TEST_PAYMENT_ID",
        purpose: "Pagamento aprovado no sandbox do Mercado Pago",
        visibility: "secret",
        environment: "preview",
      });
  }
  for (const [name, purpose] of [
    ["PUBLIC_BUSINESS_NAME", "Nome real do negócio"],
    ["PUBLIC_CONTACT_EMAIL", "Contato do responsável"],
    ["PUBLIC_SITE_URL", "Origem HTTPS final do projeto"],
  ]) {
    if (!bundle.variables.some((v) => v.name === name))
      bundle.variables.push({
        name,
        purpose,
        visibility: "public",
        environment: "both",
      });
  }
  return bundle;
}
export const PROFESSIONAL_GENERATION_CONTRACT = `Entregue JSON contendo title,description,productType(website/web-application),files[{path,content}],publicPages,variables[{name,purpose,visibility(public/secret),environment(preview/production/both)}],requirements[{id,description,files,journeyIds}],journeys[{id,name,path,environment,authenticated,steps[{action(click/fill/select/expect-visible/expect-text),by(label/role/testid/text),locator,role?,value?}]}],integrations[{name,healthPath,required:true}],payments{required,provider(none/stripe/mercado-pago),currency},legal{privacy,terms,cookies}.
Arquitetura: React/TypeScript/Vite no src; funções Vercel no api; Vitest em tests; index.html com viewport,título,descrição e script module /src/main.tsx. Dependências já fornecidas: React, Firebase cliente/Admin, Zod e Mercado Pago. Stripe por API REST. Não gerar package.json, lock, config, scripts ou workflows: são gerenciados pela fábrica.
Implemente TODO o pedido com conteúdo final, backend e persistência quando necessário. Não simule login, pagamento, email, estoque ou banco com localStorage. Dados de negócio persistem no backend. Implemente autorização e isolamento por usuário em TODAS as rotas. Regras, webhooks assinados, transações e idempotência precisam de testes negativos.
O frontend deve aguardar window.FrocConfigReady e ler window.FROC_PUBLIC_CONFIG para configurações públicas. Segredos somente process.env nas funções. Nunca retorne valores de variáveis no JSON. Defina todas as variáveis e seus ambientes, inclusive credenciais sandbox/produção e TEST_LOGIN_EMAIL/TEST_LOGIN_PASSWORD para contas de teste quando houver login.
Jornadas: cubra todos os requisitos com interações e resultados reais. Valores {{TEST_LOGIN_EMAIL}}, {{TEST_LOGIN_PASSWORD}} e {{TEST_PAYMENT_ID}} são substituídos apenas no executor de testes. Checkout real nunca deve efetuar compra financeira de produção. Teste sandbox separado; integração de produção deve ter leitura de saúde sem cobrança. Cada healthPath deve retornar {ok:true,environment:process.env.FROC_DEPLOYMENT_ENVIRONMENT,checks:[{name,status:'passed',receiptId}]} somente depois de consultar o provedor real, sem expor credenciais.
O sistema injeta consentimento granular, políticas em /legal/privacy.html,/legal/terms.html,/legal/cookies.html, robots e sitemap. Não os sobrescreva. Scripts opcionais precisam type=text/plain e data-froc-consent=analytics/marketing; não carregar trackers antes de consentimento. Escreva legal.privacy/terms/cookies com tratamento e fornecedores REAIS do projeto, sem inventar controlador, certificação ou adequação jurídica garantida: o sistema inclui nome e contato configurados.
Garanta teclado, WCAG, semântica, responsividade 360/768/1440, movimento reduzido, SEO, canonical, conteúdo e imagens com alt. 3D deve ter alternativa leve e controle de movimento. Use apenas ativos fornecidos ou licenciados. Um pedido de app nativo não pode ser falsamente entregue como PWA.
Não inclua placeholders, TODO, páginas vazias, botões decorativos ou instruções de edição de código. Dependências externas são configuradas pelo painel. Testes sem testes ou com assertions triviais não certificam a entrega.`;

export function stableJson(value: unknown): string {
  const normalize = (v: any): any =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, normalize(v[k])]),
          )
        : v;
  return JSON.stringify(normalize(value));
}
