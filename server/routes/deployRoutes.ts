import crypto from 'node:crypto';
import { Router, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import {
  adminDb,
  isFirebaseAdminConfigured,
} from '../lib/firebaseAdmin.js';
import {
  DeploymentProviderError,
  normalizeRepositoryName,
  ProjectDeploymentService,
} from '../services/projectDeploymentService.js';
import { AuthenticatedRequest } from '../types.js';

export const deployRouter = Router();

const deploymentLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyPrefix: 'project-deployment',
});

const deploymentFileSchema = z.object({
  path: z.string().min(1).max(260),
  content: z.string().max(2_000_000),
});

const githubPublishSchema = z.object({
  projectId: z.string().min(1).max(160),
  repoName: z.string().min(1).max(120),
  isPrivate: z.boolean().default(false),
  branch: z.string().min(1).max(120).default('froc-publish'),
  message: z.string().min(1).max(240).default('feat: publicar projeto gerado pela Froc.IA'),
  files: z.array(deploymentFileSchema).min(1).max(100),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

const vercelDeploymentSchema = z.object({
  projectId: z.string().min(1).max(160),
  projectName: z.string().min(1).max(100).optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

const vercelStatusQuerySchema = z.object({
  projectId: z.string().min(1).max(160),
});

const rollbackSchema = z.object({
  projectId: z.string().min(1).max(160),
  deploymentId: z.string().min(3).max(160),
  reason: z.string().min(10).max(500),
});

function requestHash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function deploymentDocumentId(
  projectId: string,
  deploymentId: string
): string {
  return crypto
    .createHash('sha256')
    .update(`${projectId}:${deploymentId}`, 'utf8')
    .digest('hex');
}

function cleanProjectName(value: string): string {
  return normalizeRepositoryName(value).slice(0, 100);
}

async function getOwnedProject(
  userId: string,
  projectId: string
): Promise<{
  reference: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
} | null> {
  const reference = adminDb
    .collection('projects')
    .doc(projectId);
  const snapshot = await reference.get();

  if (
    !snapshot.exists ||
    snapshot.data()?.userId !== userId
  ) {
    return null;
  }

  return {
    reference,
    data: snapshot.data() || {},
  };
}

function sendProviderError(
  req: AuthenticatedRequest,
  res: Response,
  error: unknown
) {
  if (error instanceof DeploymentProviderError) {
    return res.status(error.httpStatus).json({
      error: {
        code: error.code,
        message: error.message,
        correlationId: req.correlationId,
      },
    });
  }

  console.error(
    'Falha não esperada no deployment do projeto:',
    error
  );

  return res.status(500).json({
    error: {
      code: 'project_deployment_failed',
      message:
        'Não foi possível concluir a operação de publicação.',
      correlationId: req.correlationId,
    },
  });
}

// Cria um commit real e o verifica no GitHub.
deployRouter.post(
  '/github',
  requireAuth,
  deploymentLimiter,
  async (req: AuthenticatedRequest, res) => {
    const parsed = githubPublishSchema.safeParse(
      req.body
    );

    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'invalid_github_publish_input',
          message: parsed.error.issues[0].message,
          correlationId: req.correlationId,
        },
      });
    }

    const token =
      process.env.GITHUB_TOKEN ||
      process.env.GITHUB_APP_TOKEN;

    if (!token) {
      return res.status(503).json({
        error: {
          code: 'github_not_configured',
          message:
            'A integração do GitHub não está configurada no servidor.',
          correlationId: req.correlationId,
        },
      });
    }

    if (!isFirebaseAdminConfigured()) {
      return res.status(503).json({
        error: {
          code: 'database_not_configured',
          message:
            'O banco de dados não está disponível para validar o projeto.',
          correlationId: req.correlationId,
        },
      });
    }

    const userId = req.user!.uid;
    const input = parsed.data;

    try {
      const project = await getOwnedProject(
        userId,
        input.projectId
      );

      if (!project) {
        return res.status(404).json({
          error: {
            code: 'project_not_found',
            message:
              'Projeto não encontrado ou sem acesso.',
            correlationId: req.correlationId,
          },
        });
      }

      const owner = (
        process.env.GITHUB_OWNER ||
        'brasilportalvip-png'
      ).trim();
      const normalizedRepoName =
        normalizeRepositoryName(input.repoName);
      const repositoryFullName =
        `${owner}/${normalizedRepoName}`;
      const idempotencyKey =
        input.idempotencyKey ||
        requestHash({
          userId,
          projectId: input.projectId,
          repositoryFullName,
          branch: input.branch,
          message: input.message,
          files: input.files,
        });
      const previousPublish =
        project.data.lastGithubPublish;

      if (
        previousPublish?.idempotencyKey ===
          idempotencyKey &&
        previousPublish?.verified === true &&
        typeof previousPublish?.commitSha ===
          'string'
      ) {
        return res.json({
          success: true,
          ...previousPublish,
          idempotentReplay: true,
        });
      }

      const boundRepository =
        project.data.githubRepositoryFullName;

      if (
        boundRepository &&
        boundRepository !== repositoryFullName
      ) {
        return res.status(409).json({
          error: {
            code: 'project_repository_conflict',
            message:
              'Este projeto já está vinculado a outro repositório.',
            correlationId: req.correlationId,
          },
        });
      }

      const result =
        await ProjectDeploymentService
          .publishToGitHub({
            token,
            owner,
            repoName: normalizedRepoName,
            isPrivate: input.isPrivate,
            branch: input.branch,
            message: input.message,
            files: input.files,
            allowExistingRepository:
              boundRepository ===
                repositoryFullName ||
              req.user!.role === 'admin',
          });

      const publishRecord = {
        ...result,
        idempotencyKey,
        verifiedAt: new Date().toISOString(),
      };

      await project.reference.update({
        githubRepositoryFullName:
          result.repositoryFullName,
        githubRepositoryId:
          result.repositoryId,
        githubUrl: result.repositoryUrl,
        lastGithubPublish: publishRecord,
        lastDeployedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return res.status(201).json({
        success: true,
        ...publishRecord,
        idempotentReplay: false,
      });
    } catch (error) {
      return sendProviderError(req, res, error);
    }
  }
);

// Inicia o deployment; READY só é concedido pelo endpoint de status após smoke test.
deployRouter.post(
  '/vercel',
  requireAuth,
  deploymentLimiter,
  async (req: AuthenticatedRequest, res) => {
    const parsed = vercelDeploymentSchema.safeParse(
      req.body
    );

    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'invalid_vercel_deployment_input',
          message: parsed.error.issues[0].message,
          correlationId: req.correlationId,
        },
      });
    }

    const token = process.env.VERCEL_TOKEN;

    if (!token) {
      return res.status(503).json({
        error: {
          code: 'vercel_not_configured',
          message:
            'A integração da Vercel não está configurada no servidor.',
          correlationId: req.correlationId,
        },
      });
    }

    if (!isFirebaseAdminConfigured()) {
      return res.status(503).json({
        error: {
          code: 'database_not_configured',
          message:
            'O banco de dados não está disponível para validar o projeto.',
          correlationId: req.correlationId,
        },
      });
    }

    const userId = req.user!.uid;
    const input = parsed.data;

    try {
      const project = await getOwnedProject(
        userId,
        input.projectId
      );

      if (!project) {
        return res.status(404).json({
          error: {
            code: 'project_not_found',
            message:
              'Projeto não encontrado ou sem acesso.',
            correlationId: req.correlationId,
          },
        });
      }

      const githubPublish =
        project.data.lastGithubPublish;

      if (
        !githubPublish?.verified ||
        !githubPublish?.repositoryFullName ||
        !githubPublish?.commitSha ||
        !githubPublish?.branch
      ) {
        return res.status(409).json({
          error: {
            code: 'verified_github_publish_required',
            message:
              'Publique e verifique um commit real no GitHub antes de iniciar o deployment.',
            correlationId: req.correlationId,
          },
        });
      }

      const [repoOwner, repoName] = String(
        githubPublish.repositoryFullName
      ).split('/');
      const projectName = cleanProjectName(
        input.projectName ||
        project.data.title ||
        repoName
      );

      if (!projectName || !repoOwner || !repoName) {
        return res.status(409).json({
          error: {
            code: 'invalid_project_deployment_binding',
            message:
              'O vínculo de publicação do projeto está incompleto.',
            correlationId: req.correlationId,
          },
        });
      }

      const idempotencyKey =
        input.idempotencyKey ||
        requestHash({
          userId,
          projectId: input.projectId,
          projectName,
          repositoryFullName:
            githubPublish.repositoryFullName,
          branch: githubPublish.branch,
          commitSha: githubPublish.commitSha,
        });
      const previousDeployment =
        project.data.lastVercelDeployment;

      if (
        previousDeployment?.idempotencyKey ===
          idempotencyKey &&
        previousDeployment?.deploymentId
      ) {
        return res.json({
          success: true,
          ...previousDeployment,
          idempotentReplay: true,
        });
      }

      const result =
        await ProjectDeploymentService
          .createVercelDeployment({
            token,
            projectName,
            repoOwner,
            repoName,
            repoId:
              Number(
                githubPublish.repositoryId
              ) || undefined,
            branch: githubPublish.branch,
            commitSha:
              githubPublish.commitSha,
          });

      const deploymentRecord = {
        ...result,
        userId,
        projectId: input.projectId,
        idempotencyKey,
        commitSha:
          githubPublish.commitSha,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const recordReference = adminDb
        .collection('project_deployments')
        .doc(
          deploymentDocumentId(
            input.projectId,
            result.deploymentId
          )
        );

      await adminDb.runTransaction(
        async (transaction) => {
          transaction.set(
            recordReference,
            deploymentRecord
          );
          transaction.update(
            project.reference,
            {
              lastVercelDeployment:
                deploymentRecord,
              lastDeploymentId:
                result.deploymentId,
              vercelUrl:
                result.deploymentUrl || null,
              updatedAt:
                FieldValue.serverTimestamp(),
            }
          );
        }
      );

      return res.status(202).json({
        success: true,
        ...deploymentRecord,
        idempotentReplay: false,
        message:
          'Deployment iniciado. A conclusão ainda não foi confirmada.',
      });
    } catch (error) {
      return sendProviderError(req, res, error);
    }
  }
);

