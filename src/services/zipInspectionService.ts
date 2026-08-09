import { unzipSync } from 'fflate';
import { ZipProjectAnalysis } from '../types';

const MAX_ARCHIVE_BYTES = 10_000_000;
const MAX_ENTRIES = 1_500;
const MAX_UNCOMPRESSED_BYTES = 25_000_000;
const MAX_SINGLE_FILE_BYTES = 2_000_000;
const MAX_COMPRESSION_RATIO = 150;
const MAX_TREE_ITEMS = 500;
const MAX_EXTRACTED_TEXT_BYTES = 350_000;
const MAX_TEXT_FILE_BYTES = 100_000;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'json', 'jsonc', 'yaml', 'yml',
  'xml', 'toml', 'ini', 'env', 'example', 'sql', 'py', 'java', 'go', 'rs',
  'php', 'rb', 'sh', 'ps1', 'dockerfile', 'gitignore'
]);

const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'dll', 'com', 'scr', 'msi', 'bat', 'cmd', 'jar', 'apk', 'app',
  'dmg', 'iso', 'so', 'dylib'
]);

interface CentralDirectoryEntry {
  path: string;
  isDir: boolean;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ZipExtractedTextFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface RealZipProjectAnalysis extends ZipProjectAnalysis {
  archiveSizeBytes: number;
  uncompressedSizeBytes: number;
  totalEntries: number;
  treeTruncated: boolean;
  extractedTextFiles: ZipExtractedTextFile[];
  staticAnalysisOnly: true;
  securityChecks: {
    pathTraversalBlocked: true;
    encryptedEntriesBlocked: true;
    symbolicLinksBlocked: true;
    zipBombLimitsApplied: true;
    codeExecuted: false;
  };
}

export class ZipInspectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ZipInspectionError';
    this.code = code;
  }
}

function decodeBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value.replace(/\s/g, ''));
  } catch {
    throw new ZipInspectionError('invalid_base64', 'O conteúdo do ZIP está corrompido.');
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new ZipInspectionError('invalid_zip', 'O arquivo não possui uma estrutura ZIP válida.');
}

function normalizeArchivePath(rawPath: string): string {
  if (
    !rawPath ||
    rawPath.length > 240 ||
    rawPath.includes('\0') ||
    rawPath.includes('\\') ||
    rawPath.startsWith('/') ||
    /^[A-Za-z]:/.test(rawPath)
  ) {
    throw new ZipInspectionError('unsafe_path', 'O ZIP contém um caminho de arquivo inseguro.');
  }

  const parts = rawPath.split('/');
  if (parts.some((part) => part === '..' || part === '.')) {
    throw new ZipInspectionError('path_traversal', 'O ZIP contém tentativa de path traversal.');
  }

  return parts.filter(Boolean).join('/') + (rawPath.endsWith('/') ? '/' : '');
}

function readCentralDirectory(bytes: Uint8Array): CentralDirectoryEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new ZipInspectionError('multidisk_zip', 'Arquivos ZIP divididos em partes não são aceitos.');
  }

  if (
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new ZipInspectionError('zip64_not_supported', 'ZIP64 não é aceito nesta inspeção.');
  }

  if (totalEntries === 0 || totalEntries > MAX_ENTRIES) {
    throw new ZipInspectionError(
      'invalid_entry_count',
      `O ZIP deve conter entre 1 e ${MAX_ENTRIES.toLocaleString('pt-BR')} entradas.`
    );
  }

  if (centralOffset + centralSize > eocdOffset || centralOffset < 0) {
    throw new ZipInspectionError('invalid_central_directory', 'O diretório central do ZIP está corrompido.');
  }

  const entries: CentralDirectoryEntry[] = [];
  const seenPaths = new Set<string>();
  let offset = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new ZipInspectionError('invalid_central_entry', 'Uma entrada do ZIP está corrompida.');
    }

    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;

    if (nextOffset > bytes.length || nameLength === 0) {
      throw new ZipInspectionError('invalid_entry_name', 'O ZIP contém uma entrada inválida.');
    }
    if ((flags & 0x1) !== 0) {
      throw new ZipInspectionError('encrypted_entry', 'ZIPs protegidos por senha não são aceitos.');
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new ZipInspectionError('unsupported_compression', 'O ZIP utiliza um método de compressão não aceito.');
    }

    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const rawPath = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes);
    const path = normalizeArchivePath(rawPath);
    const isDir = path.endsWith('/');
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      throw new ZipInspectionError('symbolic_link', 'O ZIP contém link simbólico, que não é aceito.');
    }

    const comparisonPath = path.toLowerCase();
    if (seenPaths.has(comparisonPath)) {
      throw new ZipInspectionError('duplicate_path', 'O ZIP contém caminhos duplicados ou ambíguos.');
    }
    seenPaths.add(comparisonPath);

    if (!isDir) {
      if (uncompressedSize > MAX_SINGLE_FILE_BYTES) {
        throw new ZipInspectionError('entry_too_large', `O arquivo “${path}” excede 2 MB descompactado.`);
      }
      if (uncompressedSize > 0 && compressedSize === 0) {
        throw new ZipInspectionError('suspicious_ratio', 'O ZIP apresenta uma taxa de compressão insegura.');
      }
      if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) {
        throw new ZipInspectionError('suspicious_ratio', 'O ZIP apresenta possível bomba de descompressão.');
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
        throw new ZipInspectionError('archive_expands_too_much', 'O ZIP excede 25 MB após descompactado.');
      }
    }

    entries.push({ path, isDir, compressedSize, uncompressedSize });
    offset = nextOffset;
  }

  return entries;
}

