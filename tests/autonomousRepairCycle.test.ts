import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { executeAutonomousRepairCycle } from '../worker/autonomous-repair-cycle.mjs';

describe('autonomous repair cycle', () => {
  it('restaura o Git com o mesmo usuário isolado proprietário da sandbox', () => {
    const worker = readFileSync(new URL('../worker/server.mjs', import.meta.url), 'utf8');
    const ownership = worker.indexOf("const initialOwnership = await run('chown'");
    const cycle = worker.indexOf('const repairCycle = await executeAutonomousRepairCycle');

    expect(ownership).toBeGreaterThan(-1);
    expect(ownership).toBeLessThan(cycle);
    expect(worker).toContain("run('chown', ['-R', '10001:10001', temp], temp, 30_000)");
    expect(worker).toContain("run('git', ['reset', '--hard', baseSha], cwd, 30_000, {}, true)");
    expect(worker).toContain("run('git', ['clean', '-fd'], cwd, 30_000, {}, true)");
  });

  it('usa a falha comprovada para reparar e escolhe apenas tentativa certificada', async () => {
    const generate = vi.fn(async ({ attempt, feedback }) => ({ files: [{ path: 'src/fix.ts', content: `${attempt}:${feedback?.stage || 'initial'}` }] }));
    const restoreBaseline = vi.fn(async () => undefined);
    const apply = vi.fn(async () => undefined);
    const certify = vi.fn(async ({ attempt }) => attempt === 1
      ? { passed: false, failure: { stage: 'typecheck', exitCode: 2, summary: 'TS2322', stdoutTail: 'src/fix.ts: TS2322', stdoutSha256: 'a'.repeat(64), stderrSha256: 'b'.repeat(64) } }
      : { passed: true, evidenceRefs: ['typecheck:sha256', 'tests:sha256'] });
    const result = await executeAutonomousRepairCycle({ maximumAttempts: 3, generate, restoreBaseline, apply, certify });
    expect(result.passed).toBe(true);
    expect(result.selectedAttempt).toBe(2);
    expect(generate).toHaveBeenNthCalledWith(2, expect.objectContaining({ feedback: expect.objectContaining({ stage: 'typecheck', stdoutTail: 'src/fix.ts: TS2322' }) }));
    expect(result.attempts).toHaveLength(2);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('falha fechado, limita tentativas e restaura baseline no final', async () => {
    const restoreBaseline = vi.fn(async () => undefined);
    const result = await executeAutonomousRepairCycle({
      maximumAttempts: 99, restoreBaseline,
      generate: async ({ attempt }) => ({ attempt }), apply: async () => undefined,
      certify: async () => ({ passed: false, failure: { stage: 'test', exitCode: 1, summary: 'failed' } }),
    });
    expect(result.passed).toBe(false);
    expect(result.attempts).toHaveLength(5);
    expect(restoreBaseline).toHaveBeenCalledTimes(6);
  });

  it('registra falha recuperavel de geracao, restaura e nao aplica nem certifica a resposta invalida', async () => {
    const apply = vi.fn(async () => undefined);
    const certify = vi.fn(async () => ({ passed: true }));
    const restoreBaseline = vi.fn(async () => undefined);
    const generate = vi.fn().mockRejectedValueOnce(Object.assign(new Error('generator_invalid_json'), { retryable: true }))
      .mockResolvedValueOnce({ files: [{ path: 'src/fix.ts', content: 'valid' }] });
    const result = await executeAutonomousRepairCycle({ maximumAttempts: 3, restoreBaseline, generate, apply, certify });
    expect(result).toMatchObject({ passed: true, selectedAttempt: 2 });
    expect(result.attempts[0]).toMatchObject({ patchDigest: null, passed: false, failure: { stage: 'generation', summary: 'generator_invalid_json' } });
    expect(generate).toHaveBeenNthCalledWith(2, { attempt: 2, feedback: expect.objectContaining({ stage: 'generation' }) });
    expect(apply).toHaveBeenCalledTimes(1); expect(certify).toHaveBeenCalledTimes(1);
    expect(restoreBaseline).toHaveBeenCalledTimes(2);
  });

  it('encerra com recibo e baseline limpa ao esgotar geracao; nenhum teste e apresentado como aprovado', async () => {
    const restoreBaseline = vi.fn(async () => undefined);
    const apply = vi.fn(); const certify = vi.fn();
    const result = await executeAutonomousRepairCycle({ maximumAttempts: 3, restoreBaseline, apply, certify,
      generate: async () => { throw Object.assign(new Error('generator_response_incomplete; finishReason=MAX_TOKENS'), { retryable: true }); } });
    expect(result).toMatchObject({ passed: false, patch: null, selectedAttempt: null });
    expect(result.attempts).toHaveLength(3);
    expect(restoreBaseline).toHaveBeenCalledTimes(4);
    expect(apply).not.toHaveBeenCalled(); expect(certify).not.toHaveBeenCalled();
  });

  it.each([401, 403])('nao repete uma recusa permanente HTTP %s do provedor', async status => {
    const generate = vi.fn(async () => { throw Object.assign(new Error('provider_denied'), { status, retryable: false }); });
    const restoreBaseline = vi.fn(async () => undefined);
    const result = await executeAutonomousRepairCycle({ maximumAttempts: 3, restoreBaseline, generate, apply: vi.fn(), certify: vi.fn() });
    expect(result.passed).toBe(false);
    expect(result.attempts[0].failure.providerStatus).toBe(status);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(restoreBaseline).toHaveBeenCalledTimes(2);
  });

  it.each([NaN, Infinity, 'invalido'])('limita a configuracao invalida de tentativas (%s)', async maximumAttempts => {
    const result = await executeAutonomousRepairCycle({ maximumAttempts, restoreBaseline: async () => undefined,
      generate: async () => { throw Object.assign(new Error('retry'), { retryable: true }); }, apply: vi.fn(), certify: vi.fn() });
    expect(result.attempts).toHaveLength(3);
  });
});
