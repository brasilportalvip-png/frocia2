import { createHash } from "node:crypto";
import { z } from "zod";
import { adminDb } from "../lib/firebaseAdmin.js";
import {
  encryptPersonalMemory,
  decryptPersonalMemory,
  type EncryptedMemoryContent,
} from "../ai/memoryCryptoService.js";

export const projectVariableSchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
    purpose: z.string().trim().min(3).max(200),
    visibility: z.enum(["public", "secret"]),
    environment: z.enum(["preview", "production", "both"]),
    value: z.string().max(16000).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (
      /^(?:VERCEL_|GITHUB_|SELF_EVOLUTION_|MEMORY_|BACKUP_|NODE_|NPM_|FROC_)|^(?:PATH|HOME|PORT|CI)$/.test(
        entry.name,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Nome reservado para a plataforma.",
        path: ["name"],
      });
    }
    if (
      entry.visibility === "public" &&
      /TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL|SERVICE_ACCOUNT|DATABASE_URL/.test(
        entry.name,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Esta variável precisa ser secreta.",
        path: ["visibility"],
      });
    }
    if (
      entry.visibility === "public" &&
      /API_KEY|ACCESS_KEY/.test(entry.name) &&
      !/^(?:(?:VITE_|PUBLIC_))?FIREBASE_API_KEY$/.test(entry.name)
    )
      ctx.addIssue({
        code: "custom",
        message: "Chaves de API privadas devem ser secretas.",
        path: ["visibility"],
      });
    if (
      entry.visibility === "secret" &&
      /^(?:VITE_|NEXT_PUBLIC_|PUBLIC_)/.test(entry.name)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Segredos não podem usar prefixos de exposição pública.",
        path: ["name"],
      });
    }
    if (entry.value && entry.name === "PUBLIC_SITE_URL") {
      try {
        const url = new URL(entry.value);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          url.pathname !== "/" ||
          url.search ||
          url.hash ||
          !url.hostname.includes(".") ||
          /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)
        )
          throw new Error();
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Use uma origem HTTPS pública, sem caminho.",
          path: ["value"],
        });
      }
    }
    if (
      entry.value &&
      entry.name === "PUBLIC_CONTACT_EMAIL" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.value)
    )
      ctx.addIssue({
        code: "custom",
        message: "E-mail de contato inválido.",
        path: ["value"],
      });
    if (
      entry.visibility === "public" &&
      entry.value &&
      /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk_live_|sk_test_|ghp_|github_pat_)[A-Za-z0-9]|"private_key"\s*:/.test(
        entry.value,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "O valor contém uma credencial privada.",
        path: ["value"],
      });
    }
  });
