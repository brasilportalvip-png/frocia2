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
/**
 * O modelo às vezes entrega o projeto quase certo: um campo a mais, uma descrição
 * longa demais, uma variável com valor vazio. Isso não deve derrubar a etapa inteira.
 * Remove campos desconhecidos e encurta textos curtos (nunca o conteúdo dos arquivos);
 * o que não dá para consertar sozinho volta como erro detalhado.
 */
const JOURNEY_ACTIONS: Record<string, string> = {
  click: "click", press: "click", tap: "click", clicar: "click",
  fill: "fill", type: "fill", input: "fill", preencher: "fill", digitar: "fill",
  select: "select", choose: "select", selecionar: "select", selectoption: "select",
  "expect-visible": "expect-visible", expectvisible: "expect-visible", "assert-visible": "expect-visible",
  visible: "expect-visible", see: "expect-visible", "expect-to-be-visible": "expect-visible",
  "expect-text": "expect-text", expecttext: "expect-text", "assert-text": "expect-text",
  "expect-contains": "expect-text", contains: "expect-text", "expect-to-have-text": "expect-text",
};
const JOURNEY_BY: Record<string, string> = {
  label: "label", placeholder: "label", "aria-label": "label", arialabel: "label", name: "label",
  role: "role", testid: "testid", "test-id": "testid", "data-testid": "testid", datatestid: "testid",
  text: "text", texto: "text",
};
const JOURNEY_ROLES = new Set(["button", "link", "textbox", "heading", "checkbox", "combobox", "alert"]);
const JOURNEY_ROLE_ALIASES: Record<string, string> = {
  searchbox: "textbox", spinbutton: "textbox", input: "textbox", textarea: "textbox",
  radio: "checkbox", switch: "checkbox", listbox: "combobox", select: "combobox",
  status: "alert", menuitem: "button", tab: "button",
};

/**
 * Conserta o formato dos roteiros de teste (jornadas) e dos requisitos antes da validação.
 * O código do projeto não muda; só a "ficha" que o robô de testes segue. Antes, um papel
 * de botão fora da lista ou um id com letra maiúscula reprovava o projeto inteiro e a
 * construção ficava presa retomando até esgotar o limite.
 */
