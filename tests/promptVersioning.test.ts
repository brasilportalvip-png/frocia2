import { describe, expect, it } from 'vitest';
import { nextPromptVersion } from '../server/routes/adminAiRoutes.js';

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