export type ProjectVariableInput = z.infer<typeof projectVariableSchema>;
export interface VariableScope {
  projectId: string;
  tenantId: string;
  userId: string;
}
export interface VariableDocument {
  revision: number;
  encrypted: EncryptedMemoryContent;
  scope?: VariableScope;
}
export interface VariableRepository {
  read(key: string): Promise<VariableDocument | null>;
  write(
    key: string,
    expectedRevision: number,
    value: VariableDocument,
  ): Promise<void>;
}
export class VariableConflictError extends Error {
  readonly code = "variables_changed";
  readonly httpStatus = 409;
  constructor() {
    super("As variáveis mudaram. Recarregue antes de salvar.");
  }
}
export class FirestoreVariableRepository implements VariableRepository {
  async read(key: string) {
    const doc = await adminDb
      .collection("site_factory_variables")
      .doc(key)
      .get();
    return doc.exists ? (doc.data() as VariableDocument) : null;
  }
  async write(key: string, revision: number, value: VariableDocument) {
    const ref = adminDb.collection("site_factory_variables").doc(key);
    await adminDb.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (Number(doc.data()?.revision || 0) !== revision)
        throw new VariableConflictError();
      if (value.scope) {
        const project = await tx.get(
          adminDb.collection("projects").doc(value.scope.projectId),
        );
        if (
          !project.exists ||
          project.data()?.userId !== value.scope.userId ||
          project.data()?.tenantId !== value.scope.tenantId
        )
          throw new Error("invalid_variable_scope");
        const buildId = project.data()?.professionalBuildId;
        if (buildId) {
          const build = await tx.get(
            adminDb.collection("site_factory_builds").doc(buildId),
          );
          if (
            build.exists &&
            build.data()?.phase >= 13 &&
            ["certifying", "publishing"].includes(build.data()?.status)
          )
            throw Object.assign(
              new Error(
                "A configuração está em verificação. Aguarde ou cancele antes de alterar.",
              ),
              { code: "configuration_locked", httpStatus: 409 },
            );
        }
      }
      tx.set(ref, value);
    });
  }
}
export class InMemoryVariableRepository implements VariableRepository {
  readonly docs = new Map<string, VariableDocument>();
  async read(key: string) {
    return structuredClone(this.docs.get(key) || null);
  }
  async write(key: string, revision: number, value: VariableDocument) {
    if ((this.docs.get(key)?.revision || 0) !== revision)
      throw new VariableConflictError();
    this.docs.set(key, structuredClone(value));
  }
}
function variableKey(scope: VariableScope) {
  return createHash("sha256")
    .update(JSON.stringify([scope.tenantId, scope.userId, scope.projectId]))
    .digest("hex");
}
function checkedScope(scope: VariableScope) {
  if (
    ![scope.tenantId, scope.userId, scope.projectId].every(
      (s) =>
        typeof s === "string" &&
        s.length > 0 &&
        s.length <= 160 &&
        !/[\x00-\x1f]/.test(s),
    )
  )
    throw new Error("invalid_variable_scope");
  return variableKey(scope);
}
export class ProjectVariableService {
  constructor(
    private readonly repo: VariableRepository = new FirestoreVariableRepository(),
  ) {}
  private async raw(scope: VariableScope) {
    const key = checkedScope(scope);
    const doc = await this.repo.read(key);
    return {
      key,
      revision: doc?.revision || 0,
      entries: doc
        ? (JSON.parse(
            decryptPersonalMemory(
              doc.encrypted as unknown as Record<string, unknown>,
              key,
              scope.userId,
            ),
          ) as ProjectVariableInput[])
        : [],
    };
  }
  async list(scope: VariableScope) {
    const doc = await this.raw(scope);
    return {
      revision: doc.revision,
      variables: doc.entries.map(({ value, ...entry }) => ({
        ...entry,
        configured: Boolean(value),
        ...(entry.visibility === "public" ? { value } : {}),
      })),
    };
  }
  async save(scope: VariableScope, expectedRevision: number, input: unknown) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error("invalid_variable_revision");
    const entries = z.array(projectVariableSchema).max(50).parse(input);
    const current = await this.raw(scope);
    if (current.revision !== expectedRevision)
      throw new VariableConflictError();
    const next = entries.map((entry) => {
      const previous = current.entries.find(
        (p) => p.name === entry.name && p.environment === entry.environment,
      );
      // Não promover segredo anterior a valor público por alteração de rótulo.
      const value =
        entry.value ??
        (previous?.visibility === entry.visibility
          ? previous.value
          : undefined);
      if (value === undefined) throw new Error("variable_value_required");
      return {
        ...entry,
        value:
          entry.name === "PUBLIC_SITE_URL" && value
            ? new URL(value).origin
            : value,
      };
    });
    for (let i = 0; i < next.length; i++)
      for (let j = i + 1; j < next.length; j++) {
        if (
          next[i].name === next[j].name &&
          next[i].visibility !== next[j].visibility
        )
          throw new Error("invalid_variable_visibility_mismatch");
        if (
          next[i].name === next[j].name &&
          (next[i].environment === next[j].environment ||
            next[i].environment === "both" ||
            next[j].environment === "both")
        )
          throw new Error("overlapping_variable_environments");
      }
    if (Buffer.byteLength(JSON.stringify(next), "utf8") > 64000)
      throw new Error("variables_too_large");
    await this.repo.write(current.key, expectedRevision, {
      scope,
      revision: expectedRevision + 1,
      encrypted: encryptPersonalMemory(
        JSON.stringify(next),
        current.key,
        scope.userId,
      ),
    });
    return this.list(scope);
  }
  /** Somente backend; nunca enviar estes valores ao modelo, cliente ou logs. */
  async resolve(
    scope: VariableScope,
    environment: "preview" | "production",
    publicOnly = false,
  ) {
    const { entries } = await this.raw(scope);
    return Object.fromEntries(
      entries
        .filter(
          (v) =>
            (v.environment === environment || v.environment === "both") &&
            (!publicOnly || v.visibility === "public"),
        )
        .map((v) => [v.name, v.value!]),
    );
  }
}
