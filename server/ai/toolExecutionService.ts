import crypto from 'node:crypto';
import { RedactionService } from '../selfEvolution/redactionService.js';
import { SafetyService } from './safetyService.js';
import { ToolRegistry } from './toolRegistry.js';
import {
  ToolAuthScope,
  ToolDeclaration,
} from './types/ai.js';
import {
  ToolExecutionReceipt,
  ToolExecutionStateStore,
} from './toolExecutionStore.js';
import { recordOperationalEventBestEffort } from '../observability/operationalTelemetryRuntime.js';

export type ToolExecutionErrorCode =
  | 'unknown_tool'
  | 'invalid_arguments'
  | 'missing_scope'
  | 'confirmation_required'
  | 'idempotency_required'
  | 'idempotency_conflict'
  | 'execution_in_progress'
  | 'external_blocker'
  | 'rate_limit_exceeded'
  | 'cost_limit_exceeded'
  | 'handler_not_registered'
  | 'timeout'
  | 'cancelled'
  | 'verification_failed'
  | 'stale_execution'
  | 'state_store_unavailable'
  | 'handler_failed';

export class ToolExecutionError extends Error {
  constructor(
    readonly code: ToolExecutionErrorCode,
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

export class RetryableToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableToolError';
  }
}

export interface ToolExecutionActor {
  userId: string;
  tenantId?: string;
  projectId?: string;
  grantedScopes: ToolAuthScope[];
}

export interface ToolHandlerInput {
  args: Record<string, unknown>;
  actor: ToolExecutionActor;
  signal: AbortSignal;
  idempotencyKey?: string;
  costLimitCredits: number;
}

export interface ToolHandlerResult {
  output: unknown;
  costCredits: number;
  deterministicVerified?: boolean;
  providerReceipt?: unknown;
  humanVerified?: boolean;
}

export type ToolExecutionHandler = (
  input: ToolHandlerInput
) => Promise<ToolHandlerResult>;

export interface ToolExecutionRequest {
  toolName: string;
  args: Record<string, unknown>;
  actor: ToolExecutionActor;
  confirmed?: boolean;
  idempotencyKey?: string;
  estimatedCostCredits: number;
  abortSignal?: AbortSignal;
  correlationId?: string;
}

export interface ToolContractCatalog {
  getTool(name: string): ToolDeclaration | undefined;
}

export interface ToolExecutionLogger {
  info(event: Record<string, unknown>): void;
  error(event: Record<string, unknown>): void;
}

interface ToolExecutionServiceOptions {
  store: ToolExecutionStateStore;
  handlers: Record<string, ToolExecutionHandler>;
  catalog?: ToolContractCatalog;
  logger?: ToolExecutionLogger;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  createExecutionId?: () => string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) =>
          left.localeCompare(right)
        )
        .map(([key, item]) => [
          key,
          canonicalize(item),
        ])
    );
  }

  return value;
}

