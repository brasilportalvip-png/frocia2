import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DevelopmentError, LIMITS, type SourceFiles, safePath, secretPath, sourceManifest, writeArchive } from './archive.js';
import { fixedDownload } from './publicGithub.js';
import type { CommandReceipt, ValidationReceipt } from './agent.js';
import { RedactionService } from '../selfEvolution/redactionService.js';
import { resolveDependencyLock } from './dependencyLock.js';

const MAX_LOG = 2 * 1024 * 1024;
export async function processCommand(command: string, args: string[], cwd: string, signal?: AbortSignal, input?: string | Uint8Array, timeout: number = LIMITS.commandMs) {
  const started = Date.now(), startedAt = new Date().toISOString();
  return await new Promise<CommandReceipt>((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, detached: true, env: {
      PATH: process.env.PATH, CI: 'true', npm_config_audit: 'false', npm_config_fund: 'false', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      ...Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
        'npm_config_http_proxy', 'npm_config_https_proxy', 'NPM_CONFIG_HTTP_PROXY', 'NPM_CONFIG_HTTPS_PROXY', 'npm_config_proxy', 'NPM_CONFIG_PROXY', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_ENV_PROXY']
        .filter(name => process.env[name]).map(name => [name, process.env[name]])),
    } });
    let stdout = '', stderr = '', bytes = 0, limited = false;
    const terminate = () => { limited = true; try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } };
    const timer = setTimeout(terminate, timeout);
    signal?.addEventListener('abort', terminate, { once: true });
    if (signal?.aborted) terminate();
    const collect = (destination: 'out' | 'err') => (chunk: Buffer) => {
      bytes += chunk.length; if (bytes > MAX_LOG) return terminate();
      if (destination === 'out') stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout.on('data', collect('out')); child.stderr.on('data', collect('err'));
    child.stdin.on('error', () => {}); child.stdin.end(input || '');
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', terminate); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => { cleanup(); resolve({ command: `${command} ${args.join(' ')}`, exitCode: limited ? 124 : code ?? 1,
      startedAt, durationMs: Date.now() - started, stdoutSha256: createHash('sha256').update(stdout).digest('hex'),
      stderrSha256: createHash('sha256').update(stderr).digest('hex'), stdout, stderr }); });
  });
}
export async function copyDevelopmentDirectory(directory: string, destination: '/workspace' | '/cache', container: string,
  temporary: string, signal: AbortSignal, execute: typeof processCommand = processCommand) {
  const archive = path.join(temporary, `transfer-${randomUUID()}.tar`);
  const failed = (phase: string, result: CommandReceipt) => {
    const detail = RedactionService.redactSensitiveData(result.stderr || result.stdout).trim().slice(0, 1500);
    return new DevelopmentError('sandbox_copy_failed', `Falha ao ${phase} ${destination} (exit ${result.exitCode}).${detail ? ` ${detail}` : ''}`);
  };
  try {
    if (signal.aborted) throw new DevelopmentError('job_cancelled', 'Execução cancelada.');
    const packed = await execute('tar', ['--format=posix', '--numeric-owner', '--owner=10001', '--group=10001', '-C', directory, '-cf', archive, '.'], temporary, signal);
    if (packed.exitCode !== 0) throw failed('preparar', packed);
    if (signal.aborted) throw new DevelopmentError('job_cancelled', 'Execução cancelada.');
    // docker cp cannot reliably access tmpfs mounts. Extract inside the running
    // container, as the project user, without daemon-side chown or rootfs writes.
    const copied = await execute('docker', ['exec', '-i', '--user', '10001:10001', container,
      'tar', '--extract', '--file=-', `--directory=${destination}`, '--no-same-owner', '--same-permissions'],
    temporary, signal, await fs.readFile(archive));
    if (copied.exitCode !== 0) throw failed('transferir para', copied);
  } finally {
    await fs.rm(archive, { force: true });
  }
}
async function materialize(root: string, files: SourceFiles) {
  for (const [name, file] of files) {
    const destination = path.join(root, safePath(name)); await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.bytes, { mode: file.mode });
  }
}
export async function cacheDependencies(files: SourceFiles, temporary: string, signal: AbortSignal, progress?: (message: string) => void) {
  const cache = path.join(temporary, 'npm-cache'); await fs.mkdir(cache);
  progress?.('Resolvendo metadados npm ausentes, sem alterar as versões do projeto.');
  const prepared = await resolveDependencyLock(files, signal), resolved = prepared.tarballs;
  progress?.(`Preparando ${resolved.size} tarballs oficiais para instalação offline; ${prepared.evidence.hydrated.length} entradas suplementadas.`);
  let total = 0, index = 0, completed = 0, failure: unknown;
  const entries = [...resolved];
  // Only this downloader has egress; it receives neither project scripts nor provider credentials.
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (index < entries.length && !failure) {
      const current = index++, [url, expected] = entries[current], tarball = path.join(temporary, `dependency-${current}.tgz`);
      try {
        if (signal.aborted) throw new DevelopmentError('job_cancelled', 'Execução cancelada.');
        const bytes = await fixedDownload(new URL(url), new Set(['registry.npmjs.org']), 30 * 1024 * 1024, 30_000);
        total += bytes.length; if (total > 300 * 1024 * 1024) throw new DevelopmentError('dependency_cache_limit', 'Cache de dependências excedeu 300 MiB.');
        if (createHash('sha512').update(bytes).digest('base64') !== expected) throw new DevelopmentError('dependency_integrity_mismatch', 'Tarball npm diverge do lockfile.');
        await fs.writeFile(tarball, bytes);
        const cached = await processCommand('npm', ['cache', 'add', tarball, '--ignore-scripts', '--offline', '--cache', cache, '--userconfig', '/dev/null'], temporary, signal);
        if (cached.exitCode !== 0) throw new DevelopmentError('dependency_cache_failed', 'Não foi possível preparar o cache offline.');
        completed++; if (completed % 25 === 0 || completed === resolved.size) progress?.(`Cache offline verificado: ${completed}/${resolved.size}.`);
      } catch (error) { failure ||= error; }
      finally { await fs.rm(tarball, { force: true }); }
    }
  }));
  if (failure) throw failure;
  return { cache, ...prepared };
}