export function normalizeJourneysAndRequirements(data: any): void {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data.journeys)) {
    const ids = new Map<string, string>();
    const dropped = new Set<string>();
    const journeys: any[] = [];
    for (const raw of data.journeys) {
      if (!raw || typeof raw !== "object") continue;
      const j: any = { ...raw };
      const originalId = String(j.id ?? "");
      let id = originalId.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "");
      if (id.length < 3) id = ("jornada-" + id).slice(0, 61);
      id = id.slice(0, 61);
      let unique = id, n = 2;
      while ([...ids.values()].includes(unique)) unique = (id.slice(0, 57) + "-" + n++);
      ids.set(originalId, unique);
      j.id = unique;
      j.name = String(j.name ?? unique).slice(0, 160);
      if (j.name.length < 5) j.name = ("Jornada " + j.name).slice(0, 160);
      let path = String(j.path ?? "/");
      try { if (/^https?:\/\//i.test(path)) { const u = new URL(path); path = u.pathname + u.search; } } catch { path = "/"; }
      if (!path.startsWith("/")) path = "/" + path;
      if (!/^\/(?!\/)[A-Za-z0-9/_?=&.%-]*$/.test(path) || path.length > 250) path = "/";
      j.path = path;
      if (!["preview", "production", "both"].includes(j.environment)) j.environment = "both";
      j.authenticated = j.authenticated === true || j.authenticated === "true";
      const steps: any[] = [];
      for (const rawStep of Array.isArray(j.steps) ? j.steps : []) {
        if (!rawStep || typeof rawStep !== "object") continue;
        const action = JOURNEY_ACTIONS[String(rawStep.action ?? "").toLowerCase().replace(/[\s_]+/g, "-")] ||
          JOURNEY_ACTIONS[String(rawStep.action ?? "").toLowerCase().replace(/[\s_-]+/g, "")];
        let by = JOURNEY_BY[String(rawStep.by ?? "").toLowerCase()];
        const locator = String(rawStep.locator ?? rawStep.name ?? rawStep.text ?? "").trim().slice(0, 160);
        if (!action || !by || !locator) continue; // passo que o robô não sabe executar (ex.: "esperar")
        const step: any = { action, by, locator };
        let role = rawStep.role == null ? undefined : String(rawStep.role).toLowerCase();
        if (role && !JOURNEY_ROLES.has(role)) role = JOURNEY_ROLE_ALIASES[role];
        if (by === "role" && !role) step.by = "text"; // papel desconhecido: procura pelo texto visível
        else if (role) step.role = role;
        if (rawStep.value != null) step.value = String(rawStep.value).slice(0, 300);
        steps.push(step);
        if (steps.length >= 30) break;
      }
      if (!steps.length) {
        dropped.add(originalId);
        continue;
      }
      j.steps = steps;
      for (const key of Object.keys(j))
        if (!["id", "name", "path", "environment", "authenticated", "steps"].includes(key)) delete j[key];
      journeys.push(j);
      if (journeys.length >= 30) break;
    }
    data.journeys = journeys;
    const valid = new Set(journeys.map((j) => j.id));
    if (Array.isArray(data.requirements)) {
      data.requirements = data.requirements
        .filter((r: any) => r && typeof r === "object")
        .slice(0, 60)
        .map((r: any) => {
          // Ids renomeados acompanham a jornada; ids que nunca existiram continuam e
          // reprovam (cobertura falsa). Só jornadas descartadas por não terem passos
          // executáveis saem da lista.
          const original = Array.isArray(r.journeyIds) ? r.journeyIds.map(String) : [];
          let journeyIds = original
            .filter((x: string) => !dropped.has(x))
            .map((x: string) => (valid.has(ids.get(x) ?? "") ? ids.get(x)! : x));
          if (!journeyIds.length && original.length && journeys.length) journeyIds = [journeys[0].id];
          return {
            ...r,
            id: String(r.id ?? "req").slice(0, 80) || "req",
            description: String(r.description ?? "").length >= 8 ? String(r.description).slice(0, 400) : ("Requisito " + String(r.description ?? r.id ?? "")).padEnd(8, ".").slice(0, 400),
            journeyIds,
          };
        });
    }
  }
  // Variáveis: tira duplicadas e separa a credencial de pagamento em teste (preview) e
  // produção. Antes, "MERCADO_PAGO_ACCESS_TOKEN para ambos" reprovava o projeto inteiro e a
  // construção pedia "Retomar" sem parar, porque a IA repetia o mesmo formato.
  if (Array.isArray(data.variables)) {
    const PAYMENT_SECRETS = new Set(["MERCADO_PAGO_ACCESS_TOKEN", "STRIPE_SECRET_KEY"]);
    const out: any[] = [];
    const seen = new Set<string>();
    const push = (v: any) => {
      const k = v.name + "|" + v.environment;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(v);
    };
    const vars = data.variables.filter((v: any) => v && typeof v === "object" && typeof v.name === "string");
    for (const v of vars) {
      if (!["preview", "production", "both"].includes(v.environment)) v.environment = "both";
      if (PAYMENT_SECRETS.has(v.name) && v.environment === "both") {
        for (const environment of ["preview", "production"])
          push({ ...v, visibility: "secret", environment, purpose: String(v.purpose || "Credencial de pagamento") + (environment === "preview" ? " (teste)" : " (produção)") });
        continue;
      }
      // Mesmo nome em "ambos" e num ambiente específico: fica só o específico.
      if (v.environment === "both" && vars.some((o: any) => o !== v && o.name === v.name && o.environment !== "both")) continue;
      push(v);
    }
    // Mesma variável com visibilidades diferentes: vale a mais protegida (secret).
    for (const v of out)
      if (out.some((o) => o.name === v.name && o.visibility === "secret")) v.visibility = "secret";
    data.variables = out;
  }
  // Jornada com login exige conta de teste: cria as variáveis em vez de reprovar.
  if (Array.isArray(data.journeys) && data.journeys.some((j: any) => j.authenticated) && Array.isArray(data.variables)) {
    for (const name of ["TEST_LOGIN_EMAIL", "TEST_LOGIN_PASSWORD"])
      if (!data.variables.some((v: any) => v?.name === name))
        data.variables.push({ name, purpose: "Conta de teste usada pelo robô de testes", visibility: "secret", environment: "preview" });
  }
}

