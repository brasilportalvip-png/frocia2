import { posix as path } from 'node:path';

export interface RepositorySourceFile {
  path: string;
  content?: string;
}

export interface RepositoryModule {
  path: string;
  layer: RepositoryLayer;
  imports: string[];
  dependents: string[];
}

export type RepositoryLayer =
  | 'api'
  | 'application'
  | 'configuration'
  | 'data'
  | 'domain'
  | 'infrastructure'
  | 'presentation'
  | 'tests'
  | 'unknown';

export interface RepositoryImportEdge {
  from: string;
  to: string;
}

export interface RepositoryImpactReport {
  requestedPaths: string[];
  matchedPaths: string[];
  directlyAffected: string[];
  transitivelyAffected: string[];
  unresolvedPaths: string[];
}

export interface RepositoryArchitectureReport {
  stacks: string[];
  manifests: string[];
  configs: string[];
  entrypoints: string[];
  layers: Record<RepositoryLayer, string[]>;
  modules: RepositoryModule[];
  importGraph: RepositoryImportEdge[];
  risks: string[];
  limitations: string[];
  impact: RepositoryImpactReport;
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/i;
const RESOLUTION_EXTENSIONS = [
  '', '.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
] as const;

const MANIFEST_NAMES = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'deno.json', 'deno.jsonc', 'composer.json', 'pyproject.toml',
  'requirements.txt', 'cargo.toml', 'go.mod', 'gemfile',
]);

const CONFIG_PATTERNS = [
  /(^|\/)tsconfig(?:\.[^/]+)?\.json$/i,
  /(^|\/)(?:vite|vitest|webpack|rollup|next|nuxt|jest|playwright|eslint|prettier)\.config\.[^/]+$/i,
  /(^|\/)dockerfile$/i,
  /(^|\/)docker-compose\.ya?ml$/i,
  /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i,
  /(^|\/)vercel\.json$/i,
];

const ENTRYPOINT_PATTERNS = [
  /(^|\/)(?:src\/)?(?:main|index|server|app)\.[cm]?[jt]sx?$/i,
  /(^|\/)api\/index\.[cm]?[jt]s$/i,
];

const EMPTY_LAYERS = (): Record<RepositoryLayer, string[]> => ({
  api: [], application: [], configuration: [], data: [], domain: [],
  infrastructure: [], presentation: [], tests: [], unknown: [],
});

function normalizeSafePath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    !normalized || normalized.length > 300 || normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) || normalized.includes('\0')
  ) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part === '.git')) {
    return null;
  }
  return normalized;
}