function extensionOf(path: string): string {
  const name = path.split('/').at(-1)?.toLowerCase() || '';
  if (name === 'dockerfile') return 'dockerfile';
  if (name === '.gitignore') return 'gitignore';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}

function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0)) return null;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function detectStack(paths: string[], packageJson: Record<string, unknown> | null): string[] {
  const lowerPaths = new Set(paths.map((path) => path.toLowerCase()));
  const packageDependencies = {
    ...((packageJson?.dependencies as Record<string, unknown> | undefined) || {}),
    ...((packageJson?.devDependencies as Record<string, unknown> | undefined) || {})
  };
  const stack = new Set<string>();

  if ('react' in packageDependencies || paths.some((path) => /\.(jsx|tsx)$/i.test(path))) stack.add('React');
  if ('vue' in packageDependencies || lowerPaths.has('vue.config.js')) stack.add('Vue');
  if ('next' in packageDependencies || lowerPaths.has('next.config.js') || lowerPaths.has('next.config.mjs')) stack.add('Next.js');
  if ('vite' in packageDependencies || paths.some((path) => /^vite\.config\./i.test(path))) stack.add('Vite');
  if ('typescript' in packageDependencies || paths.some((path) => /\.(ts|tsx)$/i.test(path))) stack.add('TypeScript');
  if ('tailwindcss' in packageDependencies || paths.some((path) => /^tailwind\.config\./i.test(path))) stack.add('Tailwind CSS');
  if ('express' in packageDependencies) stack.add('Express');
  if ('firebase' in packageDependencies || 'firebase-admin' in packageDependencies) stack.add('Firebase');
  if (lowerPaths.has('requirements.txt') || lowerPaths.has('pyproject.toml')) stack.add('Python');
  if (lowerPaths.has('go.mod')) stack.add('Go');
  if (lowerPaths.has('cargo.toml')) stack.add('Rust');
  if (lowerPaths.has('dockerfile') || lowerPaths.has('docker-compose.yml')) stack.add('Docker');

  return [...stack];
}

function findEntryPoints(paths: string[]): string[] {
  const candidates = [
    'index.html', 'src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx',
    'src/App.tsx', 'src/App.jsx', 'server.ts', 'server.js', 'app.ts', 'app.js',
    'pages/index.tsx', 'app/page.tsx', 'main.py', 'manage.py', 'Dockerfile'
  ];
  const pathMap = new Map(paths.map((path) => [path.toLowerCase(), path]));
  return candidates.map((candidate) => pathMap.get(candidate.toLowerCase())).filter((path): path is string => Boolean(path));
}

function collectEnvironmentVariables(files: ZipExtractedTextFile[]): string[] {
  const names = new Set<string>();
  const expressions = [
    /(?:process\.env\.|import\.meta\.env\.)([A-Z][A-Z0-9_]*)/g,
    /^\s*([A-Z][A-Z0-9_]*)\s*=/gm
  ];

  for (const file of files) {
    for (const expression of expressions) {
      for (const match of file.content.matchAll(expression)) names.add(match[1]);
    }
  }
  return [...names].sort().slice(0, 100);
}

