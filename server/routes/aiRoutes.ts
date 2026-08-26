import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { AIExecutionService } from '../ai/aiExecutionService.js';
import { GeminiProvider } from '../ai/providers/geminiProvider.js';
import { ContextBuilder } from '../ai/contextBuilder.js';
import {
  AIRequestOrchestrator,
  UnknownAIToolError
} from '../ai/requestOrchestrator.js';
import {
  CreditWalletService,
  InsufficientCreditsError
} from '../services/creditWalletService.js';
import { ExecutionTraceService } from '../ai/executionTraceService.js';
import { ExecutionAbortRegistry } from '../ai/executionAbortRegistry.js';
import { ModelRegistry } from '../ai/modelRegistry.js';
import { CitationService } from '../ai/citationService.js';
import { CostService } from '../ai/costService.js';
import {
  InvalidAIAttachmentError,
  validateAIAttachments
} from '../validators/aiAttachmentValidators.js';
import {
  AIMode,
  ExecutionParams
} from '../ai/types/ai.js';
import { SafetyService } from '../ai/safetyService.js';
import {
  FeatureFlagDisabledError,
  FeatureFlagService
} from '../services/featureFlagService.js';

export const aiRouter = Router();

const ALLOWED_MODES = new Set<AIMode>([
  'fast',
  'smart',
  'deep',
  'code',
  'research',
  'site-builder',
  'image',
  'video',
  'document'
]);

class InvalidAIRequestError extends Error {
  readonly details: string[];

  constructor(details: string[]) {
    super('invalid_ai_request');
    this.name = 'InvalidAIRequestError';
    this.details = details;
  }
}

function optionalId(value: unknown): string | null {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  if (
    typeof value !== 'string' ||
    value.trim().length > 200 ||
    !/^[A-Za-z0-9_-]+$/.test(value.trim())
  ) {
    throw new InvalidAIRequestError([
      'Um dos identificadores informados é inválido.'
    ]);
  }

  return value.trim();
}

function parseExecutionRequest(
  value: unknown
): Omit<ExecutionParams, 'userId'> {
  if (!value || typeof value !== 'object') {
    throw new InvalidAIRequestError([
      'O corpo da requisição é obrigatório.'
    ]);
  }

  const body = value as Record<string, unknown>;

  const prompt =
    typeof body.prompt === 'string'
      ? body.prompt.trim()
      : '';

  if (!prompt || prompt.length > 50000) {
    throw new InvalidAIRequestError([
      'O prompt deve conter entre 1 e 50.000 caracteres.'
    ]);
  }

  const mode =
    typeof body.mode === 'string'
      ? (body.mode as AIMode)
      : 'smart';

  if (!ALLOWED_MODES.has(mode)) {
    throw new InvalidAIRequestError([
      'O modo de IA informado não é permitido.'
    ]);
  }

  const rawKnowledgeBaseIds =
    body.knowledgeBaseIds;

  const knowledgeBaseIds =
    Array.isArray(rawKnowledgeBaseIds)
      ? Array.from(
          new Set(
            rawKnowledgeBaseIds
              .filter(
                (id): id is string =>
                  typeof id === 'string' &&
                  /^[A-Za-z0-9_-]{1,200}$/.test(id)
              )
              .map((id) => id.trim())
          )
        ).slice(0, 10)
      : [];

  if (
    Array.isArray(rawKnowledgeBaseIds) &&
    knowledgeBaseIds.length !==
      rawKnowledgeBaseIds.length
  ) {
    throw new InvalidAIRequestError([
      'A lista de bases de conhecimento é inválida.'
    ]);
  }

  const idempotencyKey =
    typeof body.idempotencyKey === 'string' &&
    /^[A-Za-z0-9:_-]{8,200}$/.test(
      body.idempotencyKey.trim()
    )
      ? body.idempotencyKey.trim()
      : undefined;

  const rawTools = body.tools;
  const tools = Array.isArray(rawTools)
    ? Array.from(
        new Set(
          rawTools.filter(
            (tool): tool is string =>
              typeof tool === 'string' &&
              /^[a-z][a-z0-9_]{1,80}$/.test(tool)
          )
        )
      ).slice(0, 10)
    : [];

  if (
    Array.isArray(rawTools) &&
    tools.length !== rawTools.length
  ) {
    throw new InvalidAIRequestError([
      'A lista de ferramentas é inválida.'
    ]);
  }

  const modelOverride =
    typeof body.modelOverride === 'string' &&
    /^[A-Za-z0-9._:-]{1,160}$/.test(
      body.modelOverride.trim()
    )
      ? body.modelOverride.trim()
      : undefined;

  return {
    prompt,
    mode,
    conversationId: optionalId(
      body.conversationId
    ),
    projectId: optionalId(body.projectId),
    idempotencyKey,
    knowledgeBaseIds,
    attachments: validateAIAttachments(
      body.attachments
    ),
    responseFormat:
      body.responseFormat === 'json'
        ? 'json'
        : 'text',
    tools,
    modelOverride
  };
}

