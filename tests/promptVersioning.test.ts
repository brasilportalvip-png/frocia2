import { describe, expect, it } from 'vitest';
import {
  canActivatePromptVersion,
  nextPromptVersion,
} from '../server/routes/adminAiRoutes.js';
import { isAutomatedEvaluationModel } from '../server/ai/evaluationService.js';
import { ModelRegistry } from '../server/ai/modelRegistry.js';

describe('Prompt semantic versioning', () => {
  it('creates v1.1.0 after the immutable v1.0.0 baseline', () => {
    expect(nextPromptVersion(0)).toEqual({
      sequence: 1,
      version: 'v1.1.0',
    });
  });

  it('increments versions deterministically', () => {
    expect(nextPromptVersion(4)).toEqual({
      sequence: 5,
      version: 'v1.5.0',
    });
  });

  it('migrates legacy definitions without a sequence safely', () => {
    expect(nextPromptVersion(undefined)).toEqual({
      sequence: 1,
      version: 'v1.1.0',
    });
  });
});

describe('Prompt evaluation governance', () => {
  it('blocks activation without the minimum real score', () => {
    expect(canActivatePromptVersion(null)).toBe(false);
    expect(canActivatePromptVersion(0.74)).toBe(false);
    expect(canActivatePromptVersion(0.75)).toBe(true);
  });

  it('does not offer an embedding model for text generation tests', () => {
    expect(
      isAutomatedEvaluationModel(
        ModelRegistry.listEnabledModels().find(
          (model) => model.capabilities.embeddings
        )!
      )
    ).toBe(false);
    expect(
      isAutomatedEvaluationModel(
        ModelRegistry.listEnabledModels().find(
          (model) => model.capabilities.text && !model.capabilities.embeddings
        )!
      )
    ).toBe(true);
  });
});
