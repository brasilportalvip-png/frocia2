import { describe, expect, it } from 'vitest';
import type { OperationalEvent } from '../server/observability/operationalTelemetryService.js';
import { detectRecurringOperationalFailures } from '../server/selfEvolution/operationalAutoDiscoveryService.js';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');

function event(
  index: number,
  status: 'success' | 'error',
  options: Partial<OperationalEvent> = {}
): OperationalEvent {
  return {
    eventId: `event-${String(index).padStart(6, '0')}`,
    category: 'http',
    operation: 'GET /api/conversations',
    resource: '/api/conversations',
    status,
    correlationId: `corr-${index}`,
    errorCode: status === 'error' ? 'http_503' : null,
    occurredAt: new Date(NOW - 60_000).toISOString(),
    occurredAtMs: NOW - 60_000,
    ...options,
  } as OperationalEvent;
}

describe('Autodescoberta baseada em telemetria real', () => {
  it('detecta falhas 5xx recorrentes com evidencias e caminho conhecido', () => {
    const events = Array.from({ length: 12 }, (_, index) =>
      event(index, index < 6 ? 'error' : 'success')
    );
    const patterns = detectRecurringOperationalFailures(events, NOW);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].failureCount).toBe(6);
    expect(patterns[0].observationCount).toBe(12);
    expect(patterns[0].probableFile).toBe('server/routes/conversationRoutes.ts');
    expect(patterns[0].eventIds).toHaveLength(6);
    expect(patterns[0].signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('nao transforma erros de autenticacao HTTP 4xx em melhoria de codigo', () => {
    const events = Array.from({ length: 12 }, (_, index) =>
      event(index, index < 9 ? 'error' : 'success', { errorCode: index < 9 ? 'http_401' : null })
    );
    expect(detectRecurringOperationalFailures(events, NOW)).toHaveLength(0);
  });

  it('nao cria candidatos para poucas falhas ou correlacoes repetidas', () => {
    const events = Array.from({ length: 12 }, (_, index) =>
      event(index, index < 6 ? 'error' : 'success', { correlationId: 'same-corr' })
    );
    expect(detectRecurringOperationalFailures(events, NOW)).toHaveLength(0);
    expect(detectRecurringOperationalFailures(events.slice(0, 5), NOW)).toHaveLength(0);
  });

  it('ignora rotas administrativas, operacoes desconhecidas e telemetria antiga', () => {
    const events = Array.from({ length: 12 }, (_, index) =>
      event(index, index < 8 ? 'error' : 'success', {
        operation: 'GET /api/admin/self-evolution/status',
      })
    );
    expect(detectRecurringOperationalFailures(events, NOW)).toHaveLength(0);
    expect(detectRecurringOperationalFailures(
      events.map((item) => ({ ...item, operation: 'GET /api/unknown' })), NOW
    )).toHaveLength(0);
    expect(detectRecurringOperationalFailures(
      events.map((item) => ({ ...item, operation: 'GET /api/conversations', occurredAtMs: NOW - 25 * 60 * 60 * 1000 })), NOW
    )).toHaveLength(0);
  });

  it('detecta falhas do runtime da IA apenas quando ha amostras suficientes', () => {
    const events = Array.from({ length: 12 }, (_, index) => event(
      index, index < 6 ? 'error' : 'success', {
        category: 'ai', operation: 'model_generate', errorCode: 'provider_failure',
      }
    ));
    const patterns = detectRecurringOperationalFailures(events, NOW);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].probableFile).toBe('server/ai/requestOrchestrator.ts');
  });
});