async function assertModeEnabled(
  mode: AIMode
): Promise<void> {
  await FeatureFlagService.assertEnabled(
    'ai_chat'
  );

  if (mode === 'image') {
    await FeatureFlagService.assertEnabled(
      'image_generation'
    );
  }

  if (mode === 'video') {
    await FeatureFlagService.assertEnabled(
      'video_generation'
    );
  }
}

/**
 * POST /api/ai/chat
 * Streaming Response with SSE
 */
aiRouter.post(
  '/chat',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;

    let parsedRequest: Omit<
      ExecutionParams,
      'userId'
    >;

    try {
      parsedRequest = parseExecutionRequest(
        req.body
      );

      await assertModeEnabled(
        parsedRequest.mode
      );
    } catch (error) {
      if (
        error instanceof
        InvalidAIAttachmentError
      ) {
        return res.status(400).json({
          error: {
            code: 'invalid_ai_attachments',
            message: error.issues[0],
            details: error.issues,
            correlationId:
              req.correlationId
          }
        });
      }

      if (
        error instanceof
        InvalidAIRequestError
      ) {
        return res.status(400).json({
          error: {
            code: 'invalid_ai_request',
            message: error.details[0],
            details: error.details,
            correlationId:
              req.correlationId
          }
        });
      }

      if (
        error instanceof
        FeatureFlagDisabledError
      ) {
        return res.status(503).json({
          error: {
            code:
              'feature_temporarily_disabled',
            message:
              'Este recurso está temporariamente indisponível.',
            feature: error.flag,
            correlationId:
              req.correlationId
          }
        });
      }

      return res.status(500).json({
        error: {
          code:
            'ai_request_validation_failed',
          message:
            'Não foi possível validar a solicitação.',
          correlationId:
            req.correlationId
        }
      });
    }

    const {
      prompt,
      mode,
      conversationId = null,
      projectId = null,
      knowledgeBaseIds = [],
      attachments = [],
      tools = [],
      modelOverride,
      idempotencyKey: providedKey
    } = parsedRequest;

    const safety =
      SafetyService.inspectPrompt(prompt);

    if (!safety.safe) {
      return res.status(400).json({
        error: {
          code: 'unsafe_prompt',
          message:
            safety.reason ||
            'Prompt rejeitado por segurança.',
          correlationId:
            req.correlationId
        }
      });
    }

    const sanitizedPrompt =
      SafetyService.sanitizeInput(prompt);

    let plan;

    try {
      plan = AIRequestOrchestrator.plan({
        mode,
        prompt: sanitizedPrompt,
        hasImages: attachments.some(
          (attachment) =>
            attachment.type === 'image'
        ),
        hasFiles: attachments.length > 0,
        requestedTools: tools,
        knowledgeBaseIds,
        preferredModel: modelOverride
      });
    } catch (error) {
      if (error instanceof UnknownAIToolError) {
        return res.status(400).json({
          error: {
            code: 'unknown_ai_tool',
            message: error.message,
            correlationId: req.correlationId
          }
        });
      }

      throw error;
    }

    const route = plan.route;

    const enableSearchGrounding =
      plan.classification.requiresSearch ||
      route.reasonCode ===
        'mode_research_grounded';

    const idempotencyKey =
      providedKey ||
      `aistream-${uid}-${Date.now()}`;

    let reserveResult;

    try {
      reserveResult =
        await CreditWalletService.reserveCredits(
          {
            userId: uid,
            amount:
              route.estimatedCredits,
            operation:
              `Reserva para streaming de IA (${mode})`,
            idempotencyKey
          }
        );
    } catch (error) {
      const isInsufficient =
        error instanceof
        InsufficientCreditsError;

      return res
        .status(isInsufficient ? 402 : 500)
        .json({
          error: {
            code: isInsufficient
              ? 'insufficient_credits'
              : 'credit_reservation_failed',
            message:
              error instanceof Error
                ? error.message
                : 'Erro ao reservar créditos.',
            correlationId:
              req.correlationId
          }
        });
    }

    const reservationId =
      reserveResult.reservationId;

    let executionId: string;

    try {
      executionId =
        await ExecutionTraceService.createTrace(
          {
            userId: uid,
            conversationId,
            projectId,
            mode,
            selectedModel:
              route.selectedModel,
            fallbackModels:
              route.fallbackModels,
            attemptedModels: [
              route.selectedModel
            ],
            status: 'running',
            promptVersion: 'v1.0.0',
            inputTokens: null,
            outputTokens: null,
            cachedTokens: null,
            estimatedCredits:
              route.estimatedCredits,
            consumedCredits: null,
            reservationId,
            latencyMs: null,
            fallbackUsed: false,
            correlationId:
              req.correlationId,
            errorCode: null,
            createdAt:
              new Date().toISOString(),
            startedAt:
              new Date().toISOString(),
            completedAt: null,
            requestDomain:
              plan.classification.domain,
            requestComplexity:
              plan.classification.complexity,
            requestSensitivity:
              plan.classification.sensitivity,
            requiresSearch:
              plan.classification.requiresSearch,
            toolsRequested: plan.tools.map(
              (tool) => tool.name
            )
          }
        );
    } catch {
      try {
        await CreditWalletService.releaseReservation(
          {
            userId: uid,
            reservationId,
            operation:
              'Estorno por falha ao criar o registro da execução de IA',
            idempotencyKey:
              `trace-failed-${idempotencyKey}`
          }
        );
      } catch (releaseError) {
        console.error(
          'Falha ao liberar reserva após erro na criação do trace:',
          releaseError
        );
      }

      return res.status(500).json({
        error: {
          code:
            'execution_trace_failed',
          message:
            'Não foi possível iniciar a execução de IA.',
          correlationId:
            req.correlationId
        }
      });
    }

    const abortSignal =
      ExecutionAbortRegistry.register(
        executionId
      );

    const streamModelConfig =
      ModelRegistry.getModel(
        route.selectedModel
      );

    res.setHeader(
      'Content-Type',
      'text/event-stream'
    );
    res.setHeader(
      'Cache-Control',
      'no-cache'
    );
    res.setHeader(
      'Connection',
      'keep-alive'
    );

    const sendEvent = (
      event: string,
      data: unknown
    ) => {
      if (res.writableEnded) {
        return;
      }

      res.write(
        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      );
    };

    sendEvent('start', {
      executionId,
      selectedModel: route.selectedModel
    });

    let fullOutput = '';
    const startTime = Date.now();
    let isClosed = false;

    res.once('close', () => {
      if (!res.writableEnded) {
        isClosed = true;

        ExecutionAbortRegistry.cancel(
          executionId,
          'Conexão SSE encerrada pelo cliente.'
        );
      }
    });

    try {
      const assembled =
        await ContextBuilder.assemble({
          userId: uid,
          userDisplayName: req.user!.name,
          mode,
          prompt: sanitizedPrompt,
          conversationId,
          projectId,
          knowledgeBaseIds,
          requestPolicy: plan.systemPolicy
        });

      const stream =
        GeminiProvider.generateStream({
          model: route.selectedModel,
          systemInstruction:
            assembled.systemInstruction,
          userMessage:
            assembled.userMessage,
          attachments,
          enableSearchGrounding,
          abortSignal,
          timeoutMs:
            streamModelConfig.timeoutMs,
          maxRetries:
            streamModelConfig.maxRetries
        });

      for await (const chunk of stream) {
        if (isClosed) {
          throw new Error(
            'Conexão abortada pelo cliente.'
          );
        }

        if (chunk.text) {
          fullOutput += chunk.text;

          sendEvent('token', {
            text: chunk.text
          });
        }

        if (chunk.groundingMetadata) {
          const citations =
            CitationService.extractSearchGroundingCitations(
              chunk.groundingMetadata
            );

          if (citations.length > 0) {
            sendEvent('citations', {
              citations
            });
          }
        }
      }

      const inputTokens =
        assembled.tokenCountEstimate;

      const outputTokens =
        CostService.estimateTokenCount(
          fullOutput
        );

      const consumedCredits =
        CostService.calculateCreditCost(
          route.selectedModel,
          inputTokens,
          outputTokens,
          plan.tools.length > 0,
          enableSearchGrounding,
          mode
        );

      await CreditWalletService.confirmConsumption(
        {
          userId: uid,
          reservationId,
          amountConsumed: Math.min(
            consumedCredits,
            route.estimatedCredits
          ),
          operation:
            `Streaming IA (${mode})`,
          idempotencyKey:
            `cnf-${idempotencyKey}`
        }
      );

      await ExecutionTraceService.updateTrace(
        executionId,
        {
          status: 'completed',
          inputTokens,
          outputTokens,
          consumedCredits,
          latencyMs:
            Date.now() - startTime,
          completedAt:
            new Date().toISOString()
        }
      );

      ExecutionAbortRegistry.clear(
        executionId
      );

      sendEvent('completed', {
        executionId,
        consumedCredits,
        totalTokens:
          inputTokens + outputTokens
      });

      res.end();
    } catch (streamError) {
      const message =
        streamError instanceof Error
          ? streamError.message
          : 'Erro desconhecido';

      console.error(
        'Erro na transmissão SSE de IA:',
        streamError
      );

      const wasCancelled =
        abortSignal.aborted || isClosed;

      ExecutionAbortRegistry.clear(
        executionId
      );

      try {
        await CreditWalletService.releaseReservation(
          {
            userId: uid,
            reservationId,
            operation: wasCancelled
              ? 'Estorno por cancelamento da transmissão SSE'
              : `Estorno por erro de transmissão SSE: ${message}`,
            idempotencyKey:
              `rel-${idempotencyKey}`
          }
        );
      } catch (releaseError) {
        console.warn(
          'A reserva SSE já estava liberada ou o estorno falhou:',
          releaseError
        );
      }

      await ExecutionTraceService.updateTrace(
        executionId,
        {
          status: wasCancelled
            ? 'cancelled'
            : 'failed',
          errorCode: wasCancelled
            ? 'client_cancelled'
            : message,
          completedAt:
            new Date().toISOString()
        }
      );

      if (!res.writableEnded) {
        sendEvent(
          wasCancelled
            ? 'cancelled'
            : 'error',
          {
            code: wasCancelled
              ? 'execution_cancelled'
              : 'stream_failed',
            message: wasCancelled
              ? 'Execução cancelada pelo usuário.'
              : message
          }
        );

        res.end();
      }
    }
  }
);

