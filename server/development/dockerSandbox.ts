import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DevelopmentError, LIMITS, type SourceFiles, safePath, secretPath, sourceManifest, writeArchive } from './archive.js';
import { fixedDownload } from './publicGithub.js';
import type { CommandReceipt, ValidationReceipt } from './agent.js';

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
async function materialize(root: string, files: SourceFiles) {
  for (const [name, file] of files) {
    const destination = path.join(root, safePath(name)); await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.bytes, { mode: file.mode });
  }
}
async function cacheDependencies(files: SourceFiles, temporary: string, signal: AbortSignal) {
  const cache = path.join(temporary, 'npm-cache'); await fs.mkdir(cache);
  const lockFile = files.get('package-lock.json'); if (!lockFile) throw new DevelopmentError('lockfile_required', 'O projeto npm precisa do lockfile original para instalação reproduzível.');
  const lock = JSON.parse(Buffer.from(lockFile.bytes).toString()), packages = Object.values(lock.packages || {}) as any[];
  if (![2, 3].includes(lock.lockfileVersion) || !packages.length) throw new DevelopmentError('lockfile_unsupported', 'O executor aceita package-lock versões 2 e 3. O arquivo original foi preservado.');
  const resolved = new Map<string, string>();
  for (const item of packages) if (item.resolved && !item.link) {
    const url = new URL(item.resolved);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.search || url.hash || url.username || url.password || url.port || !/\/-\/[^/]+\.tgz$/.test(url.pathname)) {
      throw new DevelopmentError('dependency_registry_denied', 'Dependências privadas, git ou fora do npm oficial exigem um adaptador autorizado. Nenhuma credencial foi solicitada.');
    }
    const integrity = String(item.integrity || '').split(/\s+/).find(i => /^sha512-[A-Za-z0-9+/]+=*$/.test(i));
    if (!integrity) throw new DevelopmentError('dependency_integrity_missing', 'Uma dependência não possui integridade SHA-512 no lockfile.');
    resolved.set(url.href, integrity.slice(7));
  }
  let total = 0, index = 0;
  // Only this downloader has egress; it receives neither project scripts nor provider credentials.
  for (const [url, expected] of resolved) {
    if (signal.aborted) throw new DevelopmentError('job_cancelled', 'Execução cancelada.');
    const bytes = await fixedDownload(new URL(url), new Set(['registry.npmjs.org']), 30 * 1024 * 1024, 30_000);
    total += bytes.length; if (total > 300 * 1024 * 1024) throw new DevelopmentError('dependency_cache_limit', 'Cache de dependências excedeu 300 MiB.');
    if (createHash('sha512').update(bytes).digest('base64') !== expected) throw new DevelopmentError('dependency_integrity_mismatch', 'Tarball npm diverge do lockfile.');
    const tarball = path.join(temporary, `dependency-${index++}.tgz`); await fs.writeFile(tarball, bytes);
    const cached = await processCommand('npm', ['cache', 'add', tarball, '--ignore-scripts', '--offline', '--cache', cache, '--userconfig', '/dev/null'], temporary, signal);
    await fs.rm(tarball);
    if (cached.exitCode !== 0) throw new DevelopmentError('dependency_cache_failed', 'Não foi possível preparar o cache offline.');
  }
  return cache;
}

export class DockerProjectSandbox {
  static async available() {
    try { return (await processCommand('docker', ['version', '--format', '{{.Server.Version}}'], os.tmpdir(), undefined, undefined, 10_000)).exitCode === 0; }
    catch { return false; }
  }
  constructor(private signal: AbortSignal, private image = process.env.DEVELOPMENT_SANDBOX_IMAGE || 'frocia-development:local') {}
  async validate(files: SourceFiles): Promise<ValidationReceipt> {
    if (!await DockerProjectSandbox.available()) throw new DevelopmentError('isolated_executor_unavailable', 'Docker isolado indisponível. Nenhum código do projeto foi executado no servidor principal.', 503);
    if (this.signal.aborted) throw new DevelopmentError('job_cancelled', 'Execução cancelada.');
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'froc-development-')), name = `froc-dev-${randomUUID()}`;
    const source = path.join(temporary, 'source'); await fs.mkdir(source);
    const commands: CommandReceipt[] = [];
    const checked = async (args: string[], input?: string) => {
      const result = await processCommand('docker', args, temporary, this.signal, input);
      if (result.exitCode !== 0) throw new DevelopmentError('sandbox_operation_failed', 'A operação de isolamento falhou. O projeto foi preservado.');
      return result;
    };
    try {
      const executableFiles = new Map([...files].filter(([name]) => !secretPath(name)));
      await materialize(source, executableFiles);
      const pkg = files.has('package.json') ? JSON.parse(Buffer.from(files.get('package.json')!.bytes).toString()) : null;
      if (pkg && !['typecheck', 'test', 'build'].every(script => typeof pkg.scripts?.[script] === 'string')) throw new DevelopmentError('validation_scripts_missing', 'Faltam scripts originais typecheck, test ou build. Não foi inventada uma validação equivalente.');
      const cache = pkg ? await cacheDependencies(files, temporary, this.signal) : null;
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
      const copyOwned = async (directory: string, destination: string) => {
        const tar = path.join(temporary, destination.slice(1) + '.tar');
        const packed = await processCommand('tar', ['--format=posix', '--numeric-owner', '--owner=10001', '--group=10001', '-C', directory, '-cf', tar, '.'], temporary, this.signal);
        if (packed.exitCode !== 0) throw new DevelopmentError('sandbox_copy_failed', 'Não foi possível preparar os arquivos isolados.');
        const copied = await processCommand('docker', ['cp', '--archive', '-', name + ':' + destination + '/'], temporary, this.signal, await fs.readFile(tar));
        await fs.rm(tar);
        if (copied.exitCode !== 0) throw new DevelopmentError('sandbox_copy_failed', 'Não foi possível transferir os arquivos ao container.');
      };
      await copyOwned(source, '/workspace');
      if (cache) await copyOwned(cache, '/cache');
      const original = [...executableFiles.keys()];
      if (pkg) for (const args of [['ci'], ['run', 'typecheck'], ['test'], ['run', 'build']]) {
        const result = await processCommand('docker', ['exec', '--user', '10001:10001', '-w', '/workspace', name, 'npm', ...args], temporary, this.signal);
        commands.push({ ...result, command: `npm ${args.join(' ')}` });
        if (result.exitCode !== 0) break;
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
        user: inspected.Config.User, memoryBytes: host.Memory, nanoCpus: host.NanoCpus, pidsLimit: host.PidsLimit, capabilitiesDropped: host.CapDrop } };
    } finally {
      await processCommand('docker', ['rm', '--force', name], temporary, undefined, undefined, 15_000).catch(() => {});
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}
