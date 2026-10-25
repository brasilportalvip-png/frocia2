import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { changedPatch, artifactManifest, verifyArtifactFiles } from '../worker/patch-workspace.mjs';
import { executeAutonomousRepairCycle } from '../worker/autonomous-repair-cycle.mjs';
const run = promisify(execFile); const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true }); });
async function workspace() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'froc-artifact-test-')); folders.push(cwd);
  await fs.writeFile(path.join(cwd, 'baseline.txt'), 'baseline\n');
  const git = async (...args: string[]) => (await run('git', args, { cwd })).stdout;
  await git('init', '-q'); await git('config', 'core.autocrlf', 'false'); await git('add', 'baseline.txt');
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'baseline');
  return { cwd, git };
}
describe('diferença efetiva e conteúdo certificado', () => {
  it('interrompe arquivos idênticos sem executar/aprovar uma correção inexistente', async () => {
    const { cwd } = await workspace();
    const patch = await changedPatch(cwd, { files: [{ path: 'baseline.txt', content: 'baseline\n' }], commitMessage: 'diagnostic' });
    const apply = vi.fn(); const certify = vi.fn();
    const result = await executeAutonomousRepairCycle({ restoreBaseline: vi.fn(), generate: async () => patch, apply, certify });
    expect(result).toMatchObject({ noChange: true, passed: false, patch: null });
    expect(apply).not.toHaveBeenCalled(); expect(certify).not.toHaveBeenCalled();
  });
  it('arquivos novos entram no índice de intenção, no diff e no conjunto versionado', async () => {
    const { cwd, git } = await workspace();
    await fs.mkdir(path.join(cwd, 'tests')); await fs.writeFile(path.join(cwd, 'tests/new.test.ts'), 'export const regression = true;\n');
    expect(await git('diff', '--binary')).toBe('');
    await git('add', '--intent-to-add', '--', 'tests/new.test.ts');
    expect(await git('ls-files')).toContain('tests/new.test.ts');
    expect(await git('diff', '--binary')).toContain('export const regression');
    await git('reset', '--hard', 'HEAD'); await git('clean', '-fd');
    expect((await git('status', '--porcelain')).trim()).toBe('');
  });
  it('não publica conteúdo diferente daquele certificado e o hash é independente da ordem', async () => {
    const { cwd } = await workspace(); const files = [{ path: 'baseline.txt', content: 'baseline\n' }];
    await verifyArtifactFiles(cwd, files);
    await fs.writeFile(path.join(cwd, 'baseline.txt'), 'changed by a test');
    await expect(verifyArtifactFiles(cwd, files)).rejects.toThrow('artifact_changed_during_certification');
    const pair = [...files, { path: 'z.ts', content: 'new' }];
    expect(artifactManifest(pair)).toBe(artifactManifest([...pair].reverse()));
    expect(artifactManifest(pair)).not.toBe(artifactManifest([...files, { path: 'z.ts', content: 'different' }]));
  });
});
