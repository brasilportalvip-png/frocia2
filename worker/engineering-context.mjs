import crypto from 'node:crypto';

const SOURCE = /\.(?:[cm]?[jt]sx?|json|ya?ml|md)$/i;

function normalize(value) {
  const path = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')) return null;
  return path;
}

function terms(task) {
  const ignored = new Set(['para', 'como', 'com', 'uma', 'que', 'the', 'and', 'from', 'this', 'de', 'do', 'da']);
  return [...new Set(Object.values(task).join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9_$-]{3,}/g)?.filter((term) => !ignored.has(term)) || [])].slice(0, 50);
}

function importSpecifiers(content) {
  const found = new Set();
  for (const pattern of [/\b(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const match of content.matchAll(pattern)) if (match[1].startsWith('.')) found.add(match[1]);
  }
  return [...found];
}

function resolveImport(from, specifier, paths) {
  const baseParts = from.split('/'); baseParts.pop();
  for (const part of specifier.split('/')) part === '..' ? baseParts.pop() : part !== '.' && baseParts.push(part);
  const base = baseParts.join('/');
  for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js']) {
    if (paths.has(`${base}${suffix}`)) return `${base}${suffix}`;
  }
  return null;
}

export function buildEngineeringContext(files, task, probableFiles = []) {
  const safe = new Map();
  for (const file of files) {
    const path = normalize(file.path);
    if (path && SOURCE.test(path) && typeof file.content === 'string' && Buffer.byteLength(file.content) <= 500_000) safe.set(path, file.content);
  }
  const paths = new Set(safe.keys());
  const imports = new Map(); const dependents = new Map();
  for (const [path, content] of safe) {
    const resolved = importSpecifiers(content).map((specifier) => resolveImport(path, specifier, paths)).filter(Boolean);
    imports.set(path, resolved);
    for (const target of resolved) {
      const list = dependents.get(target) || []; list.push(path); dependents.set(target, list);
    }
  }
  const query = terms(task); const probable = new Set(probableFiles.map(normalize).filter(Boolean));
  const ranked = [...safe].map(([path, content]) => {
    const haystack = `${path}\n${content}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let score = probable.has(path) ? 10000 : 0;
    for (const term of query) score += (path.toLowerCase().includes(term) ? 100 : 0) + Math.min(haystack.split(term).length - 1, 20) * 3;
    return { path, score };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const selected = new Set(ranked.slice(0, 30).map((row) => row.path));
  for (const path of [...selected]) for (const related of [...(imports.get(path) || []), ...(dependents.get(path) || [])]) if (selected.size < 45) selected.add(related);
  const selectedFiles = [...selected];
  const digest = crypto.createHash('sha256').update(JSON.stringify({ task, selectedFiles, query })).digest('hex');
  return {
    schemaVersion: 'engineering-context-v1', digest, queryTerms: query, selectedFiles,
    editablePaths: selectedFiles.filter((path) => !/(?:^|\/)(?:package-lock\.json|\.github\/|worker\/)/.test(path)),
    relatedTests: selectedFiles.filter((path) => /(?:^|\/)(?:tests?|e2e|__tests__)(?:\/|$)|\.(?:test|spec)\./.test(path)),
    sourceFiles: selectedFiles.map((path) => ({ path, content: safe.get(path) })),
    rootCauseQuestions: ['Qual teste reproduz a falha?', 'Qual contrato foi violado?', 'Quais dependentes podem regredir?', 'A alteração trata causa ou apenas sintoma?'],
  };
}
