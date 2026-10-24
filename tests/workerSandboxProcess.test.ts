import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../worker/sandbox-process.mjs';

describe('Comandos reais do executor da sandbox', () => {
  let cwd: string;
  beforeEach(async () => { cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'froc-process-test-')); });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.chmod(cwd, 0o700);
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('entrega o ambiente de teste sem herdar os segredos do controlador', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'private-google-key');
    vi.stubEnv('SELF_EVOLUTION_WORKER_TOKEN', 'private-worker-token');
    const result = await run(process.execPath, ['-e', `console.log(JSON.stringify({
      cwd:process.cwd(),home:process.env.HOME,ci:process.env.CI,nodeEnv:process.env.NODE_ENV,
      hasKey:!!process.env.GEMINI_API_KEY,hasToken:!!process.env.SELF_EVOLUTION_WORKER_TOKEN
    }))`], cwd, 5000);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ cwd, home: cwd, ci: 'true', nodeEnv: 'test', hasKey: false, hasToken: false });
  });

  it('restaura um repositorio real e remove arquivos nao versionados', async () => {
    const git = async (...args: string[]) => {
      const result = await run('git', args, cwd, 5000);
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      return result.stdout.toString();
    };
    await git('init', '-q');
    // A fixture exige bytes LF independentemente da configuracao global do Git no Windows.
    await git('config', 'core.autocrlf', 'false');
    await fs.writeFile(path.join(cwd, 'value.txt'), 'baseline\n');
    await git('add', '.');
    await git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'baseline');
    const sha = (await git('rev-parse', 'HEAD')).trim();
    await fs.writeFile(path.join(cwd, 'value.txt'), 'patch\n');
    await fs.writeFile(path.join(cwd, 'extra.txt'), 'untracked\n');
    expect(await git('diff', '--', 'value.txt')).toContain('+patch');
    await git('reset', '--hard', sha);
    await git('clean', '-fd');
    expect(await fs.readFile(path.join(cwd, 'value.txt'), 'utf8')).toBe('baseline\n');
    expect(await git('status', '--porcelain')).toBe('');
  });

  it.skipIf(process.platform === 'win32')('reproduz EACCES quando o controlador nao pode entrar no cwd', async () => {
    await fs.chmod(cwd, 0o000);
    await expect(run('git', ['status'], cwd, 5000)).rejects.toMatchObject({ code: 'EACCES', syscall: 'spawn git' });
    await fs.chmod(cwd, 0o700);
    expect((await run('git', ['--version'], cwd, 5000)).exitCode).toBe(0);
  });

  it('interrompe um comando que ultrapassa o tempo limite', async () => {
    const result = await run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], cwd, 100);
    expect(result.exitCode).toBe(124);
    expect(result.durationMs).toBeLessThan(5000);
  });

  it.skipIf(process.platform === 'win32')('interrompe os descendentes antes de restaurar o workspace', async () => {
    const result = await run(process.execPath, ['-e', `
      require('node:child_process').spawn(process.execPath, ['-e',
        "setTimeout(() => require('node:fs').writeFileSync('late-write.txt','unexpected'), 250)"]);
      setInterval(() => {}, 1000);
    `], cwd, 100);
    expect(result.exitCode).toBe(124);
    await new Promise(resolve => setTimeout(resolve, 350));
    await expect(fs.access(path.join(cwd, 'late-write.txt'))).rejects.toBeDefined();
  });
});
