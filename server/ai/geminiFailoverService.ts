import { env } from '../config/env.js';
import { ModelRegistry } from './modelRegistry.js';
import { ModelHealthService } from './modelHealthService.js';
import {
  GeminiGenerateOptions,
  GeminiProvider,
  GeminiProviderError,
  GeminiResponse,
} from './providers/geminiProvider.js';

const STABLE_FALLBACKS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

function cleanModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

export function configuredGeminiFailoverChain(
  primaryModel: string,
  preferredFallbacks: string[] = []
): string[] {
  const configured = env.GEMINI_MODEL_FAILOVER_CHAIN.split(',').map(cleanModelId);
  return [
    primaryModel,
    ...configured,
    ...preferredFallbacks,
    env.GEMINI_FALLBACK_MODEL,
    env.GEMINI_DEFAULT_MODEL,
    env.GEMINI_FAST_MODEL,
    ...STABLE_FALLBACKS,
  ].filter((model, index, all) => Boolean(model) && all.indexOf(model) === index);
}

export interface GeminiFailoverResult {
  response: GeminiResponse;
  model: string;
  attemptedModels: string[];
  fallbackUsed: boolean;
}

export class GeminiFailoverService {
  static async generate(
    options: GeminiGenerateOptions,
    preferredFallbacks: string[] = []
  ): Promise<GeminiFailoverResult> {
    const completeChain = configuredGeminiFailoverChain(
      options.model,
      preferredFallbacks
    );
    const healthy = completeChain.filter((model) =>
      ModelHealthService.isModelHealthy(model)
    );
    const candidates = healthy.length > 0 ? healthy : completeChain;
    const attemptedModels: string[] = [];
    let lastError: unknown = null;

    for (let index = 0; index < candidates.length; index += 1) {
      const model = candidates[index];
      const modelConfig = ModelRegistry.getModel(model);
      const startedAt = Date.now();
      attemptedModels.push(model);

      try {
        const response = await GeminiProvider.generate({
          ...options,
          model,
          timeoutMs: options.timeoutMs ?? modelConfig.timeoutMs,
          // Um modelo que recusou a chamada não deve atrasar a troca para o
          // próximo. Somente a última opção usa retries internos.
          maxRetries:
            index === candidates.length - 1
              ? options.maxRetries ?? modelConfig.maxRetries
              : 0,
        });
        ModelHealthService.recordCall(
          model,
          Date.now() - startedAt,
          true,
          false,
          model !== options.model
        );
        return {
          response,
          model,
          attemptedModels,
          fallbackUsed: model !== options.model,
        };
      } catch (error) {
        lastError = error;
        ModelHealthService.recordCall(
          model,
          Date.now() - startedAt,
          false,
          error instanceof GeminiProviderError && error.code === 'gemini_timeout'
        );
      }
    }

    throw lastError || new Error('Nenhum modelo Gemini respondeu.');
  }
}
