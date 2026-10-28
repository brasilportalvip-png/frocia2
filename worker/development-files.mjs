import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = '/workspace';
const input = JSON.parse(await new Promise((resolve, reject) => { let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s => { text += s; if (text.length > 4_000_000) reject(new Error('input_limit')); }); process.stdin.on('end', () => resolve(text)); }));
const safe = value => {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.split('/').some(p => !p || p === '..' || p === '.' || p === '.git')) throw new Error('unsafe_path');
  return value;
};
const resolveFile = async relative => {
  safe(relative); let current = root;
  for (const segment of relative.split('/')) { current = path.join(current, segment); if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('source_symlink_denied'); }
  if (!(await fs.realpath(current)).startsWith(root + '/')) throw new Error('source_path_escape');
  return current;
};
if (input.op === 'read') {
  const file = await resolveFile(input.path), bytes = await fs.readFile(file);
  if (bytes.length > 20 * 1024 * 1024) throw new Error('file_limit');
  const offset = Math.max(0, Number(input.offset) || 0);
  console.log(JSON.stringify({ data: bytes.subarray(offset, offset + 384 * 1024).toString('base64'), size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex') }));
} else if (input.op === 'manifest') {
  const files = []; let total = 0;
  const original = new Set(input.original || []), outputs = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.server', '.vite', '.cache', 'test-results', 'playwright-report', '.froc']);
  const visit = async relative => {
    for (const name of await fs.readdir(path.join(root, relative))) {
      const child = relative ? `${relative}/${name}` : name;
      if (outputs.has(name) && ![...original].some(p => p === child || p.startsWith(child + '/'))) continue;
      if (/\.tsbuildinfo$/.test(child) && !original.has(child)) continue;
      const absolute = path.join(root, child), stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('source_special_file_denied');
      if (stat.isDirectory()) await visit(child);
      else {
        total += stat.size; if (files.length >= 20_000 || stat.size > 20 * 1024 * 1024 || total > 250 * 1024 * 1024) throw new Error('source_limit');
        files.push({ path: child, size: stat.size, sha256: crypto.createHash('sha256').update(await fs.readFile(absolute)).digest('hex') });
      }
    }
  };
  await visit(input.directory ? safe(input.directory) : '');
  console.log(JSON.stringify({ files }));
} else throw new Error('unknown_file_operation');
