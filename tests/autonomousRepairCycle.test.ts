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
      ? { passed: false, failure: { stage: 'typecheck', exitCode: 2, summary: 'TS2322', stdoutSha256: 'a'.repeat(64), stderrSha256: 'b'.repeat(64) } }
      : { passed: true, evidenceRefs: ['typecheck:sha256', 'tests:sha256'] });
    const result = await executeAutonomousRepairCycle({ maximumAttempts: 3, generate, restoreBaseline, apply, certify });
    expect(result.passed).toBe(true);
    expect(result.selectedAttempt).toBe(2);
    expect(generate).toHaveBeenNthCalledWith(2, expect.objectContaining({ feedback: expect.objectContaining({ stage: 'typecheck' }) }));
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
});
