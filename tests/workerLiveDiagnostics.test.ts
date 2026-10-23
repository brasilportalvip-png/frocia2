import { spawn, type SpawnSyncReturns } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordWorkerDiagnostics } from '../scripts/self-evolution-worker-diagnostics.mjs';

function dockerResult(stdout = '', status: number | null = 0): SpawnSyncReturns<string> {
  return { pid: 0, output: [null, stdout, ''], stdout, stderr: '', status, signal: null };
}

describe('Diagnosticos do worker durante o ciclo', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('registra etapas e recursos sem imprimir ambiente ou credenciais do container', () => {
    vi.stubEnv('SELF_EVOLUTION_WORKER_TOKEN', 'token-privado-do-worker');
    const calls: string[][] = [];
    const messages: string[] = [];
    recordWorkerDiagnostics({ resources: true,
      readHostResources: () => ({ memoryAvailableMiB: 8000, memoryTotalMiB: 16000,
        load1m: 0.5, diskAvailableMiB: 9000 }),
      log: (...args: unknown[]) => messages.push(args.join(' ')),
      runDocker: (args: string[]) => {
        calls.push(args);
        const stdout = args[0] === 'inspect'
          ? JSON.stringify({ Status: 'running', Running: true, OOMKilled: false, ExitCode: 0,
            Error: 'token-privado-do-worker', Config: { Env: ['OUTRO_SEGREDO=nao-imprimir'] } })
          : args[0] === 'stats' ? JSON.stringify({ CPUPerc: '43%', MemUsage: '1GiB / 4GiB', PIDs: '25',
            Env: 'nao-imprimir' })
          : '2026-10-23T20:00:00Z [worker:patch] {"stage":"generation"} token-privado-do-worker';
        return dockerResult(stdout);
      },
    });
    const output = messages.join('\n');
    expect(output).toContain('generation');
    expect(output).toContain('"cpu":"43%"');
    expect(output).toContain('"oomKilled":false');
    expect(output).toContain('memoryAvailableMiB');
    expect(output).toContain('[REDACTED_SECRET]');
    expect(output).not.toMatch(/token-privado-do-worker|nao-imprimir|Config|OUTRO_SEGREDO/);
    expect(calls[0]).toEqual(['inspect', '--format', '{{json .State}}', 'frocia-worker']);
  });

  it('conserva as etapas novas sem repetir as linhas coletadas anteriormente', () => {
    const seen = new Set<string>();
    const messages: string[] = [];
    let last = '[worker:patch] {"stage":"generation"}';
    const runDocker = (args: string[]) => dockerResult(args[0] === 'inspect' ? '{"Status":"running"}' : last);
    const log = (...args: unknown[]) => messages.push(args.join(' '));
    recordWorkerDiagnostics({ runDocker, log, seen });
    last += '\n[worker:command] {"id":"typecheck","event":"start"}';
    recordWorkerDiagnostics({ runDocker, log, seen });
    const output = messages.join('\n');
    expect(output.match(/generation/g)).toHaveLength(1);
    expect(output).toContain('typecheck');
  });

  it('continua sem derrubar o ciclo quando o container esta indisponivel', () => {
    const messages: string[] = [];
    expect(() => recordWorkerDiagnostics({ resources: true,
      log: (...args: unknown[]) => messages.push(args.join(' ')),
      runDocker: () => ({ ...dockerResult('', null), error: new Error('docker indisponivel') }),
      readHostResources: () => { throw new Error('disco indisponivel'); },
    })).not.toThrow();
    expect(messages.join('\n')).toContain('Container indisponivel');
  });

  it.skipIf(process.platform === 'win32')('publica progresso antes do fim e encerra o monitor com SIGTERM', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'froc-monitor-test-'));
    const bin = path.join(temp, 'bin');
    await mkdir(bin);
    const docker = path.join(bin, 'docker');
    await writeFile(docker, `#!/usr/bin/env node
const command = process.argv[2];
if (command === 'inspect') console.log(JSON.stringify({ Status: 'running', Running: true, OOMKilled: false, ExitCode: 0 }));
else if (command === 'stats') console.log(JSON.stringify({ CPUPerc: '1%', MemUsage: '10MiB / 4GiB', PIDs: '1' }));
else console.log('2026-10-23T20:00:00Z [worker:patch] {"stage":"generation"} ' + process.env.MONITOR_TEST_SECRET);
`);
    await chmod(docker, 0o700);
    const child = spawn(process.execPath, ['scripts/self-evolution-worker-diagnostics.mjs', '--watch'], {
      cwd: process.cwd(), env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
        MONITOR_TEST_SECRET: 'segredo-de-teste-nao-publicar' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('progresso nao registrado')), 5000);
        child.stdout.on('data', data => {
          output += data.toString();
          if (output.includes('generation')) { clearTimeout(timer); resolve(); }
        });
      });
      expect(child.exitCode).toBeNull();
      expect(output).toContain('Amostra do executor:');
      expect(output).toContain('Worker:');
      expect(output).toContain('[REDACTED_SECRET]');
      expect(output).not.toContain('segredo-de-teste-nao-publicar');
      child.kill('SIGTERM');
      expect(await exited).toEqual({ code: 0, signal: null });
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await exited.catch(() => {});
      await rm(temp, { recursive: true, force: true });
    }
  }, 10_000);
});
