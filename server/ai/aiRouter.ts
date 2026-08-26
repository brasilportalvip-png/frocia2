import { env } from '../config/env.js';
import { ModelRegistry } from './modelRegistry.js';
import { ModelHealthService } from './modelHealthService.js';
import { CostService } from './costService.js';
import { RouterInput, RouterResult, AIMode } from './types/ai.js';

export class AIRouter {
  static route(input: RouterInput): RouterResult {
    const {
      mode,
      prompt,
      hasImages = false,
      hasFiles = false,
      requiresTools = false,
      requiresSearch = false,
      requiresCode = false,
      contextSizeEstimate = 0,
      complexity = 'standard',
      sensitivity = 'normal',
      preferredModel,
    } = input;

    const effectiveRequiresSearch = requiresSearch || mode === 'research';

    let selectedModel = env.GEMINI_DEFAULT_MODEL;
    let fallbackModels: string[] = [env.GEMINI_FALLBACK_MODEL, env.GEMINI_FAST_MODEL];
    let reasonCode = 'mode_default';

    // 1. If explicit preferredModel provided and enabled/healthy
    if (preferredModel && ModelHealthService.isModelHealthy(preferredModel)) {
      selectedModel = preferredModel;
      reasonCode = 'user_preferred';
    } else {
      // 2. Select by mode & requirements
      switch (mode) {
        case 'fast':
          selectedModel = env.GEMINI_FAST_MODEL;
          fallbackModels = [env.GEMINI_DEFAULT_MODEL];
          reasonCode = 'mode_fast';
          break;

        case 'smart':
        case 'deep':
        case 'code':
          if (requiresCode || mode === 'code' || mode === 'deep') {
            selectedModel = env.GEMINI_REASONING_MODEL;
            fallbackModels = [env.GEMINI_DEFAULT_MODEL, env.GEMINI_FAST_MODEL];
            reasonCode = 'mode_reasoning';
          } else {
            selectedModel = env.GEMINI_DEFAULT_MODEL;
            fallbackModels = [env.GEMINI_FAST_MODEL];
            reasonCode = 'mode_smart';
          }
          break;

        case 'research':
          selectedModel = env.GEMINI_DEFAULT_MODEL;
          fallbackModels = [env.GEMINI_REASONING_MODEL, env.GEMINI_FAST_MODEL];
          reasonCode = 'mode_research_grounded';
          break;

        case 'site-builder':
          selectedModel = env.GEMINI_DEFAULT_MODEL;
          fallbackModels = [env.GEMINI_REASONING_MODEL, env.GEMINI_FAST_MODEL];
          reasonCode = 'mode_site_builder';
          break;

        case 'image':
        case 'video':
        case 'document':
          selectedModel = env.GEMINI_DEFAULT_MODEL;
          fallbackModels = [env.GEMINI_FAST_MODEL];
          reasonCode = 'mode_multimodal';
          break;

        default:
          selectedModel = env.GEMINI_DEFAULT_MODEL;
          fallbackModels = [env.GEMINI_FAST_MODEL];
          reasonCode = 'mode_fallback';
      }
    }

    if (
      !preferredModel &&
      (complexity === 'complex' ||
        sensitivity === 'high-stakes' ||
        contextSizeEstimate > 8_000) &&
      mode !== 'image' &&
      mode !== 'video'
    ) {
      selectedModel = env.GEMINI_REASONING_MODEL;
      fallbackModels = [
        env.GEMINI_DEFAULT_MODEL,
        env.GEMINI_FAST_MODEL,
      ];
      reasonCode =
        sensitivity === 'high-stakes'
          ? 'high_stakes_reasoning'
          : contextSizeEstimate > 8_000
            ? 'long_context_reasoning'
            : 'complex_request_reasoning';
    }

    // Check health of primary selection; fallback if unhealthy
    if (!ModelHealthService.isModelHealthy(selectedModel)) {
      const healthyFallback = fallbackModels.find((m) => ModelHealthService.isModelHealthy(m));
      if (healthyFallback) {
        selectedModel = healthyFallback;
        reasonCode = 'primary_unhealthy_fallback_selected';
      }
    }

    // Deduplicate fallback list excluding selected model
    fallbackModels = Array.from(new Set(fallbackModels)).filter((m) => m !== selectedModel);

    const estimatedCredits = CostService.estimateReservationCeiling(
  selectedModel,
  prompt,
  hasImages,
  requiresTools,
  effectiveRequiresSearch,
  mode
);

    return {
      selectedModel,
      fallbackModels,
      reasonCode,
      estimatedCredits,
      requiredCapabilities: {
        text: true,
        vision: hasImages,
        code: requiresCode,
        tools: requiresTools,
      },
    };
  }
}