function findPossibleSecrets(files: ZipExtractedTextFile[]): RealZipProjectAnalysis['secretsExposed'] {
  const findings: RealZipProjectAnalysis['secretsExposed'] = [];
  const patterns = [
    { type: 'Chave privada', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
    { type: 'Token GitHub', expression: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/i },
    { type: 'Token AWS', expression: /\bAKIA[0-9A-Z]{16}\b/ },
    { type: 'Segredo configurado', expression: /(?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]/i }
  ];

  for (const file of files) {
    const lines = file.content.split('\n');
    for (let index = 0; index < lines.length && findings.length < 50; index += 1) {
      for (const pattern of patterns) {
        if (pattern.expression.test(lines[index])) {
          findings.push({
            file: file.path,
            line: index + 1,
            type: pattern.type,
            snippet: '[CONTEÚDO SENSÍVEL OCULTADO]'
          });
          break;
        }
      }
    }
  }
  return findings;
}

function packageManifest(files: ZipExtractedTextFile[]): Record<string, unknown> | null {
  const manifest = files.find((file) => file.path.toLowerCase() === 'package.json');
  if (!manifest) return null;
  try {
    const parsed = JSON.parse(manifest.content);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export class ZipInspectionService {
  static inspect(input: { fileName: string; contentBase64: string }): RealZipProjectAnalysis {
    const archiveBytes = decodeBase64(input.contentBase64);
    if (archiveBytes.length === 0 || archiveBytes.length > MAX_ARCHIVE_BYTES) {
      throw new ZipInspectionError('archive_size', 'O ZIP está vazio ou excede o limite de 10 MB.');
    }

    const entries = readCentralDirectory(archiveBytes);
    let extracted: Record<string, Uint8Array>;
    try {
      extracted = unzipSync(archiveBytes);
    } catch {
      throw new ZipInspectionError('decompression_failed', 'Não foi possível descompactar o ZIP com segurança.');
    }

    const extractedTextFiles: ZipExtractedTextFile[] = [];
    let extractedTextBytes = 0;
    for (const entry of entries) {
      if (entry.isDir || !isTextPath(entry.path)) continue;
      const fileBytes = extracted[entry.path];
      if (!fileBytes) continue;
      const remaining = MAX_EXTRACTED_TEXT_BYTES - extractedTextBytes;
      if (remaining <= 0) break;
      const allowedBytes = Math.min(fileBytes.length, MAX_TEXT_FILE_BYTES, remaining);
      const content = decodeText(fileBytes.subarray(0, allowedBytes));
      if (content === null) continue;
      extractedTextFiles.push({
        path: entry.path,
        content,
        truncated: allowedBytes < fileBytes.length
      });
      extractedTextBytes += allowedBytes;
    }

    const filePaths = entries.filter((entry) => !entry.isDir).map((entry) => entry.path);
    const manifest = packageManifest(extractedTextFiles);
    const dependencies = {
      ...((manifest?.dependencies as Record<string, unknown> | undefined) || {}),
      ...((manifest?.devDependencies as Record<string, unknown> | undefined) || {})
    };
    const detectedStack = detectStack(filePaths, manifest);
    const envVars = collectEnvironmentVariables(extractedTextFiles);
    const secretsExposed = findPossibleSecrets(extractedTextFiles);
    const dangerousFiles = filePaths.filter((path) => DANGEROUS_EXTENSIONS.has(extensionOf(path)));
    const scripts = (manifest?.scripts as Record<string, unknown> | undefined) || {};
    const lifecycleScripts = ['preinstall', 'install', 'postinstall'].filter((name) => typeof scripts[name] === 'string');
    const vulnerabilities: RealZipProjectAnalysis['vulnerabilities'] = [];

    if (dangerousFiles.length > 0) {
      vulnerabilities.push({
        severity: 'alta',
        title: `${dangerousFiles.length} arquivo(s) executável(is) encontrado(s)`,
        fix: 'Revise e remova executáveis não confiáveis antes de usar o projeto.'
      });
    }
    if (secretsExposed.length > 0) {
      vulnerabilities.push({
        severity: 'alta',
        title: `${secretsExposed.length} possível(is) segredo(s) encontrado(s)`,
        fix: 'Revogue os segredos reais e substitua-os por variáveis de ambiente.'
      });
    }
    if (lifecycleScripts.length > 0) {
      vulnerabilities.push({
        severity: 'media',
        title: `Scripts automáticos de instalação: ${lifecycleScripts.join(', ')}`,
        fix: 'Revise os scripts antes de executar npm install.'
      });
    }

    const uncompressedSizeBytes = entries.reduce((sum, entry) => sum + (entry.isDir ? 0 : entry.uncompressedSize), 0);
    const stackDescription = detectedStack.length > 0 ? detectedStack.join(', ') : 'stack não determinada pelos arquivos estáticos';

    return {
      fileName: input.fileName,
      fileTree: entries.slice(0, MAX_TREE_ITEMS).map((entry) => ({
        path: entry.path,
        isDir: entry.isDir,
        size: entry.isDir ? undefined : entry.uncompressedSize
      })),
      detectedStack,
      entryPoints: findEntryPoints(filePaths),
      dependenciesCount: Object.keys(dependencies).length,
      envVars,
      secretsExposed,
      vulnerabilities,
      architectureSummary: `Inspeção estática real de ${filePaths.length} arquivos. Tecnologias identificadas: ${stackDescription}. Nenhum código do ZIP foi executado.`,
      buildStatus: 'nao_testado',
      sandboxLogs: [
        'Estrutura central do ZIP validada.',
        'Limites contra ZIP bomb aplicados antes da descompactação.',
        `${extractedTextFiles.length} arquivo(s) textual(is) extraído(s) para análise.`,
        'Build não executado: esta etapa realiza somente inspeção estática segura.'
      ],
      archiveSizeBytes: archiveBytes.length,
      uncompressedSizeBytes,
      totalEntries: entries.length,
      treeTruncated: entries.length > MAX_TREE_ITEMS,
      extractedTextFiles,
      staticAnalysisOnly: true,
      securityChecks: {
        pathTraversalBlocked: true,
        encryptedEntriesBlocked: true,
        symbolicLinksBlocked: true,
        zipBombLimitsApplied: true,
        codeExecuted: false
      }
    };
  }
}