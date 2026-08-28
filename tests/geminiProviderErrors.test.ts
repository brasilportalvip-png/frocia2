import { describe, expect, it } from 'vitest';
import {
  GeminiProviderError,
  normalizeGeminiProviderError,
} from '../server/ai/providers/geminiProvider.js';

describe('Erros públicos do provedor Gemini', () => {
  it('não expõe o JSON bruto quando a cota está esgotada', () => {
    const error = normalizeGeminiProviderError(
      new Error(
        '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Your prepayment credits are depleted"}}'
      )
    );

    expect(error).toBeInstanceOf(GeminiProviderError);
    expect(error.code).toBe('gemini_quota_exhausted');
    expect(error.message).toContain('limite ou saldo');
    expect(error.message).not.toContain('prepayment');
    expect(error.message).not.toContain('{"error"');
  });

  it('distingue credencial recusada de timeout', () => {
    expect(
      normalizeGeminiProviderError(
        new Error('403 PERMISSION_DENIED')
      ).code
    ).toBe('gemini_not_authorized');
    expect(
      normalizeGeminiProviderError(
        new Error('DEADLINE_EXCEEDED')
      ).code
    ).toBe('gemini_timeout');
  });
});