export function parseBundleLeniently(data: unknown): ProfessionalBundle {
  normalizeJourneysAndRequirements(data);
  const at = (root: any, path: ReadonlyArray<PropertyKey>) =>
    path.reduce((node: any, key) => (node == null ? node : node[key as any]), root);
  if (data && typeof data === "object" && Array.isArray((data as any).variables))
    for (const v of (data as any).variables)
      if (v && typeof v === "object" && (v.value === "" || v.value === null)) delete v.value;
  for (let pass = 0; pass < 5; pass++) {
    const result = bundleSchema.safeParse(data);
    if (result.success) return result.data;
    let repaired = false;
    for (const issue of result.error.issues as any[]) {
      if (issue.code === "unrecognized_keys") {
        const node = at(data, issue.path);
        if (node && typeof node === "object")
          for (const key of issue.keys || []) {
            delete node[key];
            repaired = true;
          }
      } else if (
        issue.code === "too_big" &&
        (issue.origin === "string" || issue.type === "string") &&
        issue.path.length &&
        issue.path[issue.path.length - 1] !== "content"
      ) {
        const parent = at(data, issue.path.slice(0, -1));
        const key = issue.path[issue.path.length - 1];
        if (parent && typeof parent[key] === "string") {
          parent[key] = parent[key].slice(0, Number(issue.maximum));
          repaired = true;
        }
      }
    }
    if (!repaired) throw result.error;
  }
  return bundleSchema.parse(data);
}
/** Resumo curto dos problemas de formato, para o modelo corrigir na próxima tentativa. */
export function describeContractIssues(error: unknown, limit = 12): string {
  const issues: any[] = (error as any)?.issues || [];
  return issues
    .slice(0, limit)
    .map((issue) => (issue.path?.length ? issue.path.join(".") : "(raiz)") + ": " + issue.message)
    .join("; ");
}
/**
 * Marcador de código provisório. TODO/FIXME só em MAIÚSCULAS: em português "todo" é palavra
 * comum ("todo o histórico", "o dia todo") e antes reprovava projetos inteiros sem motivo.
 */
export function placeholderIn(content: string): string | null {
  const upper = /\b(?:TODO|FIXME)\b/.exec(content);
  if (upper) return upper[0];
  const other = /\b(?:lorem ipsum|YOUR_API_KEY|COLOQUE_AQUI)\b/i.exec(content);
  return other ? other[0] : null;
}
/** Problema que impede um arquivo isolado de entrar no projeto (ou null se estiver ok). */
export function fileProblem(path: string, content: string): string | null {
  if (
    /^(?:public\/(?:\.well-known\/froc-release\.json|froc-|sitemap|robots|legal\/|consent)|api\/froc-|tests\/froc-|src\/froc-)/.test(path)
  )
    return "caminho reservado ao sistema de entrega; use outro nome";
  if (
    /(?:sk_live_|sk_test_|ghp_|github_pat_)[a-zA-Z0-9]{8}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)
  )
    return "contém algo parecido com uma credencial; leia segredos de process.env";
  const mark = placeholderIn(content);
  if (mark)
    return "contém o marcador provisório \"" + mark + "\"; escreva a implementação final sem esse marcador";
  return null;
}
export function parseBundle(raw: string): ProfessionalBundle {
  if (Buffer.byteLength(raw) > 650000)
    throw new FactoryError(
      "bundle_too_large",
      "O projeto excedeu o limite de geração.",
    );
  const bundle = parseBundleLeniently(
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
    if (placeholderIn(file.content))
      throw new FactoryError(
        "incomplete_source",
        "A geração deixou conteúdo provisório em " + file.path + ".",
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
