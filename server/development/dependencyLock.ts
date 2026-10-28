import { DevelopmentError, type SourceFiles, sha256 } from './archive.js';
import { fixedDownload } from './publicGithub.js';

const registry = new Set(['registry.npmjs.org']);
const integrityOf = (value: unknown) => String(value || '').split(/\s+/).find(item => /^sha512-[A-Za-z0-9+/]+=*$/.test(item));
function tarballUrl(value: unknown) {
  let url: URL;
  try { url = new URL(String(value)); } catch { throw new DevelopmentError('dependency_registry_denied', 'URL de dependência inválida.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.search || url.hash || url.username || url.password || url.port || !/\/-\/[^/]+\.tgz$/.test(url.pathname)) {
    throw new DevelopmentError('dependency_registry_denied', 'Dependências privadas, git ou fora do npm oficial exigem um adaptador autorizado.');
  }
  return url.href;
}
type Hydrated = { path: string; name: string; version: string; resolved: string; integrity: string; metadataSha256: string };
const matchesPlatform = (list: unknown, actual: string) => {
  if (!Array.isArray(list)) return true;
  const allowed = list.filter(value => typeof value === 'string' && !value.startsWith('!'));
  return !list.includes('!' + actual) && (!allowed.length || allowed.includes(actual) || allowed.includes('any'));
};

/** Supplemental install metadata only: source lockfile bytes and all versions stay unchanged. */
export async function resolveDependencyLock(files: SourceFiles, signal: AbortSignal, download = fixedDownload,
  target = { os: 'linux', cpu: process.arch as string, libc: 'glibc' }) {
  const original = files.get('package-lock.json');
  if (!original) throw new DevelopmentError('lockfile_required', 'O projeto npm precisa do lockfile original para instalação reproduzível.');
  const lock = JSON.parse(Buffer.from(original.bytes).toString());
  const entries = Object.entries(lock.packages || {}) as [string, any][];
  if (![2, 3].includes(lock.lockfileVersion) || !entries.length) throw new DevelopmentError('lockfile_unsupported', 'O executor aceita package-lock versões 2 e 3.');
  if (entries.length > 5000) throw new DevelopmentError('dependency_count_limit', 'O projeto excede 5 mil entradas de dependências.');
  const hydrated: Hydrated[] = [], manifests = new Map<string, Promise<{ value: any; digest: string }>>();
  let index = 0, metadataBytes = 0, failure: unknown;
  const resolveEntry = async (location: string, item: any) => {
    if (!location || item.link) return;
    if (signal.aborted) throw new DevelopmentError('job_cancelled', 'Execução cancelada.');
    if (item.resolved) tarballUrl(item.resolved); // Refuse private/git sources before any metadata request.
    if (item.integrity && !integrityOf(item.integrity)) throw new DevelopmentError('dependency_integrity_missing', 'A dependência não possui integridade SHA-512 verificável.');
    if (item.resolved && item.integrity) return;
    const name = item.name || location.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)?.[1], version = item.version;
    if (typeof name !== 'string' || name.length > 214 || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) ||
        typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i.test(version)) {
      throw new DevelopmentError('dependency_metadata_unpinned', 'Metadados ausentes exigem nome e versão npm exatos; tags, URLs e intervalos não são aceitos.');
    }
    const key = `${name}@${version}`;
    if (!manifests.has(key)) manifests.set(key, (async () => {
      const bytes = await download(new URL(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`), registry, 2 * 1024 * 1024, 30_000);
      metadataBytes += bytes.length;
      if (metadataBytes > 32 * 1024 * 1024) throw new DevelopmentError('dependency_metadata_limit', 'Metadados npm excederam 32 MiB.');
      return { value: JSON.parse(bytes.toString()), digest: sha256(bytes) };
    })());
    const { value, digest } = await manifests.get(key)!;
    if (value.name !== name || value.version !== version) throw new DevelopmentError('dependency_metadata_mismatch', 'O registro npm retornou outra identidade ou versão.');
    const resolved = tarballUrl(value.dist?.tarball), integrity = integrityOf(value.dist?.integrity);
    if (!integrity) throw new DevelopmentError('dependency_integrity_missing', 'O registro npm não forneceu integridade SHA-512.');
    if ((item.resolved && item.resolved !== resolved) || (item.integrity && integrityOf(item.integrity) !== integrity)) {
      throw new DevelopmentError('dependency_metadata_mismatch', 'Metadados do registro divergem dos valores já fixados no lockfile.');
    }
    item.resolved = resolved; item.integrity ||= integrity;
    for (const field of ['os', 'cpu', 'libc']) if (item[field] === undefined && Array.isArray(value[field])) item[field] = value[field];
    hydrated.push({ path: location, name, version, resolved, integrity, metadataSha256: digest });
  };
  await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
    while (index < entries.length && !failure) {
      const [location, item] = entries[index++];
      try { await resolveEntry(location, item); } catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  const tarballs = new Map<string, string>(), skippedOptionalPackages: string[] = [];
  for (const [location, item] of entries) if (location && !item.link) {
    if (!matchesPlatform(item.os, target.os) || !matchesPlatform(item.cpu, target.cpu) || !matchesPlatform(item.libc, target.libc)) {
      if (!item.optional) throw new DevelopmentError('dependency_platform_unsupported', `Dependência obrigatória incompatível com ${target.os}/${target.cpu}.`);
      skippedOptionalPackages.push(location); continue;
    }
    const url = tarballUrl(item.resolved), integrity = integrityOf(item.integrity)!;
    if (tarballs.has(url) && tarballs.get(url) !== integrity.slice(7)) throw new DevelopmentError('dependency_integrity_mismatch', 'O mesmo tarball possui hashes conflitantes.');
    tarballs.set(url, integrity.slice(7));
  }
  hydrated.sort((a, b) => a.path.localeCompare(b.path));
  const installLockfile = hydrated.length ? Buffer.from(JSON.stringify(lock, null, 2) + '\n') : Buffer.from(original.bytes);
  const evidence = { originalSha256: sha256(original.bytes), installSha256: sha256(installLockfile), targetPlatform: target,
    metadataSource: 'https://registry.npmjs.org', versionsChanged: false, sourceLockfileChanged: false, hydrated, skippedOptionalPackages };
  if (Buffer.byteLength(JSON.stringify(evidence)) > 512 * 1024) throw new DevelopmentError('dependency_provenance_limit', 'A proveniência de instalação excedeu 512 KiB.');
  return { installLockfile, tarballs, evidence };
}