// Consulta o estado real e executa o smoke test da URL pública quando READY.
deployRouter.get(
  '/vercel/:deploymentId/status',
  requireAuth,
  deploymentLimiter,
  async (req: AuthenticatedRequest, res) => {
    const parsedQuery =
      vercelStatusQuerySchema.safeParse(
        req.query
      );

    if (!parsedQuery.success) {
      return res.status(400).json({
        error: {
          code: 'invalid_vercel_status_input',
          message: parsedQuery.error.issues[0].message,
          correlationId: req.correlationId,
        },
      });
    }

    const token = process.env.VERCEL_TOKEN;

    if (!token) {
      return res.status(503).json({
        error: {
          code: 'vercel_not_configured',
          message:
            'A integração da Vercel não está configurada no servidor.',
          correlationId: req.correlationId,
        },
      });
    }

    const { deploymentId } = req.params;
    const { projectId } = parsedQuery.data;
    const userId = req.user!.uid;

    try {
      const project = await getOwnedProject(
        userId,
        projectId
      );

      if (!project) {
        return res.status(404).json({
          error: {
            code: 'project_not_found',
            message:
              'Projeto não encontrado ou sem acesso.',
            correlationId: req.correlationId,
          },
        });
      }

      const recordReference = adminDb
        .collection('project_deployments')
        .doc(
          deploymentDocumentId(
            projectId,
            deploymentId
          )
        );
      const recordSnapshot =
        await recordReference.get();

      if (
        !recordSnapshot.exists ||
        recordSnapshot.data()?.userId !==
          userId ||
        recordSnapshot.data()?.projectId !==
          projectId
      ) {
        return res.status(404).json({
          error: {
            code: 'deployment_not_found',
            message:
              'Deployment não encontrado ou sem acesso.',
            correlationId: req.correlationId,
          },
        });
      }

      const status =
        await ProjectDeploymentService
          .getVercelDeploymentStatus(
            token,
            deploymentId
          );
      const updatedRecord = {
        ...recordSnapshot.data(),
        ...status,
        verifiedAt:
          status.status === 'ready'
            ? new Date().toISOString()
            : null,
        updatedAt: new Date().toISOString(),
      };

      await adminDb.runTransaction(
        async (transaction) => {
          transaction.set(
            recordReference,
            updatedRecord,
            { merge: true }
          );

          if (
            project.data.lastDeploymentId ===
            deploymentId
          ) {
            transaction.update(
              project.reference,
              {
                lastVercelDeployment:
                  updatedRecord,
                vercelUrl:
                  status.deploymentUrl ||
                  project.data.vercelUrl ||
                  null,
                lastDeployedAt:
                  status.status === 'ready'
                    ? FieldValue.serverTimestamp()
                    : project.data.lastDeployedAt ||
                      null,
                updatedAt:
                  FieldValue.serverTimestamp(),
              }
            );
          }
        }
      );

      return res.status(
        status.status === 'failed' ? 502 : 200
      ).json({
        success: status.status !== 'failed',
        ...status,
      });
    } catch (error) {
      return sendProviderError(req, res, error);
    }
  }
);

