import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndependentResponseVerifier } from '../server/ai/independentResponseVerifier.js';
import {
  GeminiProvider,
  GeminiProviderError,
} from '../server/ai/providers/geminiProvider.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IndependentResponseVerifier', () => {
  it('aprova resposta válida', async () => {
    vi.spyOn(GeminiProvider, 'generate').mockResolvedValueOnce({
      text: JSON.stringify({
        approved: true,
        revisedResponse: '',
        reason: 'Resposta consistente e sustentada.',
        risks: [],
      }),
      inputTokens: 10,
      outputTokens: 10,
    });

    const result = await IndependentResponseVerifier.verify({
      prompt: 'Qual é a informação correta?',
      response: 'Resposta sustentada.',
      domain: 'research',
      sensitivity: 'normal',
      citations: [
        {
          title: 'Fonte oficial',
          uri: 'https://example.com',
          snippet: 'Evidência correspondente.',
          domain: 'example.com',
        },
      ],
    });

    expect(result.approved).toBe(true);
    expect(result.revisedResponse).toBeUndefined();
    expect(result.risks).toEqual([]);
  });

  it('retorna resposta revisada quando encontra erro corrigível', async () => {
    vi.spyOn(GeminiProvider, 'generate').mockResolvedValueOnce({
      text: JSON.stringify({
        approved: false,
        revisedResponse: 'Resposta corrigida e sustentada.',
        reason: 'A resposta original continha uma afirmação incorreta.',
        risks: ['unsupported_claim'],
      }),
      inputTokens: 10,
      outputTokens: 10,
    });

    const result = await IndependentResponseVerifier.verify({
      prompt: 'Revise esta informação.',
      response: 'Resposta incorreta.',
      domain: 'research',
      sensitivity: 'normal',
    });

    expect(result.approved).toBe(false);
    expect(result.revisedResponse).toBe(
      'Resposta corrigida e sustentada.'
    );
    expect(result.risks).toContain('unsupported_claim');
  });

  it('falha de forma controlada quando o provedor recusa a verificação', async () => {
    vi.spyOn(GeminiProvider, 'generate').mockRejectedValueOnce(
      new GeminiProviderError(
        'gemini_not_authorized',
        'Chave inválida.'
      )
    );

    const result = await IndependentResponseVerifier.verify({
      prompt: 'Teste.',
      response: 'Resposta.',
      domain: 'general',
      sensitivity: 'normal',
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe('Chave inválida.');
    expect(result.risks).toContain('gemini_not_authorized');
  });
});