function payloadHash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function hasProviderReceipt(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return Boolean(
    value &&
      typeof value === 'object' &&
      Object.keys(value).length > 0
  );
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

const defaultLogger: ToolExecutionLogger = {
  info(event) {
    console.info('tool_execution', event);
  },
  error(event) {
    console.error('tool_execution_failed', event);
  },
};

export class ToolExecutionService {
  private readonly catalog: ToolContractCatalog;
  private readonly logger: ToolExecutionLogger;
  private readonly now: () => number;
  private readonly sleep: (
    milliseconds: number
  ) => Promise<void>;
  private readonly createExecutionId: () => string;

  constructor(
    private readonly options: ToolExecutionServiceOptions
  ) {
    this.catalog = options.catalog || ToolRegistry;
    this.logger = options.logger || defaultLogger;
    this.now = options.now || Date.now;
    this.sleep = options.sleep || defaultSleep;
    this.createExecutionId =
      options.createExecutionId || crypto.randomUUID;
  }

  async execute(
    request: ToolExecutionRequest
  ): Promise<ToolExecutionReceipt> {
    const contract = this.catalog.getTool(
      request.toolName
    );

    if (!contract) {
      throw new ToolExecutionError(
        'unknown_tool',
        'Ferramenta não registrada ou não permitida.'
      );
    }

    const validation = SafetyService.validateToolCall(
      contract.name,
      request.args,
      contract
    );

    if (!validation.valid || !validation.data) {
      throw new ToolExecutionError(
        'invalid_arguments',
        validation.error ||
          'Parâmetros da ferramenta são inválidos.'
      );
    }

    this.assertAuthorization(contract, request);
    this.assertCost(contract, request);

    const executionId = this.createExecutionId();
    const startedAtMs = this.now();
    const ownerToken = crypto.randomUUID();
    const idempotencyScope =
      contract.mutatesState && request.idempotencyKey
      ? [
          request.actor.userId,
          request.actor.projectId || 'personal',
          contract.name,
          request.idempotencyKey,
        ].join(':')
      : undefined;
    const executionPayloadHash = payloadHash({
      toolName: contract.name,
      args: validation.data,
      userId: request.actor.userId,
      projectId: request.actor.projectId || null,
    });
    let actionStarted = false;

    if (contract.mutatesState) {
      if (!contract.idempotencyRequired) {
        throw new ToolExecutionError(
          'idempotency_required',
          'Contrato mutável inválido: idempotência precisa ser obrigatória.'
        );
      }

      if (!idempotencyScope) {
        throw new ToolExecutionError(
          'idempotency_required',
          'Ação mutável exige chave de idempotência.'
        );
      }

      const reservation = await this.reserveIdempotency(
        {
          scopeKey: idempotencyScope,
          payloadHash: executionPayloadHash,
          ownerToken,
          leaseMs: this.calculateLeaseMs(contract),
          nowMs: startedAtMs,
        }
      );

      if (
        reservation.outcome === 'replay' &&
        reservation.receipt
      ) {
        return reservation.receipt;
      }

      if (reservation.outcome === 'conflict') {
        throw new ToolExecutionError(
          'idempotency_conflict',
          'Chave de idempotência reutilizada com parâmetros diferentes.'
        );
      }

      if (reservation.outcome === 'in_progress') {
        throw new ToolExecutionError(
          'execution_in_progress',
          'Esta ação já está em execução.'
        );
      }

      if (reservation.outcome === 'external_blocker') {
        throw new ToolExecutionError(
          'external_blocker',
          'O resultado anterior é incerto e exige reconciliação humana ou com o provedor.'
        );
      }
    }

    try {
      await this.enforceRateLimit(
        contract,
        request,
        startedAtMs
      );

      const handler = this.options.handlers[
        contract.name
      ];

      if (!handler) {
        throw new ToolExecutionError(
          'handler_not_registered',
          'A ferramenta não possui executor autorizado.'
        );
      }

      actionStarted = true;
      const handlerResult = await this.runWithRetry({
        contract,
        handler,
        request: {
          ...request,
          args: validation.data,
        },
      });

      this.assertActualCost(
        contract,
        request,
        handlerResult.result
      );
      this.assertOutput(
        contract,
        handlerResult.result
      );
      this.assertVerification(
        contract,
        handlerResult.result
      );

      const completedAtMs = this.now();
      const redactedOutput =
        RedactionService.redactValue(
          handlerResult.result.output,
          contract.redactFields
        );
      const redactedProviderReceipt =
        handlerResult.result.providerReceipt === undefined
          ? undefined
          : RedactionService.redactValue(
              handlerResult.result.providerReceipt,
              contract.redactFields
            );
      const receipt: ToolExecutionReceipt = {
        executionId,
        toolName: contract.name,
        status: 'completed',
        verified: true,
        verificationStrategy:
          contract.verificationStrategy,
        attempts: handlerResult.attempts,
        durationMs: Math.max(
          0,
          completedAtMs - startedAtMs
        ),
        costCredits:
          handlerResult.result.costCredits,
        output: redactedOutput,
        ...(redactedProviderReceipt === undefined
          ? {}
          : {
              providerReceipt:
                redactedProviderReceipt,
            }),
        completedAt: new Date(
          completedAtMs
        ).toISOString(),
        replayed: false,
      };

      if (idempotencyScope) {
        const completed = await this.completeIdempotency({
          scopeKey: idempotencyScope,
          payloadHash: executionPayloadHash,
          ownerToken,
          receipt,
        });

        if (!completed) {
          throw new ToolExecutionError(
            'stale_execution',
            'A execução perdeu a posse do lease e não pode concluir.'
          );
        }
      }

      this.logger.info(
        RedactionService.redactValue(
          {
            event: 'tool_execution_completed',
            executionId,
            toolName: contract.name,
            userId: request.actor.userId,
            projectId:
              request.actor.projectId || null,
            attempts: handlerResult.attempts,
            durationMs: receipt.durationMs,
            costCredits: receipt.costCredits,
            verified: receipt.verified,
          },
          contract.redactFields
        ) as Record<string, unknown>
      );

      await recordOperationalEventBestEffort({
        category: 'tool',
        operation: `tool.${contract.name}`,
        resource: contract.name,
        status: 'success',
        correlationId: request.correlationId || executionId,
        traceId: executionId,
        tenantId: request.actor.tenantId || `user:${request.actor.userId}`,
        userId: request.actor.userId,
        projectId: request.actor.projectId || null,
        durationMs: receipt.durationMs,
        costCredits: receipt.costCredits,
        attempts: receipt.attempts,
        toolName: contract.name,
      });

      return receipt;
    } catch (error) {
      if (idempotencyScope) {
        const failedAt = new Date(
          this.now()
        ).toISOString();

        try {
          if (contract.mutatesState && actionStarted) {
            await this.options.store.markIdempotencyUncertain(
              {
                scopeKey: idempotencyScope,
                ownerToken,
                blockedAt: failedAt,
              }
            );
          } else {
            await this.options.store.failIdempotency({
              scopeKey: idempotencyScope,
              ownerToken,
              failedAt,
            });
          }
        } catch {
          this.logger.error({
            event: 'tool_idempotency_state_failed',
            executionId,
            toolName: contract.name,
          });
        }
      }

      const normalized = this.normalizeError(error);

      this.logger.error({
        event: 'tool_execution_failed',
        executionId,
        toolName: contract.name,
        userId: request.actor.userId,
        code: normalized.code,
      });

      await recordOperationalEventBestEffort({
        category: 'tool',
        operation: `tool.${contract.name}`,
        resource: contract.name,
        status:
          normalized.code === 'external_blocker'
            ? 'blocked'
            : 'error',
        correlationId: request.correlationId || executionId,
        traceId: executionId,
        tenantId: request.actor.tenantId || `user:${request.actor.userId}`,
        userId: request.actor.userId,
        projectId: request.actor.projectId || null,
        durationMs: Math.max(0, this.now() - startedAtMs),
        errorCode: normalized.code,
        toolName: contract.name,
      });

      throw normalized;
    }
  }

  private assertAuthorization(
    contract: ToolDeclaration,
    request: ToolExecutionRequest
  ) {
    const granted = new Set(
      request.actor.grantedScopes
    );
    const missing = contract.authScopes.filter(
      (scope) => !granted.has(scope)
    );

    if (
      contract.authScopes.includes('project') &&
      !request.actor.projectId
    ) {
      missing.push('project');
    }

    if (
      contract.requiredRole === 'admin' &&
      !granted.has('admin')
    ) {
      missing.push('admin');
    }

    if (missing.length > 0) {
      throw new ToolExecutionError(
        'missing_scope',
        `Escopo ausente para a ferramenta: ${[
          ...new Set(missing),
        ].join(', ')}.`
      );
    }

    if (
      contract.requiresConfirmation &&
      request.confirmed !== true
    ) {
      throw new ToolExecutionError(
        'confirmation_required',
        'Ação sensível exige confirmação humana explícita.'
      );
    }
  }

  private assertCost(
    contract: ToolDeclaration,
    request: ToolExecutionRequest
  ) {
    if (
      !Number.isFinite(request.estimatedCostCredits) ||
      request.estimatedCostCredits < 0 ||
      request.estimatedCostCredits >
        contract.costLimitCredits
    ) {
      throw new ToolExecutionError(
        'cost_limit_exceeded',
        'Custo estimado excede o limite da ferramenta.'
      );
    }
  }

  private assertActualCost(
    contract: ToolDeclaration,
    request: ToolExecutionRequest,
    result: ToolHandlerResult
  ) {
    if (
      !Number.isFinite(result.costCredits) ||
      result.costCredits < 0 ||
      result.costCredits >
        contract.costLimitCredits ||
      result.costCredits >
        request.estimatedCostCredits
    ) {
      throw new ToolExecutionError(
        'cost_limit_exceeded',
        'Custo real excedeu a reserva autorizada.'
      );
    }
  }

  private assertVerification(
    contract: ToolDeclaration,
    result: ToolHandlerResult
  ) {
    const verified =
      contract.verificationStrategy ===
      'deterministic'
        ? result.deterministicVerified === true
        : contract.verificationStrategy ===
            'provider_receipt'
          ? hasProviderReceipt(
              result.providerReceipt
            )
          : result.humanVerified === true;

    if (!verified) {
      throw new ToolExecutionError(
        'verification_failed',
        'O resultado da ferramenta não possui evidência verificável.'
      );
    }
  }

  private assertOutput(
    contract: ToolDeclaration,
    result: ToolHandlerResult
  ) {
    const validation = SafetyService.validateToolOutput(
      contract.name,
      result.output,
      contract
    );

    if (!validation.valid) {
      throw new ToolExecutionError(
        'verification_failed',
        validation.error ||
          'Resultado fora do esquema declarado.'
      );
    }
  }

  private async enforceRateLimit(
    contract: ToolDeclaration,
    request: ToolExecutionRequest,
    nowMs: number
  ) {
    let result;

    try {
      result = await this.options.store.consumeRateLimit({
        scopeKey: [
          contract.name,
          request.actor.userId,
          request.actor.projectId || 'personal',
        ].join(':'),
        windowMs: contract.rateLimit.windowMs,
        maxRequests:
          contract.rateLimit.maxRequests,
        nowMs,
      });
    } catch {
      throw new ToolExecutionError(
        'state_store_unavailable',
        'Não foi possível validar o limite de uso da ferramenta.'
      );
    }

    if (!result.allowed) {
      throw new ToolExecutionError(
        'rate_limit_exceeded',
        `Limite da ferramenta excedido até ${result.resetAt}.`
      );
    }
  }

  private async reserveIdempotency(
    input: Parameters<
      ToolExecutionStateStore['reserveIdempotency']
    >[0]
  ) {
    try {
      return await this.options.store.reserveIdempotency(
        input
      );
    } catch {
      throw new ToolExecutionError(
        'state_store_unavailable',
        'Não foi possível reservar a ação idempotente.'
      );
    }
  }

  private async completeIdempotency(
    input: Parameters<
      ToolExecutionStateStore['completeIdempotency']
    >[0]
  ) {
    try {
      return await this.options.store.completeIdempotency(
        input
      );
    } catch {
      throw new ToolExecutionError(
        'state_store_unavailable',
        'Não foi possível persistir o resultado idempotente.'
      );
    }
  }

  private calculateLeaseMs(
    contract: ToolDeclaration
  ): number {
    const backoffTotal =
      contract.retryBackoffMs *
      ((contract.maxRetries *
        (contract.maxRetries + 1)) /
        2);

    return (
      contract.timeoutMs *
        (contract.maxRetries + 1) +
      backoffTotal +
      5_000
    );
  }

  private async runWithRetry(input: {
    contract: ToolDeclaration;
    handler: ToolExecutionHandler;
    request: ToolExecutionRequest;
  }): Promise<{
    result: ToolHandlerResult;
    attempts: number;
  }> {
    const canRetry =
      !input.contract.mutatesState ||
      input.contract.idempotencyRequired;
    const maximumAttempts = canRetry
      ? input.contract.maxRetries + 1
      : 1;
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= maximumAttempts;
      attempt += 1
    ) {
      try {
        const result = await this.runAttempt(input);
        return { result, attempts: attempt };
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof RetryableToolError ||
          (error instanceof ToolExecutionError &&
            error.retryable);

        if (!retryable || attempt >= maximumAttempts) {
          throw error;
        }

        await this.sleep(
          input.contract.retryBackoffMs * attempt
        );
      }
    }

    throw lastError;
  }

  private async runAttempt(input: {
    contract: ToolDeclaration;
    handler: ToolExecutionHandler;
    request: ToolExecutionRequest;
  }): Promise<ToolHandlerResult> {
    if (input.request.abortSignal?.aborted) {
      throw new ToolExecutionError(
        'cancelled',
        'Execução cancelada pelo solicitante.'
      );
    }

    const controller = new AbortController();
    const cancelFromParent = () =>
      controller.abort('cancelled');

    input.request.abortSignal?.addEventListener(
      'abort',
      cancelFromParent,
      { once: true }
    );

    let timeoutHandle:
      | ReturnType<typeof setTimeout>
      | undefined;

    const timeoutPromise =
      new Promise<ToolHandlerResult>(
        (_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new ToolExecutionError(
                'timeout',
                'A ferramenta excedeu o tempo limite.',
                true
              )
            );
            controller.abort('timeout');
          }, input.contract.timeoutMs);
        }
      );

    try {
      const execution = input.handler({
        args: input.request.args,
        actor: input.request.actor,
        signal: controller.signal,
        idempotencyKey:
          input.request.idempotencyKey,
        costLimitCredits: Math.min(
          input.contract.costLimitCredits,
          input.request.estimatedCostCredits
        ),
      });

      return await Promise.race([
        execution,
        timeoutPromise,
      ]);
    } catch (error) {
      if (
        input.request.abortSignal?.aborted &&
        !(
          error instanceof ToolExecutionError &&
          error.code === 'timeout'
        )
      ) {
        throw new ToolExecutionError(
          'cancelled',
          'Execução cancelada pelo solicitante.'
        );
      }

      throw error;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      input.request.abortSignal?.removeEventListener(
        'abort',
        cancelFromParent
      );
    }
  }

  private normalizeError(error: unknown) {
    if (error instanceof ToolExecutionError) {
      return error;
    }

    if (error instanceof RetryableToolError) {
      return new ToolExecutionError(
        'handler_failed',
        'A ferramenta falhou após as tentativas permitidas.',
        true
      );
    }

    return new ToolExecutionError(
      'handler_failed',
      'A ferramenta falhou sem expor detalhes internos.'
    );
  }
}