// Muda o tráfego para um deployment anterior já verificado do mesmo projeto.
deployRouter.post(
  '/rollback',
  requireAuth,
  deploymentLimiter,
  async (req: AuthenticatedRequest, res) => {
    const parsed = rollbackSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'invalid_rollback_input',
          message: parsed.error.issues[0].message,
          correlationId: req.correlationId,
        },
      });
    }

    const token = process.env.VERCEL_TOKEN;

    if (!token) {
      return res.status(503).json({
        error: {
          code: 'vercel_not_configured',
          message:
            'A integração da Vercel não está configurada no servidor.',
          correlationId: req.correlationId,
        },
      });
    }

    const userId = req.user!.uid;
    const input = parsed.data;

    try {
      const project = await getOwnedProject(
        userId,
        input.projectId
      );

      if (!project) {
        return res.status(404).json({
          error: {
            code: 'project_not_found',
            message:
              'Projeto não encontrado ou sem acesso.',
            correlationId: req.correlationId,
          },
        });
      }

      const targetReference = adminDb
        .collection('project_deployments')
        .doc(
          deploymentDocumentId(
            input.projectId,
            input.deploymentId
          )
        );
      const targetSnapshot =
        await targetReference.get();
      const target = targetSnapshot.data();

      if (
        !targetSnapshot.exists ||
        target?.userId !== userId ||
        target?.projectId !== input.projectId ||
        target?.status !== 'ready' ||
        target?.smokeTestPassed !== true
      ) {
        return res.status(409).json({
          error: {
            code: 'rollback_target_not_verified',
            message:
              'O rollback só pode apontar para um deployment anterior verificado por smoke test.',
            correlationId: req.correlationId,
          },
        });
      }

      const vercelProjectId = String(
        target?.vercelProjectId ||
        project.data.lastVercelDeployment
          ?.vercelProjectId ||
        ''
      );

      if (!vercelProjectId) {
        return res.status(409).json({
          error: {
            code: 'vercel_project_id_missing',
            message:
              'O deployment não possui o identificador do projeto Vercel necessário para rollback.',
            correlationId: req.correlationId,
          },
        });
      }

      await ProjectDeploymentService
        .rollbackVercelDeployment(
          token,
          vercelProjectId,
          input.deploymentId,
          input.reason
        );

      await adminDb
        .collection('project_deployment_events')
        .add({
          userId,
          projectId: input.projectId,
          action: 'rollback_requested',
          targetDeploymentId:
            input.deploymentId,
          reason: input.reason,
          correlationId: req.correlationId,
          createdAt:
            FieldValue.serverTimestamp(),
        });

      return res.status(202).json({
        success: true,
        status: 'pending_verification',
        deploymentId: input.deploymentId,
        message:
          'Rollback solicitado. Consulte o status e execute o smoke test antes de considerá-lo concluído.',
      });
    } catch (error) {
      return sendProviderError(req, res, error);
    }
  }
);
