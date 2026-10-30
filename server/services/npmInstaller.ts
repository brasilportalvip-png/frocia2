import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Instala, sob demanda, os pacotes npm que um projeto usa, a partir do
 * package-lock.json do próprio projeto (como `npm ci --ignore-scripts`, mas só
 * do que o código realmente importa). Os arquivos vão para uma pasta temporária
 * e o esbuild resolve tudo nativamente (exports, browser, module...).
 *
 * Só baixa de registry.npmjs.org, confere o hash (integrity) quando existe e
 * nunca executa scripts de instalação.
 */

export interface LockEntry {
  name?: string;
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  os?: string[];
  cpu?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export type LockPackages = Record<string, LockEntry>;

const REGISTRY_HOST = 'registry.npmjs.org';
const MAX_TARBALL_BYTES = 80_000_000;
const MAX_UNPACKED_TOTAL_BYTES = 600_000_000;
const MAX_PACKAGES = 3_000;
const FETCH_TIMEOUT_MS = 60_000;
const FETCH_RETRIES = 2;
const DOWNLOAD_CONCURRENCY = 12;
const WRITE_CONCURRENCY = 64;

export function parseLock(text: string): LockPackages | null {
  try {
    const parsed = JSON.parse(text) as { lockfileVersion?: number; packages?: LockPackages };
    if (!parsed || typeof parsed !== 'object' || !parsed.packages) return null;
    if ((parsed.lockfileVersion ?? 0) < 2) return null;
    return parsed.packages;
  } catch {
    return null;
  }
}

function matchesList(list: string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return true;
  const negated = list.filter((item) => item.startsWith('!'));
  if (negated.length) return !negated.some((item) => item.slice(1) === value);
  return list.includes(value);
}

export function isCompatiblePlatform(entry: LockEntry, platform = process.platform, arch = process.arch): boolean {
  return matchesList(entry.os, platform) && matchesList(entry.cpu, arch);
}

function nameFromKey(key: string): string {
  const index = key.lastIndexOf('node_modules/');
  return index >= 0 ? key.slice(index + 'node_modules/'.length) : key;
}

export function tarballUrl(key: string, entry: LockEntry): string | null {
  if (entry.resolved) {
    try {
      const url = new URL(entry.resolved);
      if (url.protocol === 'https:' && url.hostname === REGISTRY_HOST) return url.href;
    } catch {
      /* cai para a URL montada */
    }
    return null; // git, outros registries ou arquivos locais não são baixados
  }
  if (!entry.version) return null;
  const name = entry.name || nameFromKey(key);
  const base = name.split('/').pop()!;
  return `https://${REGISTRY_HOST}/${name}/-/${base}-${entry.version}.tgz`;
}

/** Acha a entrada do lock que `from` enxerga como `dep` (algoritmo de resolução do Node). */
export function resolveDependencyKey(lock: LockPackages, fromKey: string, dep: string): string | null {
  let scope = fromKey;
  for (;;) {
    const candidate = scope ? `${scope}/node_modules/${dep}` : `node_modules/${dep}`;
    if (lock[candidate]) return candidate;
    if (!scope) return null;
    const cut = scope.lastIndexOf('/node_modules/');
    scope = cut >= 0 ? scope.slice(0, cut) : scope.startsWith('node_modules/') ? '' : '';
  }
}

/** Todas as entradas necessárias para `startKey` funcionar (dependências, opcionais e peers presentes). */
export function dependencyClosure(lock: LockPackages, startKey: string): string[] {
  const seen = new Set<string>();
  const stack = [startKey];
  while (stack.length) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    const entry = lock[key];
    if (!entry || entry.link || !isCompatiblePlatform(entry)) continue;
    seen.add(key);
    const deps = { ...(entry.peerDependencies || {}), ...(entry.optionalDependencies || {}), ...(entry.dependencies || {}) };
    for (const dep of Object.keys(deps)) {
      const resolved = resolveDependencyKey(lock, key, dep);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return [...seen];
}

function readOctal(bytes: Uint8Array, start: number, length: number): number {
  let text = '';
  for (let i = start; i < start + length && bytes[i] !== 0; i += 1) text += String.fromCharCode(bytes[i]);
  return Number.parseInt(text.trim() || '0', 8) || 0;
}

function readString(bytes: Uint8Array, start: number, length: number): string {
  let end = start;
  while (end < start + length && bytes[end] !== 0) end += 1;
  return new TextDecoder().decode(bytes.subarray(start, end));
}

export interface TarFile {
  path: string;
  data: Uint8Array;
}

/** Lê um .tar (já descompactado). Remove a primeira pasta ("package/") e recusa caminhos perigosos. */
export function parseTar(bytes: Uint8Array): TarFile[] {
  const files: TarFile[] = [];
  let offset = 0;
  let overridePath: string | null = null;
  while (offset + 512 <= bytes.length) {
    if (bytes[offset] === 0 && bytes[offset + 1] === 0) break;
    const name = readString(bytes, offset, 100);
    const size = readOctal(bytes, offset + 124, 12);
    const type = String.fromCharCode(bytes[offset + 156] || 48);
    const prefix = readString(bytes, offset + 345, 155);
    const dataStart = offset + 512;
    const data = bytes.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      const text = new TextDecoder().decode(data);
      const match = text.match(/\d+ path=([^\n]+)\n/);
      if (match) overridePath = match[1];
      continue;
    }
    if (type === 'L') {
      overridePath = new TextDecoder().decode(data).replace(/\0+$/, '');
      continue;
    }
    if (type === 'g') continue;
    const fullName = overridePath ?? (prefix ? `${prefix}/${name}` : name);
    overridePath = null;
    if (type !== '0' && type !== '\0') continue;

    const parts = fullName.replace(/\\/g, '/').split('/').filter(Boolean);
    parts.shift(); // "package/"
    if (parts.length === 0 || parts.some((part) => part === '..' || part === '.')) continue;
    files.push({ path: parts.join('/'), data });
  }
  return files;
}

function verifyIntegrity(buffer: Uint8Array, integrity: string | undefined): boolean {
  if (!integrity) return true;
  for (const token of integrity.split(/\s+/)) {
    const [algorithm, expected] = token.split('-', 2);
    if (!['sha512', 'sha384', 'sha256', 'sha1'].includes(algorithm) || !expected) continue;
    const digest = createHash(algorithm).update(buffer).digest('base64');
    return digest === integrity.split(/\s+/).find((t) => t.startsWith(`${algorithm}-`))!.slice(algorithm.length + 1);
  }
  return true;
}

async function defaultFetchBuffer(url: string): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== REGISTRY_HOST) {
    throw new Error(`Host não permitido para pacotes: ${parsed.hostname}`);
  }
  let lastError = '';
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (new URL(response.url || url).hostname !== REGISTRY_HOST) throw new Error('Redirecionamento bloqueado');
      if (!response.ok) {
        lastError = `npm respondeu ${response.status} para ${url}`;
        if (response.status < 500 && response.status !== 429) throw new Error(lastError);
      } else {
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.length > MAX_TARBALL_BYTES) throw new Error(`Pacote grande demais: ${url}`);
        return buffer;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (/^npm respondeu 4\d\d/.test(lastError) && !lastError.includes(' 429 ')) throw error;
      if (/Redirecionamento bloqueado|Pacote grande demais/.test(lastError)) throw error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < FETCH_RETRIES) await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  throw new Error(lastError || `Falha ao baixar ${url}`);
}

