import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { createRateLimiter } from "../middlewares/rateLimiter.js";
import { adminDb, isFirebaseAdminConfigured } from "../lib/firebaseAdmin.js";
import type { AuthenticatedRequest } from "../types.js";
import {
  ProjectVariableService,
  projectVariableSchema,
} from "../siteFactory/projectVariableService.js";

export const projectVariableRouter = Router();
const service = new ProjectVariableService();
projectVariableRouter.use(
  requireAuth,
  createRateLimiter({
    windowMs: 60000,
    max: 40,
    keyPrefix: "project-variables",
  }),
);
projectVariableRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const bodySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    variables: z.array(projectVariableSchema).max(50),
  })
  .strict();
async function scope(req: AuthenticatedRequest) {
  if (!isFirebaseAdminConfigured())
    throw Object.assign(new Error("Variáveis indisponíveis."), {
      httpStatus: 503,
    });
  const projectId = z
    .string()
    .regex(/^[A-Za-z0-9:_-]{1,160}$/)
    .parse(req.params.projectId);
  const project = await adminDb.collection("projects").doc(projectId).get();
  if (
    !project.exists ||
    project.data()?.userId !== req.user!.uid ||
    project.data()?.tenantId !== req.user!.tenantId
  ) {
    throw Object.assign(new Error("Projeto não encontrado ou sem acesso."), {
      httpStatus: 404,
      code: "project_not_found",
    });
  }
  return { projectId, userId: req.user!.uid, tenantId: req.user!.tenantId };
}
function failed(res: any, error: any) {
  const invalid =
    error instanceof z.ZodError ||
    /^(?:invalid_|overlapping_|variable_value_|variables_too_)/.test(
      error?.message || "",
    );
  return res.status(invalid ? 400 : error?.httpStatus || 503).json({
    error: {
      code: invalid
        ? "invalid_project_variables"
        : error?.code || "variables_unavailable",
      message: invalid
        ? "Confira os nomes, ambientes e valores das variáveis."
        : error?.httpStatus
          ? error.message
          : "Não foi possível acessar as variáveis com segurança.",
    },
  });
}
projectVariableRouter.get(
  "/:projectId",
  async (req: AuthenticatedRequest, res) => {
    try {
      return res.json(await service.list(await scope(req)));
    } catch (e) {
      return failed(res, e);
    }
  },
);
projectVariableRouter.put(
  "/:projectId",
  async (req: AuthenticatedRequest, res) => {
    try {
      const input = bodySchema.parse(req.body);
      const s = await scope(req);
      const project = await adminDb
        .collection("projects")
        .doc(s.projectId)
        .get();
      const buildId = project.data()?.professionalBuildId;
      if (buildId) {
        const build = await adminDb
          .collection("site_factory_builds")
          .doc(buildId)
          .get();
        if (
          build.exists &&
          build.data()?.phase >= 13 &&
          ["certifying", "publishing"].includes(build.data()?.status)
        )
          throw Object.assign(
            new Error(
              "Aguarde a verificação atual ou cancele a construção antes de alterar variáveis.",
            ),
            { httpStatus: 409, code: "configuration_locked" },
          );
      }
      return res.json(await service.save(s, input.revision, input.variables));
    } catch (e) {
      return failed(res, e);
    }
  },
);
