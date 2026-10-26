import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import { buildPatchRepairContext } from '../worker/patch-repair-context.mjs';
import { executeAutonomousRepairCycle } from '../worker/autonomous-repair-cycle.mjs';
import { generateStructuredPatch } from '../worker/patch-generation.mjs';

describe('Contexto real para reparar o patch reprovado', () => {
  let temporary: string, root: string;
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'frocia-repair-context-'));
    root = path.join(temporary, 'repo');
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'tests'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      devDependencies: { typescript: '~5.8.2', vitest: '^4.1.12', '@types/node': '^24.19.2' },
    }));
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network allowed'); }));
  });
  afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await fs.rm(temporary, { recursive: true, force: true }); });

  it('fornece tipos privados, interfaces e assinaturas sem executar o modulo importado', async () => {
    await fs.writeFile(path.join(root, 'src', 'importer.ts'), `
      type ImportType = 'url' | 'github';
      export interface ExternalImportResult { type: ImportType; mimeType: 'text/plain' | 'application/json'; }
      fetch('https://must-never-run.invalid');
      ${'// irrelevant implementation\n'.repeat(3000)}
      export class Importer {
        static async import(input: { type: ImportType; url: string }): Promise<ExternalImportResult> {
          throw new Error('Do not execute');
        }
      }
    `);
    const context = await buildPatchRepairContext(root, { files: [{ path: 'tests/seo.test.ts',
      content: "import { Importer } from '../src/importer.js';\nImporter.import({ type: 'text', url: 'https://site.invalid' });" }] });
    const contract = context.contracts.find(file => file.path === 'src/importer.ts').content;
    expect(contract).toContain("type ImportType = 'url' | 'github'");
    expect(contract).toContain("mimeType: 'text/plain' | 'application/json'");
    expect(contract).toContain('static async import(input: { type: ImportType; url: string }): Promise<ExternalImportResult>;');
    expect(contract).not.toContain('Do not execute');
    expect(contract).not.toContain('irrelevant implementation');
    expect(context.toolchain.vitest).toBe('^4.1.12');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('repara erros TS2322 e TS2554 com o snapshot e certificacao TypeScript real', async () => {
    await fs.writeFile(path.join(root, 'src', 'importer.ts'), `
      type ImportType = 'url' | 'github';
      export interface ExternalImportResult { type: ImportType; mimeType: 'text/plain' | 'application/json'; }
      export function importPage(input: { type: ImportType; url: string }): void {}
    `);
    const bad = `import { importPage, type ExternalImportResult } from '../src/importer.js';
      export const fixture: ExternalImportResult = { type: 'text', mimeType: 'text/html' };
      importPage({type: 'url', url: 'https://site.invalid'}, 'unexpected');`;
    const good = `import { importPage, type ExternalImportResult } from '../src/importer.js';
      export const fixture: ExternalImportResult = { type: 'url', mimeType: 'text/plain' };
      importPage({type: 'url', url: 'https://site.invalid'});`;
    const makePatch = (content: string) => ({ files: [
      { path: 'index.html', content: '<main><h1>Validated product improvement</h1></main>' },
      { path: 'tests/seo.test.ts', content },
    ], commitMessage: 'fix: seo' });
    const generateContent = vi.fn(async request => {
      const input = JSON.parse(request.contents[0].text);
      if (generateContent.mock.calls.length === 1) return { text: JSON.stringify(makePatch(bad)), candidates: [{ finishReason: 'STOP' }] };
      expect(input.repairFeedback.stdoutTail).toContain('TS2554');
      expect(input.repairContext.previousPatch.files.find(file => file.path === 'tests/seo.test.ts').content).toBe(bad);
      expect(input.repairContext.previousPatch.files.find(file => file.path === 'index.html').content).toContain('Validated product improvement');
      expect(input.repairContext.contracts.find(file => file.path === 'src/importer.ts').content).toContain("'url' | 'github'");
      expect(await fs.readFile(path.join(root, 'index.html'), 'utf8')).toBe('<main>baseline</main>');
      return { text: JSON.stringify(makePatch(good)), candidates: [{ finishReason: 'STOP' }] };
    });
    const compilerCodes: number[][] = [];
    const result = await executeAutonomousRepairCycle({ maximumAttempts: 3,
      restoreBaseline: async () => {
        await fs.rm(path.join(root, 'tests', 'seo.test.ts'), { force: true });
        await fs.writeFile(path.join(root, 'index.html'), '<main>baseline</main>');
      },
      generate: async ({ attempt, feedback, previousPatch }) => generateStructuredPatch({
        model: 'gemini-3.8-flash', allowed: new Set(['index.html']), attempt, feedback, generateContent,
        input: { repairContext: await buildPatchRepairContext(root, previousPatch) },
      }),
      apply: async patch => { for (const file of patch.files) await fs.writeFile(path.join(root, file.path), file.content); },
      certify: async () => {
        const program = ts.createProgram([path.join(root, 'tests', 'seo.test.ts')], { noEmit: true,
          target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
          strict: true, skipLibCheck: true, types: [] });
        const errors = ts.getPreEmitDiagnostics(program);
        compilerCodes.push(errors.map(error => error.code));
        return errors.length ? { passed: false, failure: { stage: 'typecheck', exitCode: 2,
          stdoutTail: errors.map(error => `error TS${error.code}: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`).join('\n') } }
          : { passed: true, evidenceRefs: ['real-local-typescript-check'] };
      },
    });
    expect(compilerCodes[0]).toContain(2322);
    expect(compilerCodes[0]).toContain(2554);
    expect(compilerCodes[1]).toEqual([]);
    expect(result).toMatchObject({ passed: true, selectedAttempt: 2, patch: makePatch(good) });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserva o diagnostico de raciocinio solicitado mesmo sem metadados de tokens', async () => {
    const onDiagnostic = vi.fn();
    await generateStructuredPatch({ model: 'gemini-3.8-flash', allowed: new Set(['index.html']), input: {}, onDiagnostic,
      generateContent: async () => ({ candidates: [{ finishReason: 'STOP' }],
        text: JSON.stringify({ files: [{ path: 'index.html', content: '<main>fix</main>' }], commitMessage: 'fix: page' }) }) });
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ thinkingTokens: null, requestedThinkingLevel: 'LOW' }));
  });

  it('limita contexto e remove segredos sem remover as quebras de linha do codigo', async () => {
    vi.stubEnv('CONTEXT_TEST_TOKEN', 'fixture-private-value');
    const context = await buildPatchRepairContext(root, { files: Array.from({ length: 8 }, (_, index) => ({
      path: `tests/case${index}.test.ts`, content: "const token = 'fixture-private-value';\n" + 'x'.repeat(70_000),
    })) });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('fixture-private-value');
    expect(context.previousPatch.files[0].content).toContain("const token = '[REDACTED_SECRET]';\n");
    expect(context.previousPatch.files.reduce((sum, file) => sum + file.content.length, 0)).toBeLessThanOrEqual(64_000);
    expect(context.previousPatch.files.every(file => file.truncated)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('nao segue imports por symlink para fora do repositorio', async () => {
    await fs.writeFile(path.join(temporary, 'outside.ts'), "export type Sensitive = 'OUTSIDE_CONTENT';");
    await fs.symlink(path.join(temporary, 'outside.ts'), path.join(root, 'src', 'outside.ts'));
    const context = await buildPatchRepairContext(root, { files: [{ path: 'tests/safe.test.ts',
      content: "import type { Sensitive } from '../src/outside.js';" }] });
    expect(context.contracts.some(file => file.path === 'src/outside.ts')).toBe(false);
    expect(JSON.stringify(context)).not.toContain('OUTSIDE_CONTENT');
  });

  it('nao le arquivos quando ainda nao existe patch reprovado', async () => {
    expect(await buildPatchRepairContext('/missing-workspace', undefined)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
