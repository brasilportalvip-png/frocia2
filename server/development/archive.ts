import { createHash } from 'node:crypto';
import { Unzip, UnzipInflate, zipSync, type Zippable } from 'fflate';

export class DevelopmentError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const LIMITS = Object.freeze({ archive: 50 * 1024 * 1024, expanded: 250 * 1024 * 1024,
  file: 20 * 1024 * 1024, files: 20_000, commandMs: 300_000, jobMs: 1_800_000, steps: 30 });
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export type SourceFile = { bytes: Uint8Array; mode: number };
export type SourceFiles = Map<string, SourceFile>;
export function safePath(path: string) {
  if (!path || path.length > 500 || /[\\\x00-\x1f\x7f:]/.test(path) || path.startsWith('/') ||
      path.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git' ||
        /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    throw new DevelopmentError('unsafe_project_path', 'O projeto contém um caminho inseguro ou incompatível. A importação não foi parcial.');
  }
  return path;
}
export const secretPath = (path: string) => /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.ssh|credentials(?:\.json)?|service[-_]?account[^/]*|[^/]*\.(?:pem|key|p12|pfx))$/i.test(path);
export const protectedPath = (path: string) => secretPath(path) || /^(?:\.github\/|vercel\.json$|firebase\.json$|firestore\.rules$|storage\.rules$)/.test(path);
export function sourceManifest(files: SourceFiles) {
  if (files.size > LIMITS.files || [...files.values()].some(f => f.bytes.length > LIMITS.file) || [...files.values()].reduce((n, f) => n + f.bytes.length, 0) > LIMITS.expanded) throw new DevelopmentError('workspace_size_limit', 'O workspace excedeu as quotas de arquivos ou bytes.', 413);
  const entries = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, file]) => ({ path, size: file.bytes.length,
    sha256: sha256(file.bytes), mode: file.mode, protected: secretPath(path) }));
  return { digest: sha256(JSON.stringify(entries)), fileCount: entries.length, bytes: entries.reduce((sum, e) => sum + e.size, 0), files: entries };
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Validate central directory before decompression; then bound every actual output chunk and verify CRC. */
export function readArchive(bytes: Uint8Array, stripRoot = false): SourceFiles {
  if (!bytes.length || bytes.length > LIMITS.archive) throw new DevelopmentError('archive_size_limit', 'ZIP vazio ou maior que 50 MiB.', 413);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new DevelopmentError('invalid_archive', 'ZIP inválido ou dividido em volumes.');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true), total = 0;
  if (count === 65535 || count > LIMITS.files || offset + size !== end) throw new DevelopmentError('archive_limit', 'ZIP64, árvore excessiva ou diretório ZIP inconsistente.');
  const entries = new Map<string, { size: number; crc: number; mode: number }>();
  const aliases = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new DevelopmentError('invalid_archive', 'Diretório ZIP inválido.');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true), expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const attributes = view.getUint32(offset + 38, true), localOffset = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength + extra + comment > end || localOffset + 30 > bytes.length || flags & 1 || ![0, 8].includes(method)) {
      throw new DevelopmentError('unsupported_archive', 'ZIP cifrado, formato não suportado ou cabeçalho inválido.');
    }
    let name: string;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); }
    catch { throw new DevelopmentError('archive_filename_encoding', 'Os nomes de arquivos do ZIP precisam usar UTF-8.'); }
    const mode = attributes >>> 16, kind = mode & 0xf000;
    if (kind && ![0x8000, 0x4000].includes(kind)) throw new DevelopmentError('archive_link_not_allowed', 'Links simbólicos e arquivos especiais não são aceitos.');
    const directory = name.endsWith('/');
    safePath(directory ? name.slice(0, -1) : name);
    const alias = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (aliases.has(alias)) throw new DevelopmentError('archive_collision', 'Há caminhos duplicados ou ambíguos no ZIP.');
    aliases.add(alias);
    if (!directory) {
      total += expanded;
      if (expanded > LIMITS.file || total > LIMITS.expanded || expanded > Math.max(compressed, 1) * 2000) throw new DevelopmentError('archive_expansion_limit', 'O ZIP excede os limites de arquivos ou expansão.', 413);
      entries.set(name, { size: expanded, crc: view.getUint32(offset + 16, true), mode: mode & 0o111 ? 0o755 : 0o644 });
    }
    offset += 46 + nameLength + extra + comment;
  }
  if (offset !== end || !entries.size) throw new DevelopmentError('empty_archive', 'ZIP vazio ou inconsistente.');
  let prefix = '';
  if (stripRoot) {
    const first = entries.keys().next().value!;
    prefix = first.includes('/') ? first.slice(0, first.indexOf('/') + 1) : '';
    if (!prefix || [...entries.keys()].some(name => !name.startsWith(prefix))) throw new DevelopmentError('archive_root_invalid', 'Raiz do arquivo GitHub inconsistente.');
  }
  const files: SourceFiles = new Map(); let actual = 0;
  const unzip = new Unzip(file => {
    if (file.name.endsWith('/')) return;
    const entry = entries.get(file.name);
    if (!entry || files.has(file.name.slice(prefix.length))) throw new DevelopmentError('archive_local_mismatch', 'Cabeçalhos locais e diretório do ZIP divergem.');
    const chunks: Uint8Array[] = []; let length = 0;
    file.ondata = (error, data, final) => {
      if (error) throw new DevelopmentError('invalid_archive', 'O conteúdo comprimido está corrompido.');
      actual += data.length; length += data.length;
      if (length > entry.size || actual > LIMITS.expanded) { file.terminate(); throw new DevelopmentError('archive_expansion_limit', 'A expansão real excede o tamanho declarado.', 413); }
      chunks.push(data);
      if (final) {
        const result = Buffer.concat(chunks);
        if (length !== entry.size || crc32(result) !== entry.crc) throw new DevelopmentError('archive_checksum_mismatch', 'Falha na integridade de um arquivo do ZIP.');
        files.set(safePath(file.name.slice(prefix.length)), { bytes: result, mode: entry.mode });
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try { for (let p = 0; p < bytes.length; p += 512) unzip.push(bytes.subarray(p, p + 512), p + 512 >= bytes.length); }
  catch (error) { if (error instanceof DevelopmentError) throw error; throw new DevelopmentError('invalid_archive', 'Não foi possível ler o ZIP integralmente.'); }
  if (files.size !== entries.size) throw new DevelopmentError('archive_incomplete', 'A leitura integral do ZIP não foi concluída.');
  return files;
}
export function writeArchive(files: SourceFiles) {
  sourceManifest(files);
  const zip: Zippable = Object.create(null);
  for (const [path, file] of files) zip[safePath(path)] = [file.bytes, { level: 6, os: 3, attrs: (0x8000 | file.mode) << 16 }];
  return zipSync(zip);
}
export function changesBetween(before: SourceFiles, after: SourceFiles) {
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(path => {
    const a = before.get(path), b = after.get(path);
    return a && b && sha256(a.bytes) === sha256(b.bytes) ? [] : [{ path, operation: !a ? 'create' : !b ? 'delete' : 'edit', before: a ? sha256(a.bytes) : null, after: b ? sha256(b.bytes) : null }];
  });
}