/**
 * POST /api/ai/executions
 * Synchronous execution
 */
aiRouter.post(
  '/executions',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const requestAbortController =
      new AbortController();

    res.once('close', () => {
      if (
        !res.writableEnded &&
        !requestAbortController.signal.aborted
      ) {
        requestAbortController.abort(
          new Error(
            'Conexão encerrada pelo cliente.'
          )
        );
      }
    });

    try {
      const parsedRequest =
        parseExecutionRequest(req.body);

      const result =
        await AIExecutionService.execute(
          {
            userId: req.user!.uid,
            userDisplayName: req.user!.name,
            ...parsedRequest,
            abortSignal:
              requestAbortController.signal
          },
          req.correlationId
        );

      return res.json(result);
    } catch (error) {
      if (
        error instanceof
        InvalidAIAttachmentError
      ) {
        return res.status(400).json({
          error: {
            code:
              'invalid_ai_attachments',
            message: error.issues[0],
            details: error.issues,
            correlationId:
              req.correlationId
          }
        });
      }

      if (
        error instanceof
        InvalidAIRequestError
      ) {
        return res.status(400).json({
          error: {
            code: 'invalid_ai_request',
            message: error.details[0],
            details: error.details,
            correlationId:
              req.correlationId
          }
        });
      }

      if (
        error instanceof
        FeatureFlagDisabledError
      ) {
        return res.status(503).json({
          error: {
            code:
              'feature_temporarily_disabled',
            message:
              'Este recurso está temporariamente indisponível.',
            feature: error.flag,
            correlationId:
              req.correlationId
          }
        });
      }

      if (error instanceof UnknownAIToolError) {
        return res.status(400).json({
          error: {
            code: 'unknown_ai_tool',
            message: error.message,
            correlationId: req.correlationId
          }
        });
      }

      const isInsufficient =
        error instanceof
        InsufficientCreditsError;

      return res
        .status(isInsufficient ? 402 : 500)
        .json({
          error: {
            code: isInsufficient
              ? 'insufficient_credits'
              : 'execution_failed',
            message:
              error instanceof Error
                ? error.message
                : 'Erro ao executar IA.',
            correlationId:
              req.correlationId
          }
        });
    }
  }
);

