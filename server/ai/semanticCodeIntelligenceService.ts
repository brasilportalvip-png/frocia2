import crypto from 'node:crypto';
import ts from 'typescript';
import { RepositoryArchitectureService } from './repositoryArchitectureService.js';

export interface SemanticSourceFile {
  path: string;
  content: string;
}

export interface CodeLocation {
  path: string;
  line: number;
  column: number;
}

export interface CodeSymbol {
  id: string;
  name: string;
  kind: string;
  exported: boolean;
  declaration: CodeLocation;
  references: CodeLocation[];
}

export interface DuplicateCodeGroup {
  fingerprint: string;
  locations: CodeLocation[];
}

export interface SemanticCodeReport {
  schemaVersion: 'semantic-code-v1';
  languageServiceCompatible: true;
  symbols: CodeSymbol[];
  duplicateCode: DuplicateCodeGroup[];
  possibleDeadExports: CodeSymbol[];
  securityFindings: Array<{
    rule: string;
    severity: 'medium' | 'high';
    location: CodeLocation;
    evidence: string;
  }>;
  architecture: ReturnType<typeof RepositoryArchitectureService.analyze>;
  limitations: string[];
}

const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/i;

function safePath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null;
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')) return null;
  return normalized.slice(0, 300);
}

function location(source: ts.SourceFile, node: ts.Node, path: string): CodeLocation {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { path, line: point.line + 1, column: point.character + 1 };
}

function symbolKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isVariableDeclaration(node)) return 'variable';
  return 'symbol';
}

function declarationName(node: ts.Node): ts.Identifier | null {
  if (
    ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) || ts.isMethodDeclaration(node) ||
    ts.isVariableDeclaration(node)
  ) return node.name && ts.isIdentifier(node.name) ? node.name : null;
  return null;
}

function isExported(node: ts.Node): boolean {
  const variableStatement = ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent)
    ? node.parent.parent
    : null;
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) ||
    Boolean(variableStatement?.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function executableFingerprint(node: ts.Node, source: ts.SourceFile): string | null {
  if (!ts.isFunctionDeclaration(node) && !ts.isMethodDeclaration(node) && !ts.isArrowFunction(node)) return null;
  const text = node.getText(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/[A-Za-z_$][\w$]*/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 80) return null;
  return crypto.createHash('sha256').update(text).digest('hex');
}

export class SemanticCodeIntelligenceService {
  static analyze(files: SemanticSourceFile[]): SemanticCodeReport {
    const sources = new Map<string, ts.SourceFile>();
    const rawFiles: SemanticSourceFile[] = [];
    for (const file of files) {
      const path = safePath(file.path);
      if (!path || !SOURCE_PATTERN.test(path) || sources.has(path)) continue;
      const kind = /x$/i.test(path) ? ts.ScriptKind.TSX : /\.jsx?$/i.test(path) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
      sources.set(path, ts.createSourceFile(path, file.content, ts.ScriptTarget.Latest, true, kind));
      rawFiles.push({ path, content: file.content });
    }

    const declared = new Map<string, Array<{ node: ts.Node; name: ts.Identifier; source: ts.SourceFile; path: string; exported: boolean }>>();
    const references = new Map<string, CodeLocation[]>();
    const fingerprints = new Map<string, CodeLocation[]>();
    const securityFindings: SemanticCodeReport['securityFindings'] = [];

    for (const [path, source] of sources) {
      const visit = (node: ts.Node) => {
        const name = declarationName(node);
        if (name) {
          const list = declared.get(name.text) || [];
          list.push({ node, name, source, path, exported: isExported(node) });
          declared.set(name.text, list);
        }
        if (ts.isIdentifier(node)) {
          const list = references.get(node.text) || [];
          list.push(location(source, node, path));
          references.set(node.text, list);
        }
        const fingerprint = executableFingerprint(node, source);
        if (fingerprint) {
          const list = fingerprints.get(fingerprint) || [];
          list.push(location(source, node, path));
          fingerprints.set(fingerprint, list);
        }
        if (ts.isCallExpression(node)) {
          const expression = node.expression.getText(source);
          const rules: Array<[RegExp, string, 'medium' | 'high']> = [
            [/^(?:eval|Function)$/, 'dynamic-code-execution', 'high'],
            [/^(?:child_process\.)?(?:exec|execSync)$/, 'shell-command-execution', 'high'],
            [/\.query$/, 'review-database-query-parameterization', 'medium'],
          ];
          for (const [pattern, rule, severity] of rules) {
            if (pattern.test(expression)) {
              securityFindings.push({
                rule, severity, location: location(source, node, path),
                evidence: expression.slice(0, 120),
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    const symbols: CodeSymbol[] = [];
    for (const [name, declarations] of declared) {
      for (const declaration of declarations) {
        const declarationLocation = location(declaration.source, declaration.name, declaration.path);
        const symbolReferences = (references.get(name) || []).filter((item) =>
          item.path !== declarationLocation.path || item.line !== declarationLocation.line || item.column !== declarationLocation.column
        );
        symbols.push({
          id: crypto.createHash('sha256').update(`${declaration.path}:${declarationLocation.line}:${name}`).digest('hex').slice(0, 24),
          name, kind: symbolKind(declaration.node), exported: declaration.exported,
          declaration: declarationLocation, references: symbolReferences,
        });
      }
    }
    symbols.sort((a, b) => a.declaration.path.localeCompare(b.declaration.path) || a.declaration.line - b.declaration.line || a.name.localeCompare(b.name));

    return {
      schemaVersion: 'semantic-code-v1',
      languageServiceCompatible: true,
      symbols,
      duplicateCode: [...fingerprints.entries()]
        .filter(([, locations]) => locations.length > 1)
        .map(([fingerprint, locations]) => ({ fingerprint, locations }))
        .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
      possibleDeadExports: symbols.filter((symbol) => symbol.exported && symbol.references.length === 0),
      securityFindings,
      architecture: RepositoryArchitectureService.analyze(rawFiles),
      limitations: [
        'Análise estática não executa o código e pode exigir confirmação dinâmica.',
        'Referências com reflexão, geração de código, aliases externos ou resolução específica do bundler podem exigir um servidor LSP completo no worker.',
        'Achados de segurança são sinais para revisão, não prova automática de vulnerabilidade.',
      ],
    };
  }

  static definition(report: SemanticCodeReport, symbolName: string): CodeLocation[] {
    return report.symbols.filter((symbol) => symbol.name === symbolName).map((symbol) => symbol.declaration);
  }

  static references(report: SemanticCodeReport, symbolName: string): CodeLocation[] {
    return report.symbols.filter((symbol) => symbol.name === symbolName).flatMap((symbol) => symbol.references);
  }
}
