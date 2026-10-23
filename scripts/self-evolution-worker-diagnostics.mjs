import { spawnSync } from 'node:child_process';
import { safeDiagnosticText } from '../worker/worker-failure.mjs';

// Nao imprime Config.Env nem argumentos de processos. Os logs passam pela
// mesma remocao de segredos usada nos diagnosticos assinados do worker.
function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 512_000 });
}
const inspected = docker(['inspect', '--format', '{{json .State}}', 'frocia-worker']);
if (inspected.status !== 0) {
  console.log('[worker-diagnostics] Container indisponivel para inspecao.');
} else {
  try {
    const state = JSON.parse(inspected.stdout);
    console.log('[worker-diagnostics] Estado:', JSON.stringify({
      status: state.Status, running: state.Running, oomKilled: state.OOMKilled,
      exitCode: state.ExitCode, error: safeDiagnosticText(state.Error, 500),
    }));
  } catch { console.log('[worker-diagnostics] Estado do container nao pode ser interpretado.'); }
  const logs = docker(['logs', '--tail', '100', '--timestamps', 'frocia-worker']);
  const lines = `${logs.stdout || ''}\n${logs.stderr || ''}`.split(/\r?\n/).filter(Boolean).slice(-100);
  for (const line of lines) console.log('[worker-diagnostics]', safeDiagnosticText(line));
}
