import {
  AGENT_EXECUTION_PROTOCOL,
  FACTORY_DISCIPLINE_PROTOCOL,
} from "../../shared/agentExecutionProtocol.js";
import { createHash, randomUUID } from "node:crypto";
import { adminDb, isFirebaseAdminConfigured } from "../lib/firebaseAdmin.js";
import { env } from "../config/env.js";
import { GeminiProvider } from "../ai/providers/geminiProvider.js";
import { CreditWalletService } from "../services/creditWalletService.js";
import {
  CREATION_AGENTS,
  FACTORY_STAGES,
  describeAgent,
} from "../../shared/advancedAgentCatalog.js";
import { creationTeamPolicy } from "./creationTeamService.js";
import {
  ProjectVariableService,
  VariableScope,
} from "./projectVariableService.js";
import {
  BuildBrief,
  buildBriefSchema,
  FactoryError,
  ProfessionalBundle,
  parseBundle,
  describeContractIssues,
  PROFESSIONAL_GENERATION_CONTRACT,
  sourceDigest,
  fileProblem,
  stableJson,
} from "./professionalContract.js";
import {
  scaffoldProject,
  ProjectFile,
  managedProjectName,
} from "./professionalScaffold.js";

export type BuildStatus =
  | "queued"
  | "planning"
  | "generating"
  | "reviewing"
  | "configuration_required"
  | "certifying"
  | "publishing"
  | "ready"
  | "failed"
  | "cancelled";
export interface BuildScope extends VariableScope {}
export interface FactoryReference {
  path: string;
  name: string;
  mimeType: string;
  sha256: string;
}
interface Billing {
  key: string;
  amount: number;
  reservationId: string | null;
}
export interface ProfessionalBuild extends BuildScope {
  id: string;
  brief: BuildBrief;
  status: BuildStatus;
  phase: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lease: { token: string; expires: number } | null;
  /** Chamada ao modelo em andamento; se a função for encerrada no meio, conta as tentativas. */
  modelCall?: { phase: number; attempts: number } | null;
  reports: Array<{
    stage: string;
    contributions: Array<{
      agentId: string;
      decisions: string[];
      tests: string[];
    }>;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }>;
  bundle: ProfessionalBundle | null;
  feedback: string[];
  repairs: number;
  errors: number;
  error: string | null;
  billing: Billing | null;
  pendingBilling: Billing | null;
  consumedCredits: number;
  generationCreditLimit?: number;
  certificate: any | null;
  publication: any | null;
  media: any | null;
  references: FactoryReference[];
  monitoring?: { status: string; checkedAt: string; failures: string[]; consecutiveFailures?: number };
  /**
   * Geração em partes: primeiro o plano (sem conteúdo), depois os arquivos em lotes pequenos.
   * Cada chamada ao modelo cabe no tempo de uma função do servidor; o progresso fica salvo
   * entre as chamadas, então a construção nunca precisa gerar o projeto inteiro de uma vez.
   */
  generation?: GenerationProgress | null;
  /** Quantas vezes a pessoa tocou em "Retomar construção". */
  manualResumes?: number;
}
export interface GenerationProgress {
  plan: Record<string, unknown> | null;
  manifest: Array<{ path: string; purpose: string; keep?: boolean }>;
  /** Lista (e não mapa): nomes com "/" e "." não são chaves seguras no Firestore. */
  files: Array<{ path: string; content: string }>;
  /** Plano refeito depois de falha na montagem: o que já foi escrito fica, salvo keep:false. */
  replan?: boolean;
  /** Arquivos recusados no último lote e o motivo, para o próximo lote corrigir. */
  retryNotes?: Array<{ path: string; reason: string }>;
}
export interface BuildRepository {
  create(build: ProfessionalBuild): Promise<ProfessionalBuild>;
  get(id: string, scope?: BuildScope): Promise<ProfessionalBuild | null>;
  claim(
    id: string,
    scope: BuildScope,
    token: string,
    now: number,
  ): Promise<ProfessionalBuild | null>;
  save(build: ProfessionalBuild, token: string): Promise<void>;
  cancel(id: string, scope: BuildScope): Promise<ProfessionalBuild>;
  list(): Promise<ProfessionalBuild[]>;
}
const sameScope = (a: BuildScope, b: BuildScope) =>
  a.projectId === b.projectId &&
  a.userId === b.userId &&
  a.tenantId === b.tenantId;
