import { describe, expect, it } from 'vitest';
import { buildAdminModelViews } from '../src/components/AdminPanel.js';

describe('Admin model health from persisted executions', () => {
  it('combines configured models with real execution samples', () => {
    const views = buildAdminModelViews(
      [{ id: 'gemini-3.7-flash', pricing: { baseCreditCost: 2 } }],
      [
        {
          selectedModel: 'gemini-3.7-flash',
          attemptedModels: ['gemini-3.7-flash'],
          status: 'completed',
          latencyMs: 1_000,
        },
        {
          selectedModel: 'gemini-3.7-flash',
          attemptedModels: ['gemini-3.7-flash'],
          status: 'failed',
          latencyMs: 3_000,
        },
      ]
    );

    expect(views).toEqual([
      expect.objectContaining({
        id: 'gemini-3.7-flash',
        configured: true,
        baseCredits: 2,
        calls: 2,
        averageLatencyMs: 2_000,
        errorRate: 0.5,
        status: 'degradado',
      }),
    ]);
  });

  it('labels an observed but no longer configured model as historical', () => {
    const views = buildAdminModelViews([], [
      {
        selectedModel: 'gemini-3.1-pro-preview',
        status: 'completed',
        latencyMs: 5_000,
      },
    ]);

    expect(views[0]).toEqual(
      expect.objectContaining({
        id: 'gemini-3.1-pro-preview',
        configured: false,
        baseCredits: null,
        calls: 1,
        status: 'historico',
      })
    );
  });

  it('attributes a successful fallback to the model that completed the path', () => {
    const views = buildAdminModelViews(
      [
        { id: 'gemini-primary' },
        { id: 'gemini-fallback' },
      ],
      [
        {
          selectedModel: 'gemini-primary',
          attemptedModels: ['gemini-primary', 'gemini-fallback'],
          status: 'completed',
          latencyMs: 2_500,
        },
      ]
    );

    expect(views.find((view) => view.id === 'gemini-fallback')?.calls).toBe(1);
    expect(views.find((view) => view.id === 'gemini-primary')?.calls).toBe(0);
    expect(views.find((view) => view.id === 'gemini-primary')?.status).toBe('sem_dados');
  });

  it('marks a configured model as degraded when real latency exceeds the SLO', () => {
    const views = buildAdminModelViews(
      [{ id: 'gemini-3.7-flash' }],
      [
        {
          selectedModel: 'gemini-3.7-flash',
          status: 'completed',
          latencyMs: 3_146,
        },
      ]
    );

    expect(views[0]).toEqual(
      expect.objectContaining({
        averageLatencyMs: 3_146,
        errorRate: 0,
        status: 'degradado',
      })
    );
  });
});
