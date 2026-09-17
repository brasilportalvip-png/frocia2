import { afterEach, describe, expect, it, vi } from 'vitest';
import { CIGateService } from '../server/selfEvolution/ciGateService.js';

describe('CI Gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_TOKEN;
  });

  it('aceita o job agregado oficial somente quando o GitHub Actions o concluiu', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      check_runs: [{
        name: 'Build & Verify', status: 'completed', conclusion: 'success',
        app: { slug: 'github-actions', name: 'GitHub Actions' },
      }],
    }), { status: 200 })));

    const result = await CIGateService.runCIGate('a'.repeat(40));
    expect(result).toMatchObject({
      status: 'success', passed: true, typecheckPassed: true,
      unitTestsPassed: true, securityAuditPassed: true,
    });
  });

  it('não confia em check de aplicativo desconhecido com o mesmo nome', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      check_runs: [{
        name: 'Build & Verify', status: 'completed', conclusion: 'success',
        app: { slug: 'untrusted-app', name: 'Untrusted' },
      }],
    }), { status: 200 })));

    const result = await CIGateService.runCIGate('b'.repeat(40));
    expect(result.passed).toBe(false);
  });

  it('rejeita branch mutável e exige SHA', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await CIGateService.runCIGate('main');
    expect(result.status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
