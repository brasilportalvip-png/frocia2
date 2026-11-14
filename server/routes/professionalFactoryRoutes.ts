import { createHash } from "node:crypto";
import { validateAIAttachments } from "../validators/aiAttachmentValidators.js";
import { getMediaStorageBucket } from "../lib/firebaseAdmin.js";
import { Router } from "express";
import { z } from "zod";
import { zipSync, strToU8 } from "fflate";
import { requireAuth } from "../middlewares/requireAuth.js";
import { createRateLimiter } from "../middlewares/rateLimiter.js";
import { adminDb, isFirebaseAdminConfigured } from "../lib/firebaseAdmin.js";
import { FeatureFlagService } from "../services/featureFlagService.js";
import type { AuthenticatedRequest } from "../types.js";
import {
  buildBriefSchema,
  FactoryError,
} from "../siteFactory/professionalContract.js";
import { getProfessionalFactory } from "../siteFactory/professionalRuntime.js";
import { GithubAutomationService } from "../selfEvolution/githubAutomationService.js";
import { ProfessionalMaintenanceService } from '../siteFactory/professionalMaintenanceService.js';
import { compileRepoFiles } from "../services/githubSiteImportService.js";
import { normalizeFiles } from "../services/staticSiteBundler.js";
import { sourceDigest } from "../siteFactory/professionalContract.js";
export const professionalFactoryRouter = Router();
professionalFactoryRouter.use(
  requireAuth,
  createRateLimiter({
    windowMs: 60000,
    max: 60,
    keyPrefix: "professional-factory",
  }),
);
professionalFactoryRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
async function scope(req: AuthenticatedRequest) {
  if (!isFirebaseAdminConfigured())
    throw new FactoryError(
      "database_unavailable",
      "Banco de dados indisponível.",
      503,
    );
  const projectId = z
    .string()
    .regex(/^[A-Za-z0-9:_-]{1,160}$/)
    .parse(req.params.projectId);
  const p = await adminDb.collection("projects").doc(projectId).get();
  if (
    !p.exists ||
    p.data()?.userId !== req.user!.uid ||
    p.data()?.tenantId !== req.user!.tenantId
  )
    throw new FactoryError("project_not_found", "Projeto não encontrado.", 404);
  return { projectId, userId: req.user!.uid, tenantId: req.user!.tenantId };
}
function error(res: any, e: any) {
  return res.status(e instanceof z.ZodError ? 400 : e.httpStatus || 503).json({
    error: {
      code:
        e instanceof z.ZodError
          ? "invalid_factory_request"
          : e.code || "factory_unavailable",
      message:
        e instanceof z.ZodError
          ? "Confira os dados do projeto."
          : e instanceof FactoryError
            ? e.message
            : "Não foi possível concluir esta operação.",
    },
  });
}
const startSchema = z
  .object({
    brief: buildBriefSchema,
    idempotencyKey: z.string().min(8).max(160),
    attachments: z.unknown().optional(),
  })
  .strict();
professionalFactoryRouter.get('/projects/:projectId/maintenance', async (req: AuthenticatedRequest, res) => {
  try { return res.json(await new ProfessionalMaintenanceService().get(await scope(req))); }
  catch (e) { return error(res, e); }
});
professionalFactoryRouter.put('/projects/:projectId/maintenance', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await new ProfessionalMaintenanceService().configure(await scope(req), req.body);
    return res.json(result);
  } catch (e) { return error(res, e); }
});
professionalFactoryRouter.post(
  "/projects/:projectId/builds",
  async (req: AuthenticatedRequest, res) => {
    try {
      await FeatureFlagService.assertEnabled("ai_chat");
      const s = await scope(req),
        input = startSchema.parse(req.body),
        service = getProfessionalFactory();
      const validated = validateAIAttachments(input.attachments || []);
      const references = [];
      if (validated.length) {
        const bucket = await getMediaStorageBucket();
        for (const attachment of validated) {
          const bytes = Buffer.from(attachment.data, "base64");
          const digest = createHash("sha256").update(bytes).digest("hex");
          const path =
            "factory-inputs/" +
            s.userId +
            "/" +
            createHash("sha256").update(s.projectId).digest("hex") +
            "/" +
            digest;
          await bucket.file(path).save(bytes, {
            resumable: false,
            contentType: attachment.mimeType,
            metadata: { cacheControl: "private,no-store" },
          });
          references.push({
            path,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sha256: digest,
          });
        }
      }
      const b = await service.start(
        s,
        input.brief,
        input.idempotencyKey,
        references,
      );

      const dispatch =
        await GithubAutomationService.dispatchProfessionalFactory();
      return res
        .status(202)
        .json({ build: await service.publicView(b), dispatch });
    } catch (e) {
      return error(res, e);
    }
  },
);
professionalFactoryRouter.get(
  "/projects/:projectId/builds/:id",
  async (req: AuthenticatedRequest, res) => {
    try {
      const s = await scope(req),
        service = getProfessionalFactory();
      return res.json({
        build: await service.publicView(await service.get(req.params.id, s)),
      });
    } catch (e) {
      return error(res, e);
    }
  },
);
professionalFactoryRouter.post(
  "/projects/:projectId/builds/:id/advance",
  async (req: AuthenticatedRequest, res) => {
    try {
      const s = await scope(req),
        service = getProfessionalFactory();
      return res.json({
        build: await service.publicView(
          await service.advance(req.params.id, s),
        ),
      });
    } catch (e) {
      return error(res, e);
    }
  },
);
professionalFactoryRouter.post(
  "/projects/:projectId/builds/:id/resume",
  async (req: AuthenticatedRequest, res) => {
    try {
      const s = await scope(req),
        service = getProfessionalFactory();
      const b = await service.resume(req.params.id, s);
      const dispatch =
        await GithubAutomationService.dispatchProfessionalFactory();
      return res.json({ build: await service.publicView(b), dispatch });
    } catch (e) {
      return error(res, e);
    }
  },
);
professionalFactoryRouter.post(
  "/projects/:projectId/builds/:id/cancel",
  async (req: AuthenticatedRequest, res) => {
    try {
      const s = await scope(req),
        service = getProfessionalFactory();
      return res.json({
        build: await service.publicView(await service.cancel(req.params.id, s)),
      });
    } catch (e) {
      return error(res, e);
    }
  },
);
professionalFactoryRouter.get(
  "/projects/:projectId/builds/:id/export",
  async (req: AuthenticatedRequest, res) => {
    try {
      const s = await scope(req),
        service = getProfessionalFactory();
      const b = await service.get(req.params.id, s);
      const files = service.files(b).files;
      const zipped = zipSync(
        Object.fromEntries(files.map((f) => [f.path, strToU8(f.content)])),
      );
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="froc-project-' + b.id.slice(0, 12) + '.zip"',
      );
      return res.send(Buffer.from(zipped));
    } catch (e) {
      return error(res, e);
    }
  },
);