export interface NpmInstallerOptions {
  /** Injetável para testes. */
  fetchBuffer?: (url: string) => Promise<Uint8Array>;
  /** Pasta de instalação (padrão: pasta temporária própria). */
  dir?: string;
}

export class NpmInstaller {
  readonly lock: LockPackages;
  private readonly fetchBuffer: (url: string) => Promise<Uint8Array>;
  private dirPromise: Promise<string>;
  private installed = new Set<string>();
  private pending = new Map<string, Promise<boolean>>();
  private unpackedBytes = 0;
  readonly failures = new Map<string, string>();

  constructor(lock: LockPackages, options: NpmInstallerOptions = {}) {
    this.lock = lock;
    this.fetchBuffer = options.fetchBuffer ?? defaultFetchBuffer;
    this.dirPromise = options.dir ? Promise.resolve(options.dir) : mkdtemp(path.join(tmpdir(), 'froc-npm-'));
  }

  get installedCount(): number {
    return this.installed.size;
  }

  getDir(): Promise<string> {
    return this.dirPromise;
  }

  /** O lock conhece esse pacote? */
  has(packageName: string): boolean {
    const entry = this.lock[`node_modules/${packageName}`];
    return Boolean(entry && !entry.link);
  }

  /** Garante que o pacote e tudo de que ele depende estão em disco. */
  ensure(packageName: string): Promise<boolean> {
    let promise = this.pending.get(packageName);
    if (!promise) {
      promise = this.install(`node_modules/${packageName}`).catch((error) => {
        this.failures.set(packageName, error instanceof Error ? error.message : String(error));
        return false;
      });
      this.pending.set(packageName, promise);
    }
    return promise;
  }

  private async install(startKey: string): Promise<boolean> {
    const keys = dependencyClosure(this.lock, startKey).filter((key) => !this.installed.has(key));
    if (this.installed.size + keys.length > MAX_PACKAGES) throw new Error('Pacotes demais para instalar.');
    const dir = await this.dirPromise;
    let cursor = 0;
    const worker = async () => {
      while (cursor < keys.length) {
        const key = keys[cursor++];
        if (this.installed.has(key)) continue;
        await this.installOne(dir, key);
      }
    };
    await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, keys.length) }, worker));
    return this.installed.has(startKey);
  }

  private async installOne(dir: string, key: string): Promise<void> {
    const entry = this.lock[key];
    const url = tarballUrl(key, entry);
    if (!url) throw new Error(`Pacote sem origem permitida: ${key}`);
    const compressed = await this.fetchBuffer(url);
    if (!verifyIntegrity(compressed, entry.integrity)) throw new Error(`Hash (integrity) não confere: ${key}`);
    const files = parseTar(gunzipSync(compressed));
    const size = files.reduce((sum, file) => sum + file.data.length, 0);
    this.unpackedBytes += size;
    if (this.unpackedBytes > MAX_UNPACKED_TOTAL_BYTES) throw new Error('Os pacotes do projeto somam mais do que o limite permitido.');

    const root = path.join(dir, key);
    const resolvedRoot = path.resolve(root);
    const madeDirs = new Set<string>();
    for (let i = 0; i < files.length; i += WRITE_CONCURRENCY) {
      await Promise.all(files.slice(i, i + WRITE_CONCURRENCY).map(async (file) => {
        const target = path.resolve(root, file.path);
        if (!target.startsWith(resolvedRoot + path.sep)) return; // nunca escreve fora da pasta do pacote
        const folder = path.dirname(target);
        if (!madeDirs.has(folder)) {
          await mkdir(folder, { recursive: true });
          madeDirs.add(folder);
        }
        await writeFile(target, file.data);
      }));
    }
    this.installed.add(key);
  }

  async cleanup(): Promise<void> {
    try {
      await rm(await this.dirPromise, { recursive: true, force: true });
    } catch {
      /* limpeza é melhor-esforço */
    }
  }
}