export class FirestoreBuildRepository implements BuildRepository {
  private ref(id: string) {
    return adminDb.collection("site_factory_builds").doc(id);
  }
  async create(build: ProfessionalBuild) {
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref(build.id));
      if (snap.exists) return snap.data() as ProfessionalBuild;
      const ref = adminDb.collection("projects").doc(build.projectId);
      const project = await tx.get(ref);
      if (
        !project.exists ||
        project.data()?.userId !== build.userId ||
        project.data()?.tenantId !== build.tenantId
      )
        throw new FactoryError(
          "project_not_found",
          "Projeto não encontrado.",
          404,
        );
      const active = project.data()?.professionalBuildId;
      if (active) {
        const previous = await tx.get(this.ref(active));
        if (
          previous.exists &&
          !["ready", "cancelled", "failed"].includes(previous.data()?.status)
        )
          throw new FactoryError(
            "project_build_active",
            "Já existe uma construção em andamento neste projeto.",
          );
      }
      tx.create(this.ref(build.id), build);
      tx.update(ref, { professionalBuildId: build.id });
      return build;
    });
  }
  async get(id: string, scope?: BuildScope) {
    const snap = await this.ref(id).get();
    const b = snap.exists ? (snap.data() as ProfessionalBuild) : null;
    return b && (!scope || sameScope(b, scope)) ? b : null;
  }
  async claim(id: string, scope: BuildScope, token: string, now: number) {
    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref(id));
      const b = snap.data() as ProfessionalBuild | undefined;
      if (!b || !sameScope(b, scope))
        throw new FactoryError(
          "build_not_found",
          "Projeto não encontrado.",
          404,
        );
      if (
        ["ready", "cancelled", "failed"].includes(b.status) ||
        (b.lease && b.lease.expires > now)
      )
        return null;
      const project = await tx.get(
        adminDb.collection("projects").doc(b.projectId),
      );
      if (
        !project.exists ||
        project.data()?.userId !== b.userId ||
        project.data()?.tenantId !== b.tenantId ||
        project.data()?.professionalBuildId !== b.id
      ) {
        tx.update(this.ref(id), {
          status: "cancelled",
          lease: null,
          error: "Projeto removido ou substituído.",
        });
        return null;
      }
      b.lease = { token, expires: now + 240000 };
      b.revision++;
      tx.set(this.ref(id), b);
      return b;
    });
  }
  async save(b: ProfessionalBuild, token: string) {
    if (Buffer.byteLength(JSON.stringify(b)) > 930000)
      throw new FactoryError(
        "build_checkpoint_too_large",
        "A geração excedeu o limite de armazenamento seguro.",
      );
    await adminDb.runTransaction(async (tx) => {
      const doc = await tx.get(this.ref(b.id));
      if (
        doc.data()?.lease?.token !== token ||
        doc.data()?.status === "cancelled"
      )
        throw new FactoryError(
          "lease_lost",
          "Esta etapa foi interrompida por outra operação.",
        );
      const ref = adminDb.collection("projects").doc(b.projectId);
      const project = await tx.get(ref);
      if (!project.exists || project.data()?.professionalBuildId !== b.id)
        throw new FactoryError(
          "project_changed",
          "O projeto mudou durante a execução.",
        );
      tx.set(this.ref(b.id), b);
      tx.update(ref, {
        title: b.bundle?.title || project.data()?.title || "Novo projeto",
        professionalBuildId: b.id,
        productionUrl:
          b.status === "ready"
            ? b.publication?.url || null
            : project.data()?.productionUrl || null,
        updatedAt: new Date(),
      });
    });
  }
  async cancel(id: string, scope: BuildScope) {
    return adminDb.runTransaction(async (tx) => {
      const doc = await tx.get(this.ref(id));
      const b = doc.data() as ProfessionalBuild | undefined;
      if (!b || !sameScope(b, scope))
        throw new FactoryError(
          "build_not_found",
          "Projeto não encontrado.",
          404,
        );
      if (b.status === "ready")
        throw new FactoryError(
          "already_delivered",
          "O projeto já foi entregue.",
        );
      b.status = "cancelled";
      b.lease = null;
      tx.set(this.ref(id), b);
      return b;
    });
  }
  async list() {
    const snap = await adminDb
      .collection("site_factory_builds")
      .where("status", "in", [
        "queued",
        "planning",
        "generating",
        "reviewing",
        "certifying",
        "publishing",
      ])
      .limit(10)
      .get();
    return snap.docs.map((d) => d.data() as ProfessionalBuild);
  }
}
export class InMemoryBuildRepository implements BuildRepository {
  readonly builds = new Map<string, ProfessionalBuild>();
  async create(b: ProfessionalBuild) {
    if (!this.builds.has(b.id)) this.builds.set(b.id, structuredClone(b));
    return structuredClone(this.builds.get(b.id)!);
  }
  async get(id: string, scope?: BuildScope) {
    const b = this.builds.get(id);
    return b && (!scope || sameScope(b, scope)) ? structuredClone(b) : null;
  }
  async claim(id: string, scope: BuildScope, token: string, now: number) {
    const b = this.builds.get(id);
    if (!b || !sameScope(b, scope))
      throw new FactoryError("build_not_found", "Projeto não encontrado.", 404);
    if (
      ["ready", "failed", "cancelled"].includes(b.status) ||
      (b.lease && b.lease.expires > now)
    )
      return null;
    b.lease = { token, expires: now + 240000 };
    b.revision++;
    return structuredClone(b);
  }
  async save(b: ProfessionalBuild, token: string) {
    if (this.builds.get(b.id)?.lease?.token !== token)
      throw new FactoryError("lease_lost", "Etapa interrompida.");
    this.builds.set(b.id, structuredClone(b));
  }
  async cancel(id: string, scope: BuildScope) {
    const b = await this.get(id, scope);
    if (!b)
      throw new FactoryError("build_not_found", "Projeto não encontrado.", 404);
    if (b.status === "ready")
      throw new FactoryError("already_delivered", "Projeto entregue.");
    b.status = "cancelled";
    b.lease = null;
    this.builds.set(id, b);
    return structuredClone(b);
  }
  async list() {
    return [...this.builds.values()]
      .filter(
        (b) =>
          !["failed", "ready", "cancelled", "configuration_required"].includes(
            b.status,
          ),
      )
      .map((b) => structuredClone(b));
  }
}
export interface FactoryAdapter {
  certify(build: ProfessionalBuild, files: ProjectFile[]): Promise<any>;
  publish(build: ProfessionalBuild, files: ProjectFile[]): Promise<any>;
  media(build: ProfessionalBuild): Promise<any>;
  cancel?(build: ProfessionalBuild): Promise<any>;
}
export interface FactoryModel {
  generate(input: {
    systemInstruction: string;
    userMessage: string;
    maxOutputTokens: number;
    attachments?: Array<{ type: string; data: string; mimeType: string }>;
  }): Promise<{
    text: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}
/** JSON completo? (o modelo pensa antes de responder e o pensamento gasta o mesmo limite de saída) */
export function isCompleteJson(text: string): boolean {
  try {
    JSON.parse(
      String(text || "")
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
    return true;
  } catch {
    return false;
  }
}
export const FACTORY_MAX_OUTPUT_TOKENS = 65536;
/** Arquivos escritos por chamada ao modelo na geração em partes. */
export const FILE_BATCH_SIZE = 5;
/** Lotes escritos ao mesmo tempo em cada passo (cada um cabe sozinho no tempo do servidor). */
export const PARALLEL_FILE_BATCHES = 3;
export const MAX_MANIFEST_FILES = 60;
const MANIFEST_PATH =
  /^(?:index\.html|(?:src|api|public|tests)\/[A-Za-z0-9_./-]+)$/;
const RESERVED_MANIFEST_PATH =
  /(?:^|\/)(?:\.env|node_modules|\.git)|\.(?:pem|key|p12)$/i;
export const CHUNKED_PLAN_PROTOCOL = `GERAÇÃO EM PARTES — ETAPA 1 (PLANO):
NÃO escreva o conteúdo dos arquivos agora. Devolva JSON com TODOS os campos do contrato EXCETO "files" e, no lugar de "files", devolva "fileManifest": [{path, purpose, keep}].
- fileManifest lista TODOS os arquivos do projeto (no máximo 60), incluindo index.html e src/main.tsx, nas pastas src, api, public e tests.
- purpose (até 600 caracteres): o que o arquivo faz e exatamente o que exporta (nomes de componentes, funções, tipos, rotas e formato dos dados), para que os outros arquivos importem com os nomes certos.
- keep: true SOMENTE para arquivos de existingFiles que devem continuar exatamente iguais; arquivos novos ou que precisam de correção (veja feedback) usam keep: false.
- requirements[].files deve citar caminhos do fileManifest.`;
export const CHUNKED_FILES_PROTOCOL = `GERAÇÃO EM PARTES — ETAPA 2 (ARQUIVOS):
Escreva o conteúdo COMPLETO e final SOMENTE dos arquivos listados em writeNow, seguindo plan e fileManifest. Importe dos outros arquivos usando exatamente os nomes descritos no purpose de cada um e o código já escrito em writtenFiles. Quando previousContent existir, corrija-o conforme feedback em vez de começar do zero.
Nunca escreva os marcadores TODO, FIXME, lorem ipsum, YOUR_API_KEY ou COLOQUE_AQUI, nem em comentários. Se rejectedLastTime existir, corrija exatamente o motivo indicado.
Devolva JSON {"files":[{"path","content"}]} contendo exatamente os caminhos de writeNow.`;
const EXPORT_PATTERN =
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
function exportsOf(content: string) {
  return Array.from(content.matchAll(EXPORT_PATTERN), (m) => m[1]).slice(0, 30);
}
export const MAX_MODEL_CALL_ATTEMPTS = 3;
export const MAX_MANUAL_RESUMES = 15;
export function createFactoryModel(
  call: (input: Parameters<FactoryModel["generate"]>[0]) => Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
  }>,
  model: () => string,
): FactoryModel {
  return {
    async generate(input) {
      let budget = Math.min(
        FACTORY_MAX_OUTPUT_TOKENS,
        Math.max(4096, input.maxOutputTokens || 0),
      );
      let inputTokens = 0;
      let outputTokens = 0;
      let last = { text: "", inputTokens: 0, outputTokens: 0 };
      const started = Date.now();
      for (let attempt = 0; attempt < 2; attempt++) {
        last = await call({ ...input, maxOutputTokens: budget });
        inputTokens += last.inputTokens || 0;
        outputTokens += last.outputTokens || 0;
        if (isCompleteJson(last.text)) break;
        // sem tempo para outra tentativa nesta chamada: a etapa é retomada na próxima
        if (Date.now() - started > 60_000) break;
        budget = Math.min(FACTORY_MAX_OUTPUT_TOKENS, budget * 2);
      }
      return { ...last, inputTokens, outputTokens, model: model() };
    },
  };
}
export const realFactoryModel: FactoryModel = createFactoryModel(
  (input) =>
    GeminiProvider.generate({
      ...input,
      model: env.GEMINI_CODE_MODEL,
      responseFormat: "json",
      temperature: 0.3,
      timeoutMs: 180000,
      maxRetries: 0,
    }),
  () => env.GEMINI_CODE_MODEL,
);
const json = (s: string) =>
  JSON.parse(
    s
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, ""),
  );