/**
 * GET /api/ai/executions/:executionId
 */
aiRouter.get(
  '/executions/:executionId',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { executionId } = req.params;

      const trace =
        await ExecutionTraceService.getTrace(
          executionId
        );

      if (
        !trace ||
        (
          trace.userId !== req.user!.uid &&
          req.user!.role !== 'admin'
        )
      ) {
        return res.status(404).json({
          error: {
            code: 'trace_not_found',
            message:
              'Trace de execução não localizado.',
            correlationId:
              req.correlationId
          }
        });
      }

      return res.json({
        execution: trace
      });
    } catch {
      return res.status(500).json({
        error: {
          code: 'trace_fetch_failed',
          message:
            'Erro ao buscar trace.',
          correlationId:
            req.correlationId
        }
      });
    }
  }
);

/**
 * POST /api/ai/executions/:executionId/cancel
 */
aiRouter.post(
  '/executions/:executionId/cancel',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.user!.uid;
      const { executionId } = req.params;

      const trace =
        await ExecutionTraceService.getTrace(
          executionId
        );

      if (
        !trace ||
        trace.userId !== uid
      ) {
        return res.status(404).json({
          error: {
            code: 'trace_not_found',
            message:
              'Execução não encontrada.',
            correlationId:
              req.correlationId
          }
        });
      }

      if (trace.status === 'running') {
        ExecutionAbortRegistry.cancel(
          executionId,
          'Execução cancelada pelo usuário.'
        );

        await CreditWalletService.releaseReservation(
          {
            userId: uid,
            reservationId:
              trace.reservationId,
            operation:
              'Estorno por cancelamento do usuário',
            idempotencyKey:
              `cancel-${executionId}`
          }
        );

        await ExecutionTraceService.updateTrace(
          executionId,
          {
            status: 'cancelled',
            completedAt:
              new Date().toISOString()
          }
        );

        return res.json({
          success: true,
          status: 'cancelled'
        });
      }

      return res.json({
        success: true,
        status: trace.status
      });
    } catch {
      return res.status(500).json({
        error: {
          code: 'cancel_failed',
          message:
            'Erro ao cancelar execução.',
          correlationId:
            req.correlationId
        }
      });
    }
  }
);
