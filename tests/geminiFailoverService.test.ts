import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configuredGeminiFailoverChain,
  GeminiFailoverService,
} from '../server/ai/geminiFailoverService.js';
import { ModelHealthService } from '../server/ai/modelHealthService.js';
import {
  GeminiProvider,
  GeminiProviderError,
} from '../server/ai/providers/geminiProvider.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  ModelHealthService.reset();
});

describe('Continuidade entre modelos Gemini', () => {
  it('mantém a cadeia estável completa, ordenada e sem duplicatas', () => {
    const chain = configuredGeminiFailoverChain('gemini-3.7-flash');

    expect(chain.slice(0, 4)).toEqual([
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
    ]);
    expect(new Set(chain).size).toBe(chain.length);
  });

  it('troca de modelo após falha explícita e registra o modelo que respondeu', async () => {
    const generate = vi
      .spyOn(GeminiProvider, 'generate')
      .mockRejectedValueOnce(
        new GeminiProviderError('gemini_provider_failed', 'indisponível')
      )
      .mockResolvedValueOnce({
        text: 'resposta do fallback',
        inputTokens: 10,
        outputTokens: 5,
      });

    const result = await GeminiFailoverService.generate({
      model: 'gemini-3.7-flash',
      userMessage: 'teste',
    });

    expect(result.model).toBe('gemini-3.6-flash');
    expect(result.fallbackUsed).toBe(true);
    expect(result.attemptedModels).toEqual([
      'gemini-3.7-flash',
      'gemini-3.6-flash',
    ]);
    expect(generate.mock.calls[0][0].maxRetries).toBe(0);
  });

  it('abre o circuit breaker após falhas consecutivas', () => {
    ModelHealthService.recordCall('gemini-test', 20, false);
    expect(ModelHealthService.isModelHealthy('gemini-test')).toBe(true);
    ModelHealthService.recordCall('gemini-test', 20, false);
    expect(ModelHealthService.isModelHealthy('gemini-test')).toBe(false);
  });

  it('fecha o circuito após o cooldown e uma chamada de prova bem-sucedida', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T12:00:00.000Z'));
    ModelHealthService.recordCall('gemini-test', 20, false);
    ModelHealthService.recordCall('gemini-test', 20, false);
    expect(ModelHealthService.isModelHealthy('gemini-test')).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(ModelHealthService.isModelHealthy('gemini-test')).toBe(true);
    ModelHealthService.recordCall('gemini-test', 20, true);

    expect(ModelHealthService.getHealthOverview()[0].status).toBe('healthy');
  });

  it('registra fallback quando o modelo primário foi ignorado por circuito aberto', async () => {
    ModelHealthService.recordCall('gemini-3.7-flash', 20, false);
    ModelHealthService.recordCall('gemini-3.7-flash', 20, false);
    vi.spyOn(GeminiProvider, 'generate').mockResolvedValueOnce({
      text: 'resposta saudável',
      inputTokens: 10,
      outputTokens: 5,
    });

    const result = await GeminiFailoverService.generate({
      model: 'gemini-3.7-flash',
      userMessage: 'teste',
    });

    expect(result.model).toBe('gemini-3.6-flash');
    expect(result.fallbackUsed).toBe(true);
  });
});