export class ProfessionalBuildService {
  constructor(
    readonly repository: BuildRepository,
    private readonly adapter: FactoryAdapter,
    private readonly vault = new ProjectVariableService(),
    private readonly model: FactoryModel = realFactoryModel,
    private readonly wallet = CreditWalletService,
  ) {}
  async start(
    scope: BuildScope,
    brief: unknown,
    key: string,
    references: FactoryReference[] = [],
    initial?: { bundle?: ProfessionalBundle | null; media?: any; generationCreditLimit?: number },
  ) {
    if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key))
      throw new FactoryError(
        "invalid_request_key",
        "Identificador de solicitação inválido.",
        400,
      );
    const parsed = buildBriefSchema.parse(brief);
    const id = createHash("sha256")
      .update(
        JSON.stringify([scope.tenantId, scope.userId, scope.projectId, key]),
      )
      .digest("hex");
    const now = new Date().toISOString();
    const b = await this.repository.create({
      ...scope,
      id,
      brief: parsed,
      status: "queued",
      phase: 0,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      lease: null,
      reports: [],
      bundle: initial?.bundle || null,
      feedback: [],
      repairs: 0,
      errors: 0,
      error: null,
      billing: null,
      pendingBilling: null,
      consumedCredits: 0,
      certificate: null,
      publication: null,
      media: initial?.media || null,
      ...(initial?.generationCreditLimit ? { generationCreditLimit: initial.generationCreditLimit } : {}),
      references,
    });
    if (
      !sameScope(b, scope) ||
      stableJson(b.brief) !== stableJson(parsed) ||
      stableJson(b.references) !== stableJson(references)
    )
      throw new FactoryError(
        "request_key_conflict",
        "Esta solicitação já foi usada com outro conteúdo.",
      );
    return b;
  }
  async change(
    id: string,
    scope: BuildScope,
    instructions: string,
    key: string,
    options?: { maintenance?: boolean },
  ) {
    const previous = await this.get(id, scope);
    if (options?.maintenance && (previous.brief.media.images || previous.brief.media.video) && !previous.media?.complete)
      throw new FactoryError('maintenance_media_unavailable', 'A mídia anterior precisa estar confirmada antes da manutenção automática.');
    if (!["ready", "failed", "cancelled"].includes(previous.status))
      throw new FactoryError(
        "build_active",
        "Aguarde ou cancele a construção atual antes de alterar o projeto.",
      );
    const next = await this.start(
      scope,
      {
        ...previous.brief,
        prompt: (
          previous.brief.prompt +
          "\n\nALTERAÇÃO SOLICITADA: " +
          instructions
        ).slice(-16000),
      },
      key,
      previous.references,
      { bundle: previous.bundle,
        ...(options?.maintenance ? {
          generationCreditLimit: 95,
          media: previous.media?.complete ? { ...previous.media,
            assets: (previous.media.assets || []).map((asset: any) => ({ ...asset, creditsSpent: 0, reusedFromBuildId: previous.id })),
          } : null,
        } : {}),
      },
    );
    // Alteração em projeto já gerado: reaproveita o planejamento dos especialistas e vai
    // direto para a geração em partes, que reescreve só os arquivos afetados.
    if (previous.bundle && next.phase === 0 && !next.reports.length) {
      const token = randomUUID();
      const claimed = await this.repository.claim(next.id, scope, token, Date.now());
      if (claimed && claimed.phase === 0) {
        claimed.reports = previous.reports;
        claimed.phase = 10;
        claimed.status = "generating";
        claimed.feedback = [
          "ALTERAÇÃO SOLICITADA PELA PESSOA (aplique exatamente isto e mantenha o resto igual): " +
            instructions.slice(0, 4000),
        ];
        claimed.lease = null;
        await this.repository.save(claimed, token);
      }
    }
    // The previous bundle is initialized atomically with the new build. A
    // duplicate change request must never overwrite a newer generated bundle.
    return this.get(next.id, scope);
  }
  async reconfigure(id: string, scope: BuildScope, key: string) {
    const previous = await this.get(id, scope);
    if (
      !previous.bundle ||
      !["ready", "failed", "cancelled"].includes(previous.status)
    )
      throw new FactoryError(
        "build_active",
        "Conclua ou cancele a construção antes de reaplicar a configuração.",
      );
    const next = await this.start(
      scope,
      previous.brief,
      key,
      previous.references,
    );
    if (next.phase === 0) {
      const token = randomUUID();
      const claimed = await this.repository.claim(
        next.id,
        scope,
        token,
        Date.now(),
      );
      if (claimed) {
        claimed.bundle = previous.bundle;
        claimed.reports = previous.reports;
        claimed.phase = 12;
        claimed.status = "configuration_required";
        claimed.lease = null;
        await this.repository.save(claimed, token);
      }
    }
    return this.get(next.id, scope);
  }
  async get(id: string, scope: BuildScope) {
    const b = await this.repository.get(id, scope);
    if (!b)
      throw new FactoryError("build_not_found", "Projeto não encontrado.", 404);
    return b;
  }
  projectKey(b: BuildScope) {
    return JSON.stringify([b.tenantId, b.userId, b.projectId]);
  }
  files(b: ProfessionalBuild) {
    if (!b.bundle)
      throw new FactoryError(
        "project_not_generated",
        "Projeto ainda não gerado.",
      );
    return scaffoldProject(b.bundle, this.projectKey(b));
  }
  private async settle(b: ProfessionalBuild, token: string) {
    if (b.pendingBilling) {
      const p = b.pendingBilling;
      await this.wallet.confirmConsumption({
        userId: b.userId,
        reservationId: p.reservationId!,
        amountConsumed: p.amount,
        operation: "Fábrica profissional",
        idempotencyKey: p.key + ":confirm",
      });
      b.consumedCredits += p.amount;
      b.pendingBilling = null;
      await this.repository.save(b, token);
    }
  }
  private async recoverBilling(b: ProfessionalBuild, token: string) {
    if (!b.billing) return;
    const p = b.billing;
    const reservation =
      p.reservationId ||
      (
        await this.wallet.reserveCredits({
          userId: b.userId,
          amount: p.amount,
          operation: "Fábrica profissional",
          idempotencyKey: p.key,
        })
      ).reservationId;
    await this.wallet.releaseReservation({
      userId: b.userId,
      reservationId: reservation,
      operation: "Etapa interrompida sem resultado certificado",
      idempotencyKey: p.key + ":release",
    });
    b.billing = null;
    await this.repository.save(b, token);
  }
  /** Vários lotes de arquivos em paralelo, com uma única reserva de créditos. */
  private async generatedMany(
    b: ProfessionalBuild,
    token: string,
    amountEach: number,
    system: string,
    messages: string[],
    maxOutputTokens: number,
  ) {
    await this.openModelCall(b, token, amountEach * messages.length);
    const results = await Promise.allSettled(
      messages.map((message) =>
        this.model.generate({
          systemInstruction: system,
          userMessage: message,
          maxOutputTokens,
          attachments: [],
        }),
      ),
    );
    b.modelCall = null;
    if (results.every((r) => r.status === "rejected"))
      throw (results[0] as PromiseRejectedResult).reason;
    return results.map((r) => (r.status === "fulfilled" ? r.value : null));
  }
  private async openModelCall(b: ProfessionalBuild, token: string, amount: number) {
    if (b.generationCreditLimit && b.consumedCredits + amount > b.generationCreditLimit)
      throw new FactoryError('maintenance_budget_exhausted', 'O limite de créditos desta manutenção foi atingido.');
    const bill: Billing = {
      key: "factory:" + b.id + ":" + randomUUID(),
      amount,
      reservationId: null,
    };
    const attempts =
      b.modelCall && b.modelCall.phase === b.phase ? b.modelCall.attempts + 1 : 1;
    if (attempts > MAX_MODEL_CALL_ATTEMPTS) {
      b.modelCall = null;
      throw new FactoryError(
        "model_call_timeout",
        "A etapa " + (b.phase + 1) + " passou do tempo limite do servidor " + MAX_MODEL_CALL_ATTEMPTS + " vezes seguidas. Toque em “Retomar construção” para tentar de novo; os créditos dessas tentativas foram devolvidos.",
      );
    }
    b.modelCall = { phase: b.phase, attempts };
    b.billing = bill;
    await this.repository.save(b, token);
    const reserved = await this.wallet.reserveCredits({
      userId: b.userId,
      amount,
      operation: "Fábrica profissional",
      idempotencyKey: bill.key,
    });
    bill.reservationId = reserved.reservationId;
    await this.repository.save(b, token);
  }
  private async generated(
    b: ProfessionalBuild,
    token: string,
    amount: number,
    system: string,
    message: string,
    maxOutputTokens: number,
    includeReferences = true,
  ) {
    await this.openModelCall(b, token, amount);
    const attachments: Array<{ type: string; data: string; mimeType: string }> =
      [];
    if (includeReferences && b.references.length && (b.phase === 0 || b.phase === 10)) {
      const { getMediaStorageBucket } = await import("../lib/firebaseAdmin.js");
      const bucket = await getMediaStorageBucket();
      for (const reference of b.references) {
        if (!reference.path.startsWith("factory-inputs/" + b.userId + "/"))
          throw new FactoryError(
            "attachment_scope_invalid",
            "Anexo fora do projeto.",
          );
        const [bytes] = await bucket.file(reference.path).download();
        if (
          createHash("sha256").update(bytes).digest("hex") !== reference.sha256
        )
          throw new FactoryError(
            "attachment_changed",
            "O anexo mudou após a importação.",
          );
        if (
          /^(?:image|audio|video)\//.test(reference.mimeType) ||
          reference.mimeType === "application/pdf"
        )
          attachments.push({
            type: "inline",
            data: bytes.toString("base64"),
            mimeType: reference.mimeType,
          });
        else
          message +=
            "\nAnexo " + reference.name + ":\n" + bytes.toString("utf8");
      }
    }
    const result = await this.model.generate({
      systemInstruction: system,
      userMessage: message,
      maxOutputTokens,
      attachments,
    });
    b.modelCall = null;
    return result;
  }
  async advance(id: string, scope: BuildScope) {
    const token = randomUUID();
    const b = await this.repository.claim(id, scope, token, Date.now());
    if (!b) return this.get(id, scope);
    try {
      await this.settle(b, token);
      await this.recoverBilling(b, token);
      b.error = null;
      if (
        b.phase === 14 &&
        b.certificate?.artifactDigest !== sourceDigest(this.files(b).files)
      ) {
        if (b.publication?.productionId && this.adapter.cancel)
          await this.adapter.cancel(b);
        b.phase = 13;
        b.status = "certifying";
        b.certificate = null;
        b.publication = null;
      }
      const context = JSON.stringify({
        brief: b.brief,
        reports: b.reports,
        feedback: b.feedback,
        media: b.media,
      });
      if (b.phase < 10) {
        b.status = "planning";
        const stage = FACTORY_STAGES[b.phase];
        const agents = CREATION_AGENTS.filter((a) => a.stage === stage.id);
        const result = await this.generated(
          b,
          token,
          2,
          "Você participa da fábrica profissional. Devolva JSON {contributions:[{agentId,decisions:string[],tests:string[]}]}. Cada perfil precisa de decisões específicas e testes. Cada decisão deve explicar motivo, arquivo ou fluxo afetado e critério observável. Cada teste deve descrever entrada, ação e resultado esperado. Integre as decisões anteriores. Não alegue testes executados. SEJA CONCISO: por perfil, de 2 a 4 decisões (cada uma com no máximo 300 caracteres) e de 2 a 3 testes (cada um com no máximo 220 caracteres); o JSON inteiro deve ter menos de 12000 caracteres.\n" +
            AGENT_EXECUTION_PROTOCOL +
            "\n" +
            FACTORY_DISCIPLINE_PROTOCOL[stage.id] +
            "\n" +
            agents.map(describeAgent).join("\n\n"),
          context,
          16384,
        );
        const report = json(result.text);
        if (
          !Array.isArray(report.contributions) ||
          report.contributions.length !== 5
        )
          throw new FactoryError(
            "invalid_agent_report",
            "A disciplina não entregou os cinco pareceres.",
          );
        for (const agent of agents) {
          const rows = report.contributions.filter(
            (r: any) => r.agentId === agent.id,
          );
          if (
            rows.length !== 1 ||
            !Array.isArray(rows[0].decisions) ||
            !rows[0].decisions.length ||
            rows[0].decisions.length > 20 ||
            !Array.isArray(rows[0].tests) ||
            !rows[0].tests.length ||
            rows[0].tests.length > 20 ||
            rows[0].decisions.some(
              (x: any) => typeof x !== "string" || x.trim().length < 10 || x.length > 1500,
            ) ||
            rows[0].tests.some(
              (x: any) => typeof x !== "string" || x.trim().length < 10 || x.length > 800,
            )
          )
            throw new FactoryError(
              "invalid_agent_report",
              "Parecer sem decisões ou cenários válidos.",
            );
        }
        if (Buffer.byteLength(JSON.stringify(report)) > 18000)
          throw new FactoryError(
            "agent_report_too_large",
            "Parecer excessivamente longo.",
          );
        b.reports.push({
          stage: stage.id,
          contributions: report.contributions,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
        b.phase++;
      } else if (b.phase === 10) {
        b.status = "generating";
        if (
          (b.brief.media.images || b.brief.media.video) &&
          !b.media?.complete
        ) {
          b.media = await this.adapter.media(b);
          await this.repository.save(b, token);
          if (!b.media.complete) {
            b.lease = null;
            await this.repository.save(b, token);
            return b;
          }
        }
        const assembled = await this.generateStep(b, token);
        if (assembled) {
          b.bundle = assembled;
          b.generation = null;
          b.phase = 11;
        }
      } else if (b.phase === 11) {
        b.status = "reviewing";
        const result = await this.generated(
          b,
          token,
          5,
          "Revise independentemente a cobertura e o código. Retorne JSON {passed:boolean,issues:string[]}. Reprove código incompleto, integrações simuladas, autorização ausente, pagamentos sem webhook, dados não persistidos, conteúdo genérico e testes triviais. Não alegue executar testes.\n" +
            PROFESSIONAL_GENERATION_CONTRACT,
          JSON.stringify({ brief: b.brief, bundle: b.bundle }),
          16384,
        );
        const review = json(result.text);
        if (
          typeof review.passed !== "boolean" ||
          !Array.isArray(review.issues) ||
          review.issues.some(
            (x: any) => typeof x !== "string" || x.length > 800,
          ) ||
          review.issues.length > 40
        )
          throw new FactoryError("invalid_review", "Revisão inválida.");
        if (!review.passed || review.issues.length) {
          if (++b.repairs > 2)
            throw new FactoryError(
              "review_exhausted",
              "A geração não passou na revisão após duas correções.",
            );
          b.feedback = review.issues.length
            ? review.issues
            : ["A revisão recusou a implementação."];
          b.phase = 10;
        } else b.phase = 12;
      } else if (b.phase === 12) {
        const missing = await this.missingVariables(b);
        if (missing.length) b.status = "configuration_required";
        else {
          b.status = "certifying";
          b.phase = 13;
        }
      } else if (b.phase === 13) {
        b.status = "certifying";
        b.certificate = await this.adapter.certify(b, this.files(b).files);
        if (b.certificate.status === "failed") {
          if (++b.repairs > 2)
            throw new FactoryError(
              "certification_failed",
              b.certificate.message ||
                "Instalação, testes ou build reprovados.",
            );
          b.feedback = [
            b.certificate.message || "Certificação reprovada.",
            b.certificate.diagnostic || "",
          ];
          b.phase = 10;
          b.status = "generating";
          b.certificate = null;
        }
        if (b.certificate?.status === "passed") {
          b.phase = 14;
          b.status = "publishing";
        }
      } else if (b.phase === 14) {
        b.status = "publishing";
        if (b.brief.autoPublish) {
          b.publication = await this.adapter.publish(b, this.files(b).files);
          if (b.publication.status === "failed") {
            if (b.publication.rollback?.verified === false || ++b.repairs > 2)
              throw new FactoryError(
                "publication_failed",
                b.publication.message || "A publicação não foi aprovada.",
              );
            b.feedback = [
              b.publication.message || "Jornadas de navegador reprovadas.",
              JSON.stringify(
                b.publication.previewBrowser?.results ||
                  b.publication.productionBrowser?.results ||
                  [],
              ),
            ];
            b.phase = 10;
            b.status = "generating";
            b.publication = null;
            b.certificate = null;
          }
          if (b.publication?.status === "ready") {
            b.phase = 15;
            b.status = "ready";
          }
        }
      }
      if (b.billing) {
        b.pendingBilling = b.billing;
        b.billing = null;
        await this.repository.save(b, token);
        await this.settle(b, token);
      }
      b.updatedAt = new Date().toISOString();
      b.lease = null;
      await this.repository.save(b, token);
      return b;
    } catch (error) {
      const current = await this.repository.get(id, scope);
      if (current?.lease?.token !== token) {
        if (b.billing?.reservationId)
          await this.wallet
            .releaseReservation({
              userId: b.userId,
              reservationId: b.billing.reservationId,
              operation: "Etapa cancelada",
              idempotencyKey: b.billing.key + ":release",
            })
            .catch(() => {});
        return current || b;
      }
      await this.recoverBilling(b, token).catch(() => {});
      b.errors++;
      b.status = "failed";
      b.error =
        error instanceof FactoryError
          ? error.message
          : error instanceof SyntaxError
            ? "A resposta estruturada foi interrompida. Retome para gerar novamente."
            : (error as any)?.name === "ZodError"
              ? "O projeto não cumpriu o contrato de entrega. Retome para corrigir."
              : "A etapa não foi concluída. Confira a configuração do provedor e retome.";
      if (
        b.errors < 5 &&
        (error instanceof SyntaxError ||
          (error as any)?.name === "ZodError" ||
          (error instanceof FactoryError &&
            /^(?:invalid_|missing_|uncovered_|incomplete_|backend_|reserved_|duplicate_|payment_not|variable_value)/.test(
              error.code,
            )))
      ) {
        b.feedback =
          (error as any)?.name === "ZodError"
            ? [
                b.error,
                "Corrija exatamente estes pontos do formato de entrega: " +
                  describeContractIssues(error),
              ]
            : [b.error];
        b.status = b.phase < 10 ? "planning" : "generating";
      }
      b.updatedAt = new Date().toISOString();
      b.lease = null;
      await this.repository.save(b, token);
      return b;
    }
  }
  /**
   * Um passo da geração em partes. Devolve o projeto montado quando todos os
   * arquivos estiverem escritos; senão devolve null e o próximo avanço continua.
   */
  private async generateStep(
    b: ProfessionalBuild,
    token: string,
  ): Promise<ProfessionalBundle | null> {
    const g: GenerationProgress = (b.generation ||= {
      plan: null,
      manifest: [],
      files: (b.bundle?.files || []).map((f) => ({ path: f.path, content: f.content })),
    });
    const written = new Map(g.files.map((f) => [f.path, f.content]));
    const sync = () => {
      g.files = Array.from(written, ([path, content]) => ({ path, content }));
    };
    const policy =
      creationTeamPolicy("project") + "\n\n" + PROFESSIONAL_GENERATION_CONTRACT;
    if (!g.plan) {
      const result = await this.generated(
        b,
        token,
        4,
        policy + "\n\n" + CHUNKED_PLAN_PROTOCOL,
        JSON.stringify({
          brief: b.brief,
          reports: b.reports,
          feedback: b.feedback,
          media: b.media,
          existingFiles: Array.from(written, ([path, content]) => ({
            path,
            exports: exportsOf(content),
          })),
        }),
        24576,
      );
      const plan = json(result.text);
      // Projeto pequeno: o modelo pode já devolver tudo pronto (arquivos com conteúdo).
      if (
        !Array.isArray(plan?.fileManifest) &&
        Array.isArray(plan?.files) &&
        plan.files.length &&
        plan.files.every((f: any) => typeof f?.content === "string" && f.content.trim())
      )
        return parseBundle(JSON.stringify(plan));
      const manifest = Array.isArray(plan?.fileManifest) ? plan.fileManifest : null;
      const seen = new Set<string>();
      if (
        !manifest ||
        manifest.length < 3 ||
        manifest.length > MAX_MANIFEST_FILES ||
        manifest.some((f: any) => {
          const bad =
            !f ||
            typeof f.path !== "string" ||
            f.path.length > 200 ||
            !MANIFEST_PATH.test(f.path) ||
            RESERVED_MANIFEST_PATH.test(f.path) ||
            f.path.split("/").some((v: string) => !v || v === "." || v === "..") ||
            seen.has(f.path) ||
            typeof f.purpose !== "string";
          seen.add(f?.path);
          return bad;
        }) ||
        !seen.has("index.html")
      )
        throw new FactoryError(
          "invalid_file_manifest",
          "O plano de arquivos veio incompleto (é preciso listar index.html e todos os arquivos, no máximo " +
            MAX_MANIFEST_FILES +
            ").",
        );
      delete plan.fileManifest;
      delete plan.files;
      g.manifest = manifest.map((f: any) => ({
        path: f.path,
        purpose: String(f.purpose).slice(0, 600),
        // Depois de falha na montagem, o que já foi escrito fica (a menos que keep:false);
        // em correções pedidas pela revisão, só fica o que o plano mandar manter.
        keep: written.has(f.path) && (g.replan ? f.keep !== false : f.keep === true),
      }));
      // Só ficam os arquivos que o plano mandou manter; o resto será (re)escrito.
      for (const path of Array.from(written.keys()))
        if (!g.manifest.some((f) => f.keep && f.path === path)) written.delete(path);
      sync();
      g.plan = plan;
      g.replan = false;
      return null;
    }
    const pending = g.manifest.filter((f) => !written.has(f.path));
    if (pending.length) {
      const groups: Array<typeof pending> = [];
      for (
        let i = 0;
        i < pending.length && groups.length < PARALLEL_FILE_BATCHES;
        i += FILE_BATCH_SIZE
      )
        groups.push(pending.slice(i, i + FILE_BATCH_SIZE));
      const notes = g.retryNotes || [];
      let budget = 70000;
      const writtenFiles = Array.from(written, ([path, content]) => {
        if (content.length <= budget) {
          budget -= content.length;
          return { path, content };
        }
        return { path, exports: exportsOf(content) };
      });
      const messages = groups.map((batch) => {
        const previousContent = Object.fromEntries(
          (b.bundle?.files || [])
            .filter((f) => batch.some((x) => x.path === f.path))
            .map((f) => [f.path, f.content.slice(0, 40000)]),
        );
        const rejected = notes.filter((n) => batch.some((x) => x.path === n.path));
        return JSON.stringify({
          brief: b.brief,
          plan: g.plan,
          fileManifest: g.manifest,
          feedback: b.feedback,
          media: b.media,
          writtenFiles,
          writeNow: batch,
          ...(Object.keys(previousContent).length ? { previousContent } : {}),
          ...(rejected.length ? { rejectedLastTime: rejected } : {}),
        });
      });
      const results = await this.generatedMany(
        b,
        token,
        2,
        policy + "\n\n" + CHUNKED_FILES_PROTOCOL,
        messages,
        32768,
      );
      let accepted = 0;
      const nextNotes: Array<{ path: string; reason: string }> = [];
      results.forEach((result, index) => {
        const batch = groups[index];
        let out: any = null;
        try {
          out = result ? json(result.text) : null;
        } catch {
          out = null;
        }
        for (const f of Array.isArray(out?.files) ? out.files : []) {
          if (
            !f ||
            typeof f.path !== "string" ||
            typeof f.content !== "string" ||
            !f.content.trim() ||
            f.content.length > 200000 ||
            !batch.some((x) => x.path === f.path)
          )
            continue;
          // Cada arquivo é conferido na hora: um problema num arquivo não derruba o projeto inteiro.
          const problem = fileProblem(f.path, f.content);
          if (problem) {
            nextNotes.push({ path: f.path, reason: problem });
            continue;
          }
          if (!written.has(f.path)) accepted++;
          written.set(f.path, f.content);
        }
      });
      g.retryNotes = nextNotes.slice(0, 40);
      sync();
      if (!accepted)
        throw new FactoryError(
          "invalid_files_batch",
          nextNotes.length
            ? "Arquivos recusados (" + nextNotes.map((n) => n.path).join(", ").slice(0, 300) + "). Gerando de novo."
            : "O lote de arquivos veio vazio. Gerando de novo.",
        );
      if (g.manifest.some((f) => !written.has(f.path))) return null;
    }
    try {
      return parseBundle(
        JSON.stringify({
          ...g.plan,
          files: g.manifest.map((f) => ({ path: f.path, content: written.get(f.path)! })),
        }),
      );
    } catch (error) {
      // Plano inconsistente com os arquivos: refaz só o plano; os arquivos escritos ficam.
      g.plan = null;
      g.replan = true;
      throw error;
    }
  }
  async missingVariables(b: ProfessionalBuild) {
    if (!b.bundle) return [];
    const [preview, production] = await Promise.all([
      this.vault.resolve(b, "preview"),
      this.vault.resolve(b, "production"),
    ]);
    const listed = await this.vault.list(b);
    return b.bundle.variables.filter(
      (v) =>
        (v.environment === "both"
          ? ["preview", "production"]
          : [v.environment]
        ).some(
          (environment) =>
            !listed.variables.some(
              (entry) =>
                entry.name === v.name &&
                entry.visibility === v.visibility &&
                entry.configured &&
                (entry.environment === environment ||
                  entry.environment === "both"),
            ),
        ) ||
        ((v.environment === "preview" || v.environment === "both") &&
          !preview[v.name]) ||
        ((v.environment === "production" || v.environment === "both") &&
          !production[v.name]),
    );
  }
  async resume(id: string, scope: BuildScope) {
    const b = await this.get(id, scope);
    if (b.status === "cancelled" || b.status === "ready") return b;
    // Cada toque em "Retomar" libera uma nova rodada curta de tentativas automáticas.
    // O teto é por retomadas manuais (e não por erros acumulados), para uma construção
    // com o código já escrito não ficar presa para sempre.
    const manualResumes = (b.manualResumes || 0) + 1;
    if (manualResumes > MAX_MANUAL_RESUMES)
      throw new FactoryError(
        "resume_limit",
        "Limite de retomadas atingido. Fale com a Froc.IA no chat para gerar uma nova construção aproveitando o que já foi feito.",
      );
    const errors = Math.min(b.errors, 3);
    // Claims ignore failed tasks: atomically reopen via repository implementation.
    if (this.repository instanceof FirestoreBuildRepository) {
      const ref = adminDb.collection("site_factory_builds").doc(id);
      await adminDb.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const current = doc.data() as ProfessionalBuild;
        if (!sameScope(current, scope) || current.lease?.expires > Date.now())
          throw new FactoryError(
            "build_busy",
            "Uma etapa ainda está em execução.",
          );
        if (["ready", "cancelled"].includes(current.status)) return;
        tx.update(ref, {
          status:
            current.phase < 10
              ? "planning"
              : current.phase < 12
                ? "generating"
                : current.phase === 12
                  ? "configuration_required"
                  : current.phase === 13
                    ? "certifying"
                    : "publishing",
          error: null,
          modelCall: null,
          errors,
          manualResumes,
        });
      });
    } else if (this.repository instanceof InMemoryBuildRepository) {
      b.status = "queued";
      b.error = null;
      b.modelCall = null;
      b.errors = errors;
      b.manualResumes = manualResumes;
      this.repository.builds.set(id, b);
    }
    return this.advance(id, scope);
  }
  async cancel(id: string, scope: BuildScope) {
    const b = await this.repository.cancel(id, scope);
    if (this.adapter.cancel) await this.adapter.cancel(b);
    if (b.pendingBilling) {
      const p = b.pendingBilling;
      await this.wallet.confirmConsumption({
        userId: b.userId,
        reservationId: p.reservationId!,
        amountConsumed: p.amount,
        idempotencyKey: p.key + ":confirm",
      });
    }
    if (b.billing) {
      const p = b.billing;
      const id =
        p.reservationId ||
        (
          await this.wallet.reserveCredits({
            userId: b.userId,
            amount: p.amount,
            operation: "Fábrica profissional",
            idempotencyKey: p.key,
          })
        ).reservationId;
      await this.wallet.releaseReservation({
        userId: b.userId,
        reservationId: id,
        idempotencyKey: p.key + ":release",
      });
    }
    return b;
  }
  async publicView(b: ProfessionalBuild) {
    return {
      id: b.id,
      projectId: b.projectId,
      status: b.status,
      phase: b.phase,
      progress: Math.floor(
        ((b.phase +
          (b.phase === 10 && b.generation?.manifest.length
            ? b.generation.files.length / b.generation.manifest.length
            : 0)) /
          15) *
          100,
      ),
      generation:
        b.phase === 10 && b.generation
          ? {
              planned: b.generation.manifest.length,
              written: b.generation.files.length,
            }
          : null,
      updatedAt: b.updatedAt,
      // Sem etapa rodando e sem avanço há mais de 6 minutos: o painel oferece "Retomar".
      stalled:
        !["ready", "failed", "cancelled", "configuration_required"].includes(b.status) &&
        !(b.lease && b.lease.expires > Date.now()) &&
        Date.now() - Date.parse(b.updatedAt) > 6 * 60 * 1000 &&
        !(b.phase === 13 && b.certificate?.status === "waiting_executor"),
      waitingExecutor: b.phase === 13 && b.certificate?.status === "waiting_executor",
      sourceDigest: b.bundle ? sourceDigest(b.bundle.files) : null,
      title: b.bundle?.title || "Novo projeto",
      error: b.error,
      consumedCredits:
        b.consumedCredits +
        (b.media?.assets || []).reduce(
          (n: number, a: any) => n + (a.creditsSpent || 0),
          0,
        ),
      estimatedMaximumCredits:
        b.generationCreditLimit || (95 + b.brief.media.images * 18 + (b.brief.media.video ? 120 : 0)),
      completedAgentIds: b.reports.flatMap((r) =>
        r.contributions.map((c) => c.agentId),
      ),
      requiredVariables: b.bundle?.variables || [],
      missingVariables: (await this.missingVariables(b)).map((v) => ({
        name: v.name,
        purpose: v.purpose,
        visibility: v.visibility,
        environment: v.environment,
      })),
      suggestedSiteUrl:
        "https://" + managedProjectName(this.projectKey(b)) + ".vercel.app",
      publication: b.publication,
      certificate: b.certificate,
      media: b.media,
      ready: b.status === "ready",
      monitoring: b.monitoring || null,
      autoPublish: b.brief.autoPublish,
    };
  }
}
