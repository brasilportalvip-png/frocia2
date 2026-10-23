import { spawn } from 'node:child_process';

const MAX_OUTPUT = 2_000_000;

export async function run(command, args, cwd, timeoutMs, extraEnv = {}, isolated = false) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const minimalEnv = {
    PATH: process.env.PATH,
    HOME: cwd,
    CI: 'true',
    NODE_ENV: 'test',
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '/ms-playwright',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_registry: 'https://registry.npmjs.org',
    ...extraEnv,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env: minimalEnv, shell: false, windowsHide: true,
      ...(isolated && process.platform !== 'win32' ? { uid: 10001, gid: 10001 } : {}),
    });
    const stdout = []; const stderr = []; let bytes = 0; let killed = false;
    const collect = target => chunk => {
      bytes += chunk.length;
      if (bytes <= MAX_OUTPUT) target.push(Buffer.from(chunk));
      if (bytes > MAX_OUTPUT && !killed) { killed = true; child.kill('SIGKILL'); }
    };
    child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      const completed = Date.now();
      resolve({
        exitCode: killed ? 124 : code ?? 1, startedAt, completedAt: new Date(completed).toISOString(),
        durationMs: completed - started, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr),
      });
    });
  });
}
