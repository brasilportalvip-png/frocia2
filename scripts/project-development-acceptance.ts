/** Reproducible acceptance fixture. Product execution always uses Docker; native verification is explicit and separate. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publicGithubArchive, fixedDownload } from '../server/development/publicGithub.js';
import { readArchive, writeArchive, sourceManifest, sha256, safePath, type SourceFiles } from '../server/development/archive.js';
import { developProject, type ValidationReceipt } from '../server/development/agent.js';
import { DockerProjectSandbox, processCommand } from '../server/development/dockerSandbox.js';
import { portablePreview } from '../server/development/preview.js';

const output = path.resolve(process.env.DEVELOPMENT_ACCEPTANCE_OUTPUT || 'development-acceptance');
const native = process.argv.includes('--trusted-native-acceptance');
if (!native && !await DockerProjectSandbox.available()) throw new Error('Docker required. Product has no native fallback.');
await fs.mkdir(output, { recursive: true });
const imported = await publicGithubArchive('https://github.com/brasilportalvip-png/Froc.-IA-Marketing-Engine');
const files = readArchive(imported.archive, true), before = sourceManifest(files);
const tree = JSON.parse((await fixedDownload(new URL(`https://api.github.com/repos/brasilportalvip-png/Froc.-IA-Marketing-Engine/git/trees/${imported.source.commitSha}?recursive=1`), new Set(['api.github.com']), 2_000_000)).toString());
if (tree.truncated || tree.tree.filter((f: any) => f.type === 'blob').length !== files.size) throw new Error('Source tree incomplete.');
for (const entry of tree.tree.filter((f: any) => f.type === 'blob')) {
  const file = files.get(entry.path); if (!file) throw new Error('Missing source file.');
  const gitHash = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${file.bytes.length}\0`), Buffer.from(file.bytes)])).digest('hex');
  if (gitHash !== entry.sha) throw new Error(`Original bytes mismatch: ${entry.path}`);
}
await fs.writeFile(path.join(output, 'marketing-original.zip'), writeArchive(files));
const controller = new AbortController();
const workspace = path.join(output, 'marketing-workspace');
const validateNative = async (files: SourceFiles): Promise<ValidationReceipt> => {
  await fs.mkdir(workspace, { recursive: true });
  for (const [file, data] of files) { const destination = path.join(workspace, safePath(file)); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, data.bytes, { mode: data.mode }); }
  const commands = [];
  for (const args of [['ci', '--userconfig', '/dev/null'], ['run', 'typecheck'], ['test'], ['run', 'build']]) {
    console.log(`Starting npm ${args.join(' ')} in the explicit trusted acceptance copy.`);
    const receipt = await processCommand('npm', args, workspace, controller.signal); commands.push(receipt);
    await fs.writeFile(path.join(output, 'commands.json'), JSON.stringify(commands, null, 2));
    console.log(`${receipt.command}: exit ${receipt.exitCode}`);
    if (receipt.exitCode !== 0) break;
  }
  const built: SourceFiles = new Map();
  const collect = async (directory: string, relative = '') => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Unsafe build symlink.');
      if (entry.isDirectory()) await collect(path.join(directory, entry.name), name);
      else built.set(name, { bytes: await fs.readFile(path.join(directory, entry.name)), mode: 0o644 });
    }
  };
  if (commands.every(c => c.exitCode === 0)) await collect(path.join(workspace, 'dist'));
  await fs.appendFile(path.join(output, 'validation-attempts.jsonl'), JSON.stringify({ at: new Date().toISOString(), commands }) + '\n');
  return { commands, sourceDigest: sourceManifest(files).digest, ...(built.size ? { preview: writeArchive(built) } : {}),
    isolation: { acceptanceMode: 'trusted_native_verification', productionSandboxNotBypassed: true, dockerIsolationVerified: false } };
};
const target = 'src/components/AuthModal.tsx'; let call = 0, repairTsx = false;
const result = await developProject({ files, instruction: 'Associe o título visível do modal de autenticação ao diálogo para leitores de tela. Preserve design, arquitetura e Vercel.',
  checkControl: async () => {}, checkpoint: async (state, source, detail) => {
    await fs.writeFile(path.join(output, 'working.zip'), writeArchive(source));
    await fs.appendFile(path.join(output, 'events.jsonl'), JSON.stringify({ state, ...detail }) + '\n');
  },
  generate: async context => {
    call++;
    if (call === 1) return { actions: [{ op: 'read', path: target }] };
    if (call === 2) return { actions: [{ op: 'replace', path: target, expectedSha256: sha256(files.get(target)!.bytes), oldText: 'role="dialog" aria-modal="true"', newText: 'role="dialog" aria-modal="true" aria-labelledby="froc-auth-title"' }] };
    if (call === 3) return { actions: [{ op: 'replace', path: target, expectedSha256: sha256(files.get(target)!.bytes), oldText: '<h2 className="text-xl font-extrabold text-white">', newText: '<h2 id="froc-auth-title" className="text-xl font-extrabold text-white">' }] };
    if (call === 4) return { actions: [{ op: 'validate' }] };
    if (call === 5) {
      repairTsx = /listen EPERM/.test(context);
      if (repairTsx) return { actions: [{ op: 'read', path: 'package.json' }] };
    }
    if (repairTsx && call === 6) return { actions: [{ op: 'replace', path: 'package.json', expectedSha256: sha256(files.get('package.json')!.bytes), oldText: 'tsx --test test/*.test.ts', newText: 'node --import tsx --test test/*.test.ts' }] };
    if (repairTsx && call === 7) return { actions: [{ op: 'validate' }] };
    if (call > (repairTsx ? 8 : 5)) throw new Error('Acceptance validation failed; inspect commands.json.');
    return { actions: [{ op: 'finish', summary: 'Nome acessível do diálogo vinculado ao título, com os scripts originais executados.' }] };
  },
  validate: native ? validateNative : source => new DockerProjectSandbox(controller.signal).validate(source),
});
await fs.writeFile(path.join(output, 'marketing-atualizado.zip'), writeArchive(result.files));
if (!result.validation.preview) throw new Error('No static preview captured.');
await fs.writeFile(path.join(output, 'preview.html'), await portablePreview(result.validation.preview));
const report = { source: imported.source, sourceVerifiedAgainstGitTree: files.size, original: before, current: sourceManifest(result.files),
  modelMode: 'deterministic_tool_fixture_no_provider_spend', runnerMode: native ? 'trusted_native_verification' : 'docker_isolated',
  changes: result.changes, validation: { ...result.validation, preview: undefined }, summary: result.summary };
await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ filesVerified: files.size, changed: result.changes.map(c => c.path), output, runnerMode: report.runnerMode }));