/**
 * Prévia do código gerado no editor, antes mesmo dos testes isolados e da publicação.
 * O servidor compila o React/TypeScript em um HTML único; o backend do projeto não roda
 * aqui, então chamadas à API aparecem vazias na prévia.
 */
professionalFactoryRouter.get(
  "/projects/:projectId/builds/:id/preview",
  async (req: AuthenticatedRequest, res) => {
    try {
      const s = await scope(req),
        service = getProfessionalFactory();
      const b = await service.get(req.params.id, s);
      if (!b.bundle)
        return res.status(409).json({
          error: {
            code: "preview_not_ready",
            message: "O código ainda está sendo escrito. A prévia aparece assim que a geração terminar.",
          },
        });
      const publicConfig: Record<string, string> = {};
      for (const v of b.bundle.variables)
        if (v.visibility === "public") publicConfig[v.name] = "";
      const stub =
        "window.FROC_PUBLIC_CONFIG=Object.assign(" +
        JSON.stringify(publicConfig) +
        ",{PUBLIC_SITE_URL:location.origin,PUBLIC_BUSINESS_NAME:" +
        JSON.stringify(b.bundle.title) +
        "});window.FrocConfigReady=Promise.resolve();";
      const files: Record<string, Uint8Array> = {};
      for (const f of service.files(b).files) {
        // Sem o lock, os pacotes vêm prontos do esm.sh: a prévia compila em segundos.
        if (f.path === "package-lock.json") continue;
        files[f.path] = strToU8(f.path === "public/froc-config.js" ? stub : f.content);
      }
      const result = await compileRepoFiles(
        files,
        { owner: "froc", repo: b.bundle.title, branch: "previa" },
        normalizeFiles(files),
      );
      return res.json({
        preview: {
          html: result.html,
          title: b.bundle.title,
          digest: sourceDigest(b.bundle.files),
          message: result.report.message,
        },
      });
    } catch (e) {
      return error(res, e);
    }
  },
);

professionalFactoryRouter.post(
  "/projects/:projectId/builds/:id/change",
  async (req: AuthenticatedRequest, res) => {
    try {
      const s = await scope(req);
      const input = z
        .object({
          instructions: z.string().trim().min(5).max(8000),
          idempotencyKey: z.string().min(8).max(160),
        })
        .strict()
        .parse(req.body);
      const service = getProfessionalFactory();
      const b = await service.change(
        req.params.id,
        s,
        input.instructions,
        input.idempotencyKey,
      );
      const dispatch =
        await GithubAutomationService.dispatchProfessionalFactory();
      return res
        .status(202)
        .json({ build: await service.publicView(b), dispatch });
    } catch (e) {
      return error(res, e);
    }
  },
);

professionalFactoryRouter.post(
  "/projects/:projectId/builds/:id/reconfigure",
  async (req: AuthenticatedRequest, res) => {
    try {
      const s = await scope(req);
      const input = z
        .object({ idempotencyKey: z.string().min(8).max(160) })
        .strict()
        .parse(req.body);
      const service = getProfessionalFactory();
      const build = await service.reconfigure(
        req.params.id,
        s,
        input.idempotencyKey,
      );
      const dispatch =
        await GithubAutomationService.dispatchProfessionalFactory();
      return res
        .status(202)
        .json({ build: await service.publicView(build), dispatch });
    } catch (e) {
      return error(res, e);
    }
  },
);
