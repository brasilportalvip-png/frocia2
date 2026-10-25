import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const artifactManifest = files => crypto.createHash('sha256').update(JSON.stringify([...files]
  .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => [file.path, crypto.createHash('sha256').update(file.content).digest('hex')]))).digest('hex');
export async function changedPatch(cwd, patch) {
  const files = [];
  for (const file of patch.files) {
    let previous;
    try { previous = await fs.readFile(path.join(cwd, file.path), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous !== file.content) files.push(file);
  }
  return files.length ? { ...patch, files } : { ...patch, files: [], noChangeReason: patch.noChangeReason || 'Os arquivos devolvidos pelo gerador são idênticos à versão examinada. Nenhuma correção foi aplicada.' };
}
export async function verifyArtifactFiles(cwd, files) {
  for (const file of files) if (await fs.readFile(path.join(cwd, file.path), 'utf8') !== file.content)
    throw new Error('artifact_changed_during_certification:' + file.path);
}
