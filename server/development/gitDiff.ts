import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type SourceFiles, safePath, LIMITS, DevelopmentError } from './archive.js';
import { processCommand } from './dockerSandbox.js';
export async function projectDiff(before: SourceFiles, after: SourceFiles) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'froc-project-diff-'));
  const write = async (files: SourceFiles) => { for (const [name, file] of files) {
    const destination = path.join(root, safePath(name)); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, file.bytes, { mode: file.mode });
  } };
  const git = async (args: string[]) => {
    const result = await processCommand('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.attributesFile=/dev/null', ...args], root);
    if (result.exitCode !== 0) throw new DevelopmentError('project_diff_failed', 'Não foi possível gerar o diff real da versão.');
  };
  try {
    await write(before); await git(['init', '--quiet']); await git(['add', '--all', '--force']);
    await git(['-c', 'user.name=Froc.IA', '-c', 'user.email=frocia@localhost', 'commit', '--quiet', '-m', 'source snapshot']);
    for (const name of before.keys()) if (!after.has(name)) await fs.rm(path.join(root, safePath(name)));
    await write(after); await git(['add', '--all', '--force']);
    const output = path.join(root, '.git', 'source-changes.patch');
    await git(['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--output', output]);
    const patch = await fs.readFile(output);
    if (!patch.length || patch.length > LIMITS.archive) throw new DevelopmentError('project_diff_limit', 'O diff está vazio ou excedeu a quota.');
    return patch;
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