function classifyLayer(filePath: string): RepositoryLayer {
  const normalized = `/${filePath.toLowerCase()}/`;
  if (/\/(?:tests?|__tests__|e2e|spec)\//.test(normalized) || /\.(?:test|spec)\.[^/]+\/$/.test(normalized)) return 'tests';
  if (/\/(?:components?|pages?|views?|ui|frontend|client)\//.test(normalized) || /\/(?:app|main)\.[cm]?[jt]sx?\/$/.test(normalized)) return 'presentation';
  if (/\/(?:routes?|api|controllers?)\//.test(normalized)) return 'api';
  if (/\/(?:domain|entities|models?)\//.test(normalized)) return 'domain';
  if (/\/(?:repositories|database|db|persistence|migrations?)\//.test(normalized)) return 'data';
  if (/\/(?:infra|infrastructure|adapters?|providers?)\//.test(normalized)) return 'infrastructure';
  if (/\/(?:services?|use-cases?|usecases|application)\//.test(normalized)) return 'application';
  if (/\/(?:config|configuration)\//.test(normalized) || CONFIG_PATTERNS.some((pattern) => pattern.test(filePath))) return 'configuration';
  return 'unknown';
}

function extractSpecifiers(content: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[^'";]*?\s+from\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) found.add(match[1]);
  }
  return [...found].sort();
}

function resolveInternalImport(from: string, specifier: string, paths: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(from), specifier));
  if (base.startsWith('../') || base === '..') return null;
  for (const extension of RESOLUTION_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (paths.has(candidate)) return candidate;
  }
  return null;
}

function detectStacks(files: Map<string, string | undefined>): string[] {
  const stacks = new Set<string>();
  const packageJson = files.get('package.json');
  let dependencies = new Set<string>();
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      dependencies = new Set([...Object.keys(parsed.dependencies || {}), ...Object.keys(parsed.devDependencies || {})]);
      stacks.add('Node.js');
    } catch {
      // Conteúdo importado é dado não confiável; JSON inválido não é executado.
    }
  }
  const packageStacks: Array<[string, string]> = [
    ['react', 'React'], ['next', 'Next.js'], ['vue', 'Vue'], ['@angular/core', 'Angular'],
    ['express', 'Express'], ['fastify', 'Fastify'], ['vite', 'Vite'], ['vitest', 'Vitest'],
    ['typescript', 'TypeScript'], ['firebase', 'Firebase'], ['firebase-admin', 'Firebase Admin'],
    ['prisma', 'Prisma'], ['@prisma/client', 'Prisma'], ['tailwindcss', 'Tailwind CSS'],
  ];
  for (const [dependency, label] of packageStacks) if (dependencies.has(dependency)) stacks.add(label);
  const allPaths = [...files.keys()];
  if (allPaths.some((item) => /\.tsx?$/i.test(item))) stacks.add('TypeScript');
  if (allPaths.some((item) => /\.jsx?$/i.test(item))) stacks.add('JavaScript');
  if (allPaths.some((item) => /\.py$/i.test(item))) stacks.add('Python');
  if (allPaths.some((item) => /\.go$/i.test(item))) stacks.add('Go');
  if (allPaths.some((item) => /\.rs$/i.test(item))) stacks.add('Rust');
  if (files.has('dockerfile') || allPaths.some((item) => /(^|\/)dockerfile$/i.test(item))) stacks.add('Docker');
  return [...stacks].sort();
}

function impactReport(
  requested: string[],
  allPaths: Set<string>,
  dependents: Map<string, Set<string>>,
): RepositoryImpactReport {
  const normalizedRequests = [...new Set(requested.map(normalizeSafePath).filter((item): item is string => Boolean(item)))].sort();
  const matched = normalizedRequests.filter((item) => allPaths.has(item));
  const unresolved = normalizedRequests.filter((item) => !allPaths.has(item));
  const direct = new Set<string>();
  for (const item of matched) for (const dependent of dependents.get(item) || []) direct.add(dependent);
  const transitive = new Set<string>();
  const queue = [...direct];
  while (queue.length) {
    const current = queue.shift()!;
    for (const dependent of dependents.get(current) || []) {
      if (!direct.has(dependent) && !transitive.has(dependent) && !matched.includes(dependent)) {
        transitive.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return {
    requestedPaths: normalizedRequests,
    matchedPaths: matched,
    directlyAffected: [...direct].sort(),
    transitivelyAffected: [...transitive].sort(),
    unresolvedPaths: unresolved,
  };
}

export class RepositoryArchitectureService {
  static analyze(files: RepositorySourceFile[], impactPaths: string[] = []): RepositoryArchitectureReport {
    const safeFiles = new Map<string, string | undefined>();
    let unsafePaths = 0;
    let duplicatePaths = 0;
    for (const file of files) {
      const safePath = normalizeSafePath(file.path);
      if (!safePath) {
        unsafePaths += 1;
        continue;
      }
      if (safeFiles.has(safePath)) {
        duplicatePaths += 1;
        continue;
      }
      safeFiles.set(safePath, typeof file.content === 'string' ? file.content : undefined);
    }

    const allPaths = new Set(safeFiles.keys());
    const sourcePaths = [...allPaths].filter((item) => SOURCE_EXTENSION.test(item)).sort();
    const imports = new Map<string, Set<string>>();
    const dependents = new Map<string, Set<string>>();
    const edges: RepositoryImportEdge[] = [];
    for (const sourcePath of sourcePaths) {
      const resolved = new Set<string>();
      const content = safeFiles.get(sourcePath);
      if (content) {
        for (const specifier of extractSpecifiers(content)) {
          const target = resolveInternalImport(sourcePath, specifier, allPaths);
          if (target) resolved.add(target);
        }
      }
      imports.set(sourcePath, resolved);
      for (const target of resolved) {
        if (!dependents.has(target)) dependents.set(target, new Set());
        dependents.get(target)!.add(sourcePath);
        edges.push({ from: sourcePath, to: target });
      }
    }
    edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));

    const layers = EMPTY_LAYERS();
    for (const filePath of [...allPaths].sort()) layers[classifyLayer(filePath)].push(filePath);
    const modules = sourcePaths.map((filePath) => ({
      path: filePath,
      layer: classifyLayer(filePath),
      imports: [...(imports.get(filePath) || [])].sort(),
      dependents: [...(dependents.get(filePath) || [])].sort(),
    }));

    const risks: string[] = [];
    if (unsafePaths) risks.push(`${unsafePaths} caminho(s) inseguro(s) foram ignorados.`);
    if (duplicatePaths) risks.push(`${duplicatePaths} caminho(s) duplicado(s) foram ignorados.`);
    if (files.some((file) => file.content === undefined)) risks.push('Há arquivos sem conteúdo; a análise de dependências pode estar incompleta.');
    const limitations = [
      'Conteúdo do repositório é tratado exclusivamente como dado não confiável e nunca como instrução executável.',
      'O grafo cobre apenas imports relativos estáticos de arquivos JavaScript e TypeScript disponíveis na entrada.',
      'Aliases, imports calculados, resolução específica de bundlers e dependências em arquivos ausentes podem não ser resolvidos.',
    ];

    const sortedPaths = [...allPaths].sort();
    return {
      stacks: detectStacks(safeFiles),
      manifests: sortedPaths.filter((item) => MANIFEST_NAMES.has(item.toLowerCase())),
      configs: sortedPaths.filter((item) => CONFIG_PATTERNS.some((pattern) => pattern.test(item))),
      entrypoints: sortedPaths.filter((item) => ENTRYPOINT_PATTERNS.some((pattern) => pattern.test(item))),
      layers,
      modules,
      importGraph: edges,
      risks,
      limitations,
      impact: impactReport(impactPaths, allPaths, dependents),
    };
  }
}
