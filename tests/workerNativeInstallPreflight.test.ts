import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareNativeSmokeProject } from '../worker/sandbox-preflight.mjs';
import { run } from '../worker/sandbox-process.mjs';

describe.skipIf(process.platform !== 'linux')('Instalacao npm com binario nativo no workspace', () => {
  let cwd: string;
  beforeEach(async () => { cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'froc-native-install-')); });
  afterEach(async () => { await fs.rm(cwd, { recursive: true, force: true }); });

  it('executa um ELF real no instalador offline do npm e comprova teste/rollback Git', async () => {
    const native = await prepareNativeSmokeProject(cwd);
    expect((await fs.readFile(native)).subarray(0, 4).toString('hex')).toBe('7f454c46');
    const checked = async (command: string, args: string[]) => {
      const result = await run(command, args, cwd, 15_000);
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      return result.stdout.toString();
    };
    await checked('git', ['init', '-q']);
    await checked('git', ['add', '.']);
    await checked('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'baseline']);
    const sha = (await checked('git', ['rev-parse', 'HEAD'])).trim();
    await checked(native, []);
    expect(await checked('npm', ['ci', '--offline'])).toContain('native-install-ok');
    await fs.writeFile(path.join(cwd, 'value.txt'), 'patch\n');
    await checked('npm', ['test']);
    await checked('git', ['diff', '--check']);
    await checked('git', ['reset', '--hard', sha]);
    await checked('git', ['clean', '-fd']);
    expect(await checked('git', ['status', '--porcelain'])).toBe('');
    expect(await fs.readFile(path.join(cwd, 'value.txt'), 'utf8')).toBe('baseline\n');
  });

  it('detecta o EACCES que um teste somente em JavaScript deixa passar', async () => {
    const native = await prepareNativeSmokeProject(cwd);
    await fs.chmod(native, 0o644);
    // O teste antigo passava: Node vem de fora do workspace e so le JS.
    await fs.writeFile(path.join(cwd, 'value.txt'), 'patch\n');
    const js = await run('npm', ['test'], cwd, 15_000);
    expect(js.exitCode, js.stderr.toString()).toBe(0);
    const failed = await run('npm', ['ci', '--offline'], cwd, 15_000);
    expect(failed.exitCode).not.toBe(0);
    expect(failed.stderr.toString()).toMatch(/spawnSync .*native-smoke EACCES/);
    await fs.chmod(native, 0o755);
    const repaired = await run('npm', ['ci', '--offline'], cwd, 15_000);
    expect(repaired.exitCode, repaired.stderr.toString()).toBe(0);
    expect(repaired.stdout.toString()).toContain('native-install-ok');
  });
});
