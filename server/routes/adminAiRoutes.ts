import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { AuthenticatedRequest } from '../types.js';
import { ModelHealthService } from '../ai/modelHealthService.js';
import { ModelRegistry } from '../ai/modelRegistry.js';
import { EvaluationService } from '../ai/evaluationService.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { AIMode } from '../ai/types/ai.js';

export const adminAiRouter = Router();

const ALLOWED_AI_MODES: AIMode[] = [
  'fast',
  'smart',
  'deep',
  'code',
  'research',
  'site-builder',
  'image',
  'video',
  'document'
];

function isNonEmptyString(
  value: unknown,
  maxLength = 500
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

function sanitizeStringArray(
  value: unknown,
  maxItems = 30,
  maxItemLength = 120
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter(
          (item): item is string =>
            typeof item === 'string'
        )
        .map((item) => item.trim())
        .filter(
          (item) =>
            item.length > 0 &&
            item.length <= maxItemLength
        )
    )
  ).slice(0, maxItems);
}

function serializeDocument(
  document: FirebaseFirestore.DocumentSnapshot
): Record<string, unknown> & { id: string } {
  return {
    ...document.data(),
    id: document.id
  };
}

// GET /api/admin/ai/overview
adminAiRouter.get(
  '/overview',
  requireAuth,
  requireAdmin,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      let totalExecutions = 0;
      let completedExecutions = 0;
      let failedExecutions = 0;

      const execsSnap = await adminDb
        .collection('ai_executions')
        .count()
        .get();

      totalExecutions = execsSnap.data().count;

      const completedSnap = await adminDb
        .collection('ai_executions')
        .where('status', '==', 'completed')
        .count()
        .get();

      completedExecutions =
        completedSnap.data().count;

      const failedSnap = await adminDb
        .collection('ai_executions')
        .where('status', '==', 'failed')
        .count()
        .get();

      failedExecutions = failedSnap.data().count;

      const health =
        ModelHealthService.getHealthOverview();

      return res.json({
        timestamp: new Date().toISOString(),
        totalExecutions,
        completedExecutions,
        failedExecutions,
        healthOverview: health,
        correlationId: req.correlationId
      });
    } catch {
      return res.status(500).json({
        error: {
          code: 'admin_ai_overview_failed',
          message:
            'Erro ao carregar visão geral de IA.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// GET /api/admin/ai/models
adminAiRouter.get(
  '/models',
  requireAuth,
  requireAdmin,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const models =
        ModelRegistry.listEnabledModels();
      const health =
        ModelHealthService.getHealthOverview();

      return res.json({
        models,
        health
      });
    } catch {
      return res.status(500).json({
        error: {
          code: 'admin_models_failed',
          message: 'Erro ao listar modelos.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// GET /api/admin/ai/executions
adminAiRouter.get(
  '/executions',
  requireAuth,
  requireAdmin,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const snap = await adminDb
        .collection('ai_executions')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const executions = snap.docs.map(
        (document) => ({
          executionId: document.id,
          ...document.data()
        })
      );

      return res.json({
        executions
      });
    } catch {
      return res.status(500).json({
        error: {
          code: 'admin_executions_failed',
          message:
            'Erro ao buscar histórico de execuções.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// GET /api/admin/ai/evaluations
adminAiRouter.get(
  '/evaluations',
  requireAuth,
  requireAdmin,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const evaluations =
        await EvaluationService.listEvaluations(50);

      return res.json({
        evaluations
      });
    } catch {
      return res.status(500).json({
        error: {
          code: 'admin_evaluations_failed',
          message: 'Erro ao listar avaliações.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// POST /api/admin/ai/evaluations/run
adminAiRouter.post(
  '/evaluations/run',
  requireAuth,
  requireAdmin,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const { model, promptVersion } = req.body ?? {};

      if (!isNonEmptyString(model, 160)) {
        return res.status(400).json({
          error: {
            code: 'invalid_evaluation_model',
            message:
              'Selecione um modelo válido para executar a avaliação.',
            correlationId: req.correlationId
          }
        });
      }

      if (
        promptVersion !== undefined &&
        promptVersion !== null &&
        !isNonEmptyString(promptVersion, 120)
      ) {
        return res.status(400).json({
          error: {
            code: 'invalid_prompt_version',
            message:
              'A versão do prompt informada é inválida.',
            correlationId: req.correlationId
          }
        });
      }

      const summary =
        await EvaluationService.runAutomatedSuite({
          model: model.trim(),
          promptVersion:
            typeof promptVersion === 'string'
              ? promptVersion.trim()
              : undefined,
          requestedBy: req.user?.uid ?? 'unknown'
        });

      return res.status(201).json({
        summary,
        correlationId: req.correlationId
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'evaluation_already_running'
      ) {
        return res.status(409).json({
          error: {
            code: 'evaluation_already_running',
            message:
              'Já existe uma avaliação em execução. Aguarde a conclusão antes de iniciar outra.',
            correlationId: req.correlationId
          }
        });
      }

      if (
        error instanceof Error &&
        [
          'evaluation_model_not_allowed',
          'evaluation_requester_required'
        ].includes(error.message)
      ) {
        return res.status(400).json({
          error: {
            code: error.message,
            message:
              'O modelo ou o responsável pela avaliação é inválido.',
            correlationId: req.correlationId
          }
        });
      }

      return res.status(500).json({
        error: {
          code: 'admin_evaluation_run_failed',
          message:
            'Erro ao executar a suíte real de avaliações.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// GET /api/admin/ai/prompts
adminAiRouter.get(
  '/prompts',
  requireAuth,
  requireAdmin,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const [
        definitionsSnapshot,
        versionsSnapshot
      ] = await Promise.all([
        adminDb
          .collection('prompt_definitions')
          .get(),
        adminDb
          .collection('prompt_versions')
          .get()
      ]);

      const versionsByPrompt = new Map<
        string,
        Array<Record<string, unknown>>
      >();

      for (const document of versionsSnapshot.docs) {
        const version = serializeDocument(document);
        const promptId =
          typeof version.promptId === 'string'
            ? version.promptId
            : '';

        if (!promptId) {
          continue;
        }

        const current =
          versionsByPrompt.get(promptId) ?? [];

        current.push(version);
        versionsByPrompt.set(promptId, current);
      }

      const prompts = definitionsSnapshot.docs
        .map((document) => {
          const definition =
            serializeDocument(document);

          const versions = (
            versionsByPrompt.get(document.id) ?? []
          ).sort((first, second) => {
            const firstDate =
              typeof first.createdAt === 'string'
                ? first.createdAt
                : '';

            const secondDate =
              typeof second.createdAt === 'string'
                ? second.createdAt
                : '';

            return secondDate.localeCompare(firstDate);
          });

          const activeVersion =
            versions.find(
              (version) =>
                version.id ===
                definition.activeVersionId
            ) ?? null;

          return {
            ...definition,
            versions,
            activeVersion
          };
        })
        .sort((first, second) => {
          const firstDate =
            typeof (first as Record<string, unknown>)
              .updatedAt === 'string'
              ? String(
                  (first as Record<string, unknown>)
                    .updatedAt
                )
              : '';

          const secondDate =
            typeof (second as Record<string, unknown>)
              .updatedAt === 'string'
              ? String(
                  (second as Record<string, unknown>)
                    .updatedAt
                )
              : '';

          return secondDate.localeCompare(firstDate);
        });

      return res.json({
        prompts,
        correlationId: req.correlationId
      });
    } catch {
      return res.status(500).json({
        error: {
          code: 'admin_prompts_list_failed',
          message:
            'Erro ao carregar o registro de prompts.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// POST /api/admin/ai/prompts
adminAiRouter.post(
  '/prompts',
  requireAuth,
  requireAdmin,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const {
        name,
        agent,
        mode,
        content,
        variables,
        compatibleModels
      } = req.body ?? {};

      if (
        !isNonEmptyString(name, 160) ||
        !isNonEmptyString(agent, 120) ||
        !isNonEmptyString(content, 50000) ||
        !ALLOWED_AI_MODES.includes(mode)
      ) {
        return res.status(400).json({
          error: {
            code: 'invalid_prompt_payload',
            message:
              'Nome, agente, modo e conteúdo válido são obrigatórios.',
            correlationId: req.correlationId
          }
        });
      }

      const now = new Date().toISOString();
      const definitionRef = adminDb
        .collection('prompt_definitions')
        .doc();

      const versionRef = adminDb
        .collection('prompt_versions')
        .doc();

      const definition = {
        name: name.trim(),
        agent: agent.trim(),
        mode,
        activeVersionId: '',
        createdAt: now,
        updatedAt: now
      };

      const version = {
        promptId: definitionRef.id,
        version: 'v1.0.0',
        status: 'draft',
        compatibleModels: sanitizeStringArray(
          compatibleModels
        ),
        content: content.trim(),
        variables: sanitizeStringArray(variables),
        authorUid: req.user?.uid ?? 'unknown',
        evalScore: null,
        distributionPercentage: 0,
        createdAt: now
      };

      const batch = adminDb.batch();

      batch.set(definitionRef, definition);
      batch.set(versionRef, version);

      await batch.commit();

      return res.status(201).json({
        prompt: {
          id: definitionRef.id,
          ...definition,
          versions: [
            {
              id: versionRef.id,
              ...version
            }
          ],
          activeVersion: null
        },
        correlationId: req.correlationId
      });
    } catch {
      return res.status(500).json({
        error: {
          code: 'admin_prompt_create_failed',
          message: 'Erro ao criar o prompt.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// POST /api/admin/ai/prompts/:promptId/versions
adminAiRouter.post(
  '/prompts/:promptId/versions',
  requireAuth,
  requireAdmin,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const promptId = req.params.promptId;
      const {
        content,
        variables,
        compatibleModels
      } = req.body ?? {};

      if (
        !isNonEmptyString(promptId, 200) ||
        !isNonEmptyString(content, 50000)
      ) {
        return res.status(400).json({
          error: {
            code: 'invalid_prompt_version_payload',
            message:
              'Prompt e conteúdo válido são obrigatórios.',
            correlationId: req.correlationId
          }
        });
      }

      const definitionRef = adminDb
        .collection('prompt_definitions')
        .doc(promptId);

      const definitionSnapshot =
        await definitionRef.get();

      if (!definitionSnapshot.exists) {
        return res.status(404).json({
          error: {
            code: 'prompt_not_found',
            message: 'Prompt não encontrado.',
            correlationId: req.correlationId
          }
        });
      }

      const now = new Date().toISOString();
      const versionRef = adminDb
        .collection('prompt_versions')
        .doc();

      const version = {
        promptId,
        version: `v${Date.now()}`,
        status: 'draft',
        compatibleModels: sanitizeStringArray(
          compatibleModels
        ),
        content: content.trim(),
        variables: sanitizeStringArray(variables),
        authorUid: req.user?.uid ?? 'unknown',
        evalScore: null,
        distributionPercentage: 0,
        createdAt: now
      };

      const batch = adminDb.batch();

      batch.set(versionRef, version);
      batch.update(definitionRef, {
        updatedAt: now
      });

      await batch.commit();

      return res.status(201).json({
        version: {
          id: versionRef.id,
          ...version
        },
        correlationId: req.correlationId
      });
    } catch {
      return res.status(500).json({
        error: {
          code: 'admin_prompt_version_failed',
          message:
            'Erro ao criar uma nova versão do prompt.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

// POST /api/admin/ai/prompts/:promptId/activate
adminAiRouter.post(
  '/prompts/:promptId/activate',
  requireAuth,
  requireAdmin,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    try {
      const promptId = req.params.promptId;
      const { versionId } = req.body ?? {};

      if (
        !isNonEmptyString(promptId, 200) ||
        !isNonEmptyString(versionId, 200)
      ) {
        return res.status(400).json({
          error: {
            code: 'invalid_prompt_activation',
            message:
              'Prompt e versão são obrigatórios.',
            correlationId: req.correlationId
          }
        });
      }

      const definitionRef = adminDb
        .collection('prompt_definitions')
        .doc(promptId);

      const versionRef = adminDb
        .collection('prompt_versions')
        .doc(versionId);

      await adminDb.runTransaction(
        async (transaction) => {
          const [
            definitionSnapshot,
            versionSnapshot
          ] = await Promise.all([
            transaction.get(definitionRef),
            transaction.get(versionRef)
          ]);

          if (!definitionSnapshot.exists) {
            throw new Error('prompt_not_found');
          }

          if (!versionSnapshot.exists) {
            throw new Error('version_not_found');
          }

          const versionData =
            versionSnapshot.data();

          if (versionData?.promptId !== promptId) {
            throw new Error(
              'version_prompt_mismatch'
            );
          }

          const previousActiveVersionId =
            definitionSnapshot.data()
              ?.activeVersionId;

          if (
            typeof previousActiveVersionId ===
              'string' &&
            previousActiveVersionId &&
            previousActiveVersionId !== versionId
          ) {
            transaction.update(
              adminDb
                .collection('prompt_versions')
                .doc(previousActiveVersionId),
              {
                status: 'retired',
                distributionPercentage: 0
              }
            );
          }

          const now = new Date().toISOString();

          transaction.update(versionRef, {
            status: 'production',
            distributionPercentage: 100
          });

          transaction.update(definitionRef, {
            activeVersionId: versionId,
            updatedAt: now
          });
        }
      );

      return res.json({
        success: true,
        promptId,
        activeVersionId: versionId,
        correlationId: req.correlationId
      });
    } catch (error) {
      if (
        error instanceof Error &&
        [
          'prompt_not_found',
          'version_not_found',
          'version_prompt_mismatch'
        ].includes(error.message)
      ) {
        return res.status(404).json({
          error: {
            code: error.message,
            message:
              'Prompt ou versão não encontrado.',
            correlationId: req.correlationId
          }
        });
      }

      return res.status(500).json({
        error: {
          code: 'admin_prompt_activate_failed',
          message:
            'Erro ao ativar a versão do prompt.',
          correlationId: req.correlationId
        }
      });
    }
  }
);