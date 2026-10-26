import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { safeRepoPath } from './patch-generation.mjs';
import { safeSourceText } from './worker-failure.mjs';

const PATCH_LIMIT = 64_000;
const FILE_LIMIT = 24_000;
const CONTRACT_LIMIT = 36_000;
const MAX_CONTRACTS = 8;
const MAX_LOOKUPS = 80;

function parse(file, content) {
  return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function imports(file, content) {
  return parse(file, content).statements.flatMap(node =>
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')
      ? [node.moduleSpecifier.text] : []);
}

function declarations(file, content) {
  const source = parse(file, content);
  const signature = node => node.body
    ? content.slice(node.getStart(source), node.body.getStart(source)).trimEnd() + ';'
    : node.getText(source);
  const result = source.statements.flatMap(node => {
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node) ||
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return [node.getText(source)];
    if (ts.isFunctionDeclaration(node)) return [signature(node)];
    if (ts.isClassDeclaration(node)) return [`class ${node.name?.text || 'Anonymous'} {\n${node.members
      .filter(member => ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isGetAccessorDeclaration(member))
      .map(signature).join('\n')}\n}`];
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.filter(decl => decl.type)
      .map(decl => `${decl.name.getText(source)}: ${decl.type.getText(source)};`);
    return [];
  });
  return result.join('\n\n') || content;
}

/** Read repository data only: imports are parsed, never loaded or executed. */
export async function buildPatchRepairContext(cwd, previousPatch) {
  if (!Array.isArray(previousPatch?.files) || !previousPatch.files.length) return null;
  const previous = previousPatch.files.flatMap(file => {
    const relative = safeRepoPath(file?.path);
    return relative && typeof file.content === 'string' ? [{ path: relative, content: file.content }] : [];
  });
  if (!previous.length) return null;
  const previousByPath = new Map(previous.map(file => [file.path, file.content]));
  let patchBudget = PATCH_LIMIT;
  const files = previous.map(file => {
    const limit = Math.min(FILE_LIMIT, patchBudget);
    const content = safeSourceText(file.content, limit);
    patchBudget -= content.length;
    return { path: file.path, content, truncated: file.content.length > limit };
  });
  const root = await fs.realpath(cwd);
  const readSource = async relative => {
    if (!safeRepoPath(relative) || !/\.[cm]?[jt]sx?$/.test(relative)) return null;
    if (previousByPath.has(relative)) return previousByPath.get(relative);
    try {
      const target = await fs.realpath(path.join(root, relative));
      const within = path.relative(root, target);
      if (within.startsWith('..') || path.isAbsolute(within)) return null;
      const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size > 500_000) return null;
      return await fs.readFile(target, 'utf8');
    } catch { return null; }
  };
  const queue = previous.flatMap(file => imports(file.path, file.content).map(specifier => ({ from: file.path, specifier, depth: 0 })));
  const seen = new Set(previousByPath.keys());
  const contracts = [];
  let lookups = 0, contractBudget = CONTRACT_LIMIT;
  for (const file of previous.filter(file => /\.[cm]?[jt]sx?$/.test(file.path))) {
    if (contracts.length >= MAX_CONTRACTS || contractBudget <= 0) break;
    const selected = declarations(file.path, file.content);
    const limit = Math.min(FILE_LIMIT, contractBudget);
    const content = safeSourceText(selected, limit);
    contractBudget -= content.length;
    contracts.push({ path: file.path, kind: 'types_and_signatures', content, truncated: selected.length > limit });
  }
  while (queue.length && contracts.length < MAX_CONTRACTS && lookups < MAX_LOOKUPS && contractBudget > 0) {
    const item = queue.shift();
    const modulePath = path.posix.normalize(path.posix.join(path.posix.dirname(item.from), item.specifier));
    const stem = modulePath.replace(/\.[cm]?[jt]sx?$/, '');
    const candidates = [...new Set([stem + '.ts', stem + '.tsx', modulePath, stem + '.mjs', stem + '.js', stem + '/index.ts'])];
    for (const candidate of candidates) {
      if (lookups >= MAX_LOOKUPS) break;
      if (!safeRepoPath(candidate) || seen.has(candidate)) continue;
      lookups += 1;
      const content = await readSource(candidate);
      if (content === null) continue;
      seen.add(candidate);
      const selected = declarations(candidate, content);
      const limit = Math.min(FILE_LIMIT, contractBudget);
      const excerpt = safeSourceText(selected, limit);
      contractBudget -= excerpt.length;
      contracts.push({ path: candidate, kind: 'types_and_signatures', content: excerpt, truncated: selected.length > limit });
      if (item.depth < 1) queue.push(...imports(candidate, content).map(specifier => ({ from: candidate, specifier, depth: item.depth + 1 })));
      break;
    }
  }
  let toolchain = {};
  try {
    const metadataPath = await fs.realpath(path.join(root, 'package.json'));
    const within = path.relative(root, metadataPath);
    const stat = await fs.stat(metadataPath);
    if (within.startsWith('..') || path.isAbsolute(within) || !stat.isFile() || stat.size > 500_000) throw new Error('metadata_unavailable');
    const pkg = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    for (const name of ['typescript', 'vitest', '@types/node']) {
      const value = pkg.devDependencies?.[name] || pkg.dependencies?.[name];
      if (typeof value === 'string') toolchain[name] = safeSourceText(value, 100);
    }
  } catch { /* Missing metadata is reported as absent, never invented. */ }
  return { schemaVersion: 'patch-repair-context-v1', previousPatch: { files }, contracts, toolchain,
    baselineRestored: true, instructions: 'Corrija os erros comprovados usando o patch anterior e os contratos reais. A sandbox voltou a base: devolva todos os arquivos completos necessarios, preservando a correcao e reparando seus testes. Trechos marcados truncated sao referencias parciais. Nao remova testes nem enfraqueca contratos para obter aprovacao.' };
}