export class DockerProjectSandbox {
  static async available() {
    try { return (await processCommand('docker', ['version', '--format', '{{.Server.Version}}'], os.tmpdir(), undefined, undefined, 10_000)).exitCode === 0; }
    catch { return false; }
  }
  constructor(private signal: AbortSignal, private image = process.env.DEVELOPMENT_SANDBOX_IMAGE || 'frocia-development:local',
    private observe: { command?: (receipt: CommandReceipt) => Promise<void>; progress?: (message: string) => void } = {}) {}
  async validate(files: SourceFiles): Promise<ValidationReceipt> {
    if (!await DockerProjectSandbox.available()) throw new DevelopmentError('isolated_executor_unavailable', 'Docker isolado indisponível. Nenhum código do projeto foi executado no servidor principal.', 503);
    if (this.signal.aborted) throw new DevelopmentError('job_cancelled', 'Execução cancelada.');
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'froc-development-')), name = `froc-dev-${randomUUID()}`;
    const source = path.join(temporary, 'source'); await fs.mkdir(source);
    const commands: CommandReceipt[] = [];
    const checked = async (args: string[], input?: string | Uint8Array) => {
      const result = await processCommand('docker', args, temporary, this.signal, input);
      if (result.exitCode !== 0) throw new DevelopmentError('sandbox_operation_failed', 'A operação de isolamento falhou. O projeto foi preservado.');
      return result;
    };
    try {
      const executableFiles = new Map([...files].filter(([name]) => !secretPath(name)));
      await materialize(source, executableFiles);
      const pkg = files.has('package.json') ? JSON.parse(Buffer.from(files.get('package.json')!.bytes).toString()) : null;
      if (pkg && !['typecheck', 'test', 'build'].every(script => typeof pkg.scripts?.[script] === 'string')) throw new DevelopmentError('validation_scripts_missing', 'Faltam scripts originais typecheck, test ou build. Não foi inventada uma validação equivalente.');
      const dependencies = pkg ? await cacheDependencies(files, temporary, this.signal, this.observe.progress) : null;
      await checked(['create', '--name', name, '--network', 'none', '--read-only', '--cpus', '1', '--memory', '2g', '--memory-swap', '2g',
        '--pids-limit', '256', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '10001:10001',
        '--ulimit', 'nofile=1024:1024', '--ulimit', 'core=0',
        '--tmpfs', '/workspace:rw,exec,nosuid,nodev,size=1g,uid=10001,gid=10001,mode=0700',
        '--tmpfs', '/cache:rw,noexec,nosuid,nodev,size=384m,uid=10001,gid=10001,mode=0700',
        '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=256m,uid=10001,gid=10001,mode=1777',
        '-e', 'CI=true', '-e', 'npm_config_offline=true', '-e', 'npm_config_audit=false', '-e', 'npm_config_fund=false',
        '-e', 'npm_config_cache=/cache', '-e', 'NODE_OPTIONS=--max-old-space-size=768', this.image]);
      const inspected = JSON.parse((await checked(['inspect', name])).stdout)[0];
      const host = inspected.HostConfig;
      if (host.NetworkMode !== 'none' || !host.ReadonlyRootfs || host.Privileged || host.Memory !== 2 * 1024 ** 3 ||
          host.NanoCpus !== 1e9 || host.PidsLimit !== 256 || !host.CapDrop?.includes('ALL') || host.Binds?.length ||
          !host.SecurityOpt?.some((p: string) => p.startsWith('no-new-privileges')) || inspected.Config.User !== '10001:10001') {
        throw new DevelopmentError('sandbox_isolation_not_confirmed', 'As restrições efetivas do container não foram confirmadas.');
      }
      await checked(['start', name]);
      await copyDevelopmentDirectory(source, '/workspace', name, temporary, this.signal);
      if (dependencies) await copyDevelopmentDirectory(dependencies.cache, '/cache', name, temporary, this.signal);
      const original = [...executableFiles.keys()];
      if (pkg) for (const args of [['ci'], ['run', 'typecheck'], ['test'], ['run', 'build']]) {
        const supplemented = args[0] === 'ci' && !!dependencies?.evidence.hydrated.length;
        const writeLock = (bytes: Uint8Array) => checked(['exec', '-i', '--user', '10001:10001', name, 'node', '-e',
          "require('node:fs').writeFileSync('/workspace/package-lock.json',require('node:fs').readFileSync(0))"], bytes);
        let result: CommandReceipt;
        try {
          if (supplemented) await writeLock(dependencies!.installLockfile);
          result = await processCommand('docker', ['exec', '--user', '10001:10001', '-w', '/workspace', name, 'npm', ...args], temporary, this.signal);
        } finally {
          if (supplemented && !this.signal.aborted) await writeLock(files.get('package-lock.json')!.bytes);
        }
        commands.push({ ...result!, command: `npm ${args.join(' ')}` });
        await this.observe.command?.(commands.at(-1)!);
        if (result!.exitCode !== 0) break;
      }
      else commands.push({ command: 'static-source-integrity', exitCode: files.has('index.html') ? 0 : 1, startedAt: new Date().toISOString(), durationMs: 0,
        stdout: 'Projeto estático: nenhum script npm declarado.', stderr: '', stdoutSha256: createHash('sha256').update('static-source-integrity').digest('hex'), stderrSha256: createHash('sha256').update('').digest('hex') });
      const manifest = JSON.parse((await checked(['exec', '-i', name, 'node', '/opt/froc/development-files.mjs'], JSON.stringify({ op: 'manifest', original }))).stdout);
      const expected = sourceManifest(executableFiles);
      if (manifest.files.length !== expected.files.length || manifest.files.some((item: any) => !expected.files.some(e => e.path === item.path && e.sha256 === item.sha256))) {
        throw new DevelopmentError('unreported_source_changes', 'Um comando alterou arquivos-fonte fora dos diffs do agente. A entrega foi bloqueada.');
      }
      let preview: Uint8Array | undefined;
      if (commands.every(c => c.exitCode === 0)) {
        const previewFiles: SourceFiles = new Map();
        if (pkg) {
          const listed = await processCommand('docker', ['exec', '-i', name, 'node', '/opt/froc/development-files.mjs'], temporary, this.signal,
            JSON.stringify({ op: 'manifest', directory: 'dist', original: ['dist/'] }));
          if (listed.exitCode === 0) {
            for (const file of JSON.parse(listed.stdout).files) {
              const parts: Buffer[] = [];
              for (let offset = 0; offset < Math.max(1, file.size); offset += 384 * 1024) {
                const part = JSON.parse((await checked(['exec', '-i', name, 'node', '/opt/froc/development-files.mjs'], JSON.stringify({ op: 'read', path: file.path, offset }))).stdout);
                if (part.sha256 !== file.sha256) throw new DevelopmentError('preview_changed', 'A prévia mudou durante a captura.'); parts.push(Buffer.from(part.data, 'base64'));
              }
              previewFiles.set(file.path.slice(5), { bytes: Buffer.concat(parts), mode: 0o644 });
            }
          }
        } else for (const [name, file] of files) if (!/^(?:server|api|\.env)/.test(name)) previewFiles.set(name, file);
        if (previewFiles.has('index.html')) preview = writeArchive(previewFiles);
      }
      return { commands, sourceDigest: sourceManifest(files).digest, preview, isolation: { engine: 'docker', projectSecretFilesMounted: false, network: host.NetworkMode, readOnlyRoot: host.ReadonlyRootfs,
        user: inspected.Config.User, memoryBytes: host.Memory, nanoCpus: host.NanoCpus, pidsLimit: host.PidsLimit, capabilitiesDropped: host.CapDrop,
        ...(dependencies ? { dependencyLock: dependencies.evidence } : {}) } };
    } finally {
      await processCommand('docker', ['rm', '--force', name], temporary, undefined, undefined, 15_000).catch(() => {});
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}
