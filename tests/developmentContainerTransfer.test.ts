import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyDevelopmentDirectory, processCommand } from '../server/development/dockerSandbox';
import type { CommandReceipt } from '../server/development/agent';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });
const receipt = (exitCode: number, stdout = '', stderr = ''): CommandReceipt => ({
  command: 'transfer-test', exitCode, stdout, stderr, startedAt: new Date().toISOString(), durationMs: 0,
  stdoutSha256: createHash('sha256').update(stdout).digest('hex'), stderrSha256: createHash('sha256').update(stderr).digest('hex'),
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'froc-transfer-test-')); temporary.push(root);
  await fs.chmod(root, 0o755);
  const source = path.join(root, 'source'); await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'file.txt'), 'source preserved');
  return { root, source };
}

// These tests exercise real GNU tar with the current Linux/CI user's permissions.
// The Docker namespace, UID 10001, network and rootfs proof remains in integration.
describe.skipIf(process.platform !== 'linux')('Transferência para os tmpfs do executor', () => {
  it('preserva bytes, Unicode e executáveis sem reassociar o proprietário', async () => {
    const { root, source } = await fixture();
    const bytes = Buffer.from(Array.from({ length: 600_000 }, (_, index) => index % 256));
    await fs.mkdir(path.join(source, 'assets'));
    await fs.writeFile(path.join(source, 'assets', 'binário.dat'), bytes);
    await fs.writeFile(path.join(source, 'executable.sh'), '#!/bin/sh\nprintf transfer-ok', { mode: 0o755 });
    const destination = path.join(root, 'destination'); await fs.mkdir(destination, { mode: 0o700 });
    const uid = process.getuid!(), gid = process.getgid!();
    let transferred = 0;
    const execute: typeof processCommand = async (command, args, cwd, signal, input, timeout) => {
      if (command !== 'docker') return processCommand(command, args, cwd, signal, input, timeout);
      // Refuse daemon-side copies and privileged transfers, as the read-only
      // tmpfs destination does. Execute the streamed extraction for real.
      if (args[0] !== 'exec' || args.includes('--privileged') || args[args.indexOf('--user') + 1] !== '10001:10001') {
        return receipt(1, '', 'read-only rootfs: daemon-side copy refused');
      }
      expect(input).toBeInstanceOf(Buffer);
      const tarArgs = args.slice(args.indexOf('tar') + 1).map(argument => argument === '--directory=/workspace' ? `--directory=${destination}` : argument);
      const extracted = spawnSync('tar', tarArgs, { cwd, input, uid, gid, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
      if (extracted.error) throw extracted.error;
      transferred++;
      return receipt(extracted.status ?? 1, extracted.stdout, extracted.stderr);
    };
    await copyDevelopmentDirectory(source, '/workspace', 'test-container', root, new AbortController().signal, execute);
    expect(transferred).toBe(1);
    expect(await fs.readFile(path.join(destination, 'assets', 'binário.dat'))).toEqual(bytes);
    const executable = path.join(destination, 'executable.sh'), stat = await fs.stat(executable);
    expect(stat.mode & 0o777).toBe(0o755); expect(stat.uid).toBe(uid);
    expect(spawnSync(executable, [], { uid, gid, encoding: 'utf8' }).stdout).toBe('transfer-ok');
    expect(await fs.readFile(path.join(source, 'file.txt'), 'utf8')).toBe('source preserved');
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tar'))).toEqual([]);
  });

  it('registra a fase, destino e erro redigido e limpa o arquivo após falha', async () => {
    const { root, source } = await fixture();
    const execute: typeof processCommand = (command, args, cwd, signal, input, timeout) => command === 'docker'
      ? Promise.resolve(receipt(2, '', `tar: permission denied token=do-not-expose ${'x'.repeat(3000)}`))
      : processCommand(command, args, cwd, signal, input, timeout);
    const error = await copyDevelopmentDirectory(source, '/cache', 'test-container', root, new AbortController().signal, execute).catch(error => error);
    expect(error.code).toBe('sandbox_copy_failed'); expect(error.message).toContain('/cache');
    expect(error.message).toContain('exit 2'); expect(error.message).toContain('permission denied');
    expect(error.message).not.toContain('do-not-expose'); expect(error.message.length).toBeLessThan(1700);
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tar'))).toEqual([]);
  });

  it('respeita cancelamento entre preparação e transferência, preservando fonte', async () => {
    const { root, source } = await fixture(), controller = new AbortController();
    let transfers = 0;
    const execute: typeof processCommand = async (command, args, cwd, signal, input, timeout) => {
      if (command === 'docker') { transfers++; return receipt(0); }
      const result = await processCommand(command, args, cwd, signal, input, timeout);
      controller.abort(); return result;
    };
    await expect(copyDevelopmentDirectory(source, '/workspace', 'test-container', root, controller.signal, execute)).rejects.toMatchObject({ code: 'job_cancelled' });
    expect(transfers).toBe(0);
    expect(await fs.readFile(path.join(source, 'file.txt'), 'utf8')).toBe('source preserved');
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tar'))).toEqual([]);
  });

  it('mantém o diagnóstico da preparação quando a origem não existe', async () => {
    const { root } = await fixture();
    await expect(copyDevelopmentDirectory(path.join(root, 'missing'), '/workspace', 'test-container', root, new AbortController().signal))
      .rejects.toMatchObject({ code: 'sandbox_copy_failed', message: expect.stringContaining('preparar /workspace') });
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tar'))).toEqual([]);
  });
});
