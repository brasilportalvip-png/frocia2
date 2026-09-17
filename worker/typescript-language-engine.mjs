import ts from 'typescript';
import crypto from 'node:crypto';

export function analyzeTypeScriptLanguage(files, requestedSymbols = []) {
  const source = new Map(files.filter((file) => /\.[cm]?tsx?$/.test(file.path)).map((file) => [file.path, file.content]));
  const host = {
    getScriptFileNames: () => [...source.keys()], getScriptVersion: () => '1',
    getScriptSnapshot: (fileName) => { const value = source.get(fileName) ?? ts.sys.readFile(fileName); return value === undefined ? undefined : ts.ScriptSnapshot.fromString(value); },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => ({ target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true, noEmit: true }),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (fileName) => source.has(fileName) || ts.sys.fileExists(fileName),
    readFile: (fileName) => source.get(fileName) ?? ts.sys.readFile(fileName), readDirectory: ts.sys.readDirectory,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const symbols = [];
  for (const [path, content] of source) {
    const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isIdentifier(node) && requestedSymbols.some((term) => node.text.toLowerCase().includes(term.toLowerCase()))) {
        const definitions = service.getDefinitionAtPosition(path, node.getStart(sourceFile)) || [];
        const references = service.findReferences(path, node.getStart(sourceFile)) || [];
        symbols.push({ name: node.text, path,
          definitions: definitions.map((item) => ({ path: item.fileName, start: item.textSpan.start })),
          references: references.flatMap((group) => group.references.map((item) => ({ path: item.fileName, start: item.textSpan.start }))),
        });
      }
      ts.forEachChild(node, visit);
    }; visit(sourceFile);
  }
  const diagnostics = [...source.keys()].flatMap((path) => [...service.getSyntacticDiagnostics(path), ...service.getSemanticDiagnostics(path)])
    .slice(0, 200).map((diagnostic) => ({ path: diagnostic.file?.fileName || '', start: diagnostic.start || 0, code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').slice(0, 500) }));
  const unique = new Map(symbols.map((symbol) => [`${symbol.name}:${symbol.path}`, symbol]));
  const result = { schemaVersion: 'typescript-language-engine-v1', symbols: [...unique.values()].slice(0, 200), diagnostics };
  return { ...result, digest: crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex') };
}
