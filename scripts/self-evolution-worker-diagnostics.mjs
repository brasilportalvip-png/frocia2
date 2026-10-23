import { spawnSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { safeDiagnosticText } from '../worker/worker-failure.mjs';

// Nao imprime Config.Env nem argumentos de processos. Os logs passam pela
// mesma remocao de segredos usada nos diagnosticos assinados do worker.
function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 512_000 });
}

function hostResources() {
  const disk = statfsSync(process.cwd());
  return { memoryAvailableMiB: Math.round(os.freemem() / 1024 ** 2),
    memoryTotalMiB: Math.round(os.totalmem() / 1024 ** 2), load1m: os.loadavg()[0],
    diskAvailableMiB: Math.round(disk.bavail * disk.bsize / 1024 ** 2) };
}

export function recordWorkerDiagnostics({ runDocker = docker, log = console.log, seen = null,
  resources = false, readHostResources = hostResources } = {}) {
  const emit = (...parts) => log('[worker-diagnostics]', ...parts);
  if (resources) {
    emit('Amostra do executor:', new Date().toISOString());
    try { emit('Executor:', JSON.stringify(readHostResources())); }
    catch { emit('Recursos do executor indisponiveis.'); }
  }
  const inspected = runDocker(['inspect', '--format', '{{json .State}}', 'frocia-worker']);
  if (inspected.status !== 0) {
    emit('Container indisponivel para inspecao.');
    return;
  }
  try {
    const state = JSON.parse(inspected.stdout);
    emit('Estado:', JSON.stringify({
      status: state.Status, running: state.Running, oomKilled: state.OOMKilled,
      exitCode: state.ExitCode, error: safeDiagnosticText(state.Error, 500),
    }));
  } catch { emit('Estado do container nao pode ser interpretado.'); }
  if (resources) {
    const stats = runDocker(['stats', '--no-stream', '--format', '{{json .}}', 'frocia-worker']);
    if (stats.status === 0) {
      try {
        const data = JSON.parse(stats.stdout.trim());
        emit('Worker:', JSON.stringify({ cpu: safeDiagnosticText(data.CPUPerc, 50),
          memory: safeDiagnosticText(data.MemUsage, 100), pids: safeDiagnosticText(data.PIDs, 30) }));
      } catch { emit('Recursos do worker indisponiveis.'); }
    } else emit('Recursos do worker indisponiveis.');
  }
  const logs = runDocker(['logs', '--tail', '100', '--timestamps', 'frocia-worker']);
  const lines = `${logs.stdout || ''}\n${logs.stderr || ''}`.split(/\r?\n/).filter(Boolean).slice(-100);
  for (const line of lines) {
    if (seen?.has(line)) continue;
    emit(safeDiagnosticText(line));
    if (seen) {
      seen.add(line);
      if (seen.size > 300) seen.delete(seen.values().next().value);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const watch = process.argv.includes('--watch');
  const seen = watch ? new Set() : null;
  const snapshot = () => {
    try { recordWorkerDiagnostics({ resources: watch, seen }); }
    catch { console.log('[worker-diagnostics] Nao foi possivel coletar esta amostra.'); }
  };
  if (watch) {
    const timer = setInterval(snapshot, 30_000);
    const stop = () => clearInterval(timer);
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  }
  snapshot();
}
