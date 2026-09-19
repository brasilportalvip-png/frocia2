import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutonomousBrowserValidationService, REQUIRED_BROWSER_SCENARIOS } from '../server/selfEvolution/autonomousBrowserValidationService.js';

describe('AutonomousBrowserValidationService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SELF_EVOLUTION_WORKER_URL;
    delete process.env.SELF_EVOLUTION_WORKER_TOKEN;
    delete process.env.SELF_EVOLUTION_WORKER_SIGNING_SECRET;
  });

  it('aceita homologação somente com cenários, traces e assinatura completos', async () => {
    const secret = 's'.repeat(32);
    process.env.SELF_EVOLUTION_WORKER_URL = 'https://worker.example.com';
    process.env.SELF_EVOLUTION_WORKER_TOKEN = 'token';
    process.env.SELF_EVOLUTION_WORKER_SIGNING_SECRET = secret;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const report = {
        schemaVersion: 'browser-validation-v1', requestNonce: request.requestNonce,
        sandboxId: 'browser:1', commitSha: request.commitSha, previewUrl: request.previewUrl,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        scenarios: REQUIRED_BROWSER_SCENARIOS.map((id) => ({
          id, status: 'passed', durationMs: 10, traceSha256: 'a'.repeat(64),
          screenshotSha256: 'b'.repeat(64), details: 'ok',
        })),
        consoleErrors: [], failedRequests: [], passed: true,
      };
      const raw = JSON.stringify(report);
      const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      return new Response(raw, { status: 200, headers: { 'x-frocia-worker-signature': `sha256=${signature}` } });
    }));
    const report = await AutonomousBrowserValidationService.validate({
      previewUrl: 'https://preview.example.com/', commitSha: 'a'.repeat(40), candidateId: 'c1',
    });
    expect(report.passed).toBe(true);
    expect(report.scenarios).toHaveLength(REQUIRED_BROWSER_SCENARIOS.length);
  });

  it('rejeita relatório que afirma sucesso com erro de console', async () => {
    const secret = 's'.repeat(32);
    process.env.SELF_EVOLUTION_WORKER_URL = 'https://worker.example.com';
    process.env.SELF_EVOLUTION_WORKER_TOKEN = 'token';
    process.env.SELF_EVOLUTION_WORKER_SIGNING_SECRET = secret;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const raw = JSON.stringify({
        schemaVersion: 'browser-validation-v1', requestNonce: request.requestNonce,
        sandboxId: 'browser:1', commitSha: request.commitSha, previewUrl: request.previewUrl,
        startedAt: '', completedAt: '',
        scenarios: REQUIRED_BROWSER_SCENARIOS.map((id) => ({ id, status: 'passed', durationMs: 1, traceSha256: 'a'.repeat(64), details: 'ok' })),
        consoleErrors: ['boom'], failedRequests: [], passed: true,
      });
      return new Response(raw, { status: 200, headers: {
        'x-frocia-worker-signature': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`,
      } });
    }));
    await expect(AutonomousBrowserValidationService.validate({
      previewUrl: 'https://preview.example.com/', commitSha: 'a'.repeat(40), candidateId: 'c1',
    })).rejects.toThrow('conclusion');
  });
});
