/**
 * Extrai arquivos de blocos de codigo em Markdown (``` ... ```) para o botao
 * "Baixar ZIP" do chat. Funcao pura, sem dependencias de navegador.
 */
export interface ExtractedFile {
  path: string;
  content: string;
  language: string;
  named: boolean;
}

const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  ts: 'ts', typescript: 'ts', tsx: 'tsx', js: 'js', javascript: 'js', jsx: 'jsx', mjs: 'mjs',
  json: 'json', html: 'html', css: 'css', scss: 'scss', py: 'py', python: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', cmd: 'cmd', bat: 'bat', batch: 'bat', powershell: 'ps1', ps1: 'ps1',
  md: 'md', markdown: 'md', yml: 'yml', yaml: 'yml', sql: 'sql', env: 'env', txt: 'txt', text: 'txt',
  xml: 'xml', java: 'java', go: 'go', rust: 'rs', rs: 'rs', php: 'php', ruby: 'rb', rb: 'rb',
  c: 'c', cpp: 'cpp', csharp: 'cs', cs: 'cs', vue: 'vue', svelte: 'svelte', diff: 'patch', patch: 'patch',
  toml: 'toml', ini: 'ini', dockerfile: 'Dockerfile',
};

const PATH_PATTERN =
  /(?:^|[\s`'"*(\[=])((?:\.{0,2}\/)?[A-Za-z0-9_@.\-]+(?:\/[A-Za-z0-9_@.\-]+)*\.[A-Za-z0-9]{1,10})(?=$|[\s`'"*)\]:,;])/;
const BARE_NAME_PATTERN = /(?:^|[\s`'"*(\[=])((?:Dockerfile|Makefile|Procfile|\.env(?:\.[A-Za-z0-9_-]+)?|\.gitignore|\.nvmrc))(?=$|[\s`'"*)\]:,;])/;
const COMMENT_PATH_PATTERN =
  /^\s*(?:\/\/|#|--|REM\s|\/\*|<!--|;)\s*(?:arquivo|file|caminho|path)?\s*:?\s*([A-Za-z0-9_@.\-\/]+\.[A-Za-z0-9]{1,10})\s*(?:\*\/|-->)?\s*$/i;

/** Remove caminhos perigosos (zip-slip) e normaliza separadores. */
export function sanitizeZipPath(raw: string): string | null {
  let value = (raw || '').trim().replace(/\\/g, '/');
  value = value.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
  if (!value || value.length > 200) return null;
  if (/[\u0000-\u001f:*?"<>|]/.test(value)) return null;
  const parts = value.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) return null;
  return parts.join('/');
}

function pathFromText(text: string): string | null {
  const match = text.match(PATH_PATTERN) || text.match(BARE_NAME_PATTERN);
  return match ? sanitizeZipPath(match[1]) : null;
}

function looksLikeFileHint(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 160) return false;
  return /[`*#]/.test(trimmed) || /\b(?:arquivo|file|caminho|path|crie|salve|substitua|altere|novo)\b/i.test(trimmed) || trimmed.length <= 80;
}

export function extractFileBlocks(markdown: string): ExtractedFile[] {
  const lines = (markdown || '').split(/\r?\n/);
  const files: ExtractedFile[] = [];
  const used = new Set<string>();
  let index = 0;
  let counter = 0;

  while (index < lines.length) {
    const open = lines[index].match(/^\s*(`{3,}|~{3,})\s*(.*)$/);
    if (!open) { index += 1; continue; }

    const marker = open[1];
    const info = open[2].trim();
    const body: string[] = [];
    let cursor = index + 1;
    let closed = false;
    while (cursor < lines.length) {
      const close = lines[cursor].match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === marker[0] && close[1].length >= marker.length) { closed = true; break; }
      body.push(lines[cursor]);
      cursor += 1;
    }

    const language = (info.split(/\s+/)[0] || '').toLowerCase().replace(/^\{?\.?/, '').replace(/[^a-z0-9+#-]/g, '');
    let path: string | null = null;

    // 1) informacao na cerca: ```ts src/App.tsx  |  ```ts title="src/App.tsx"
    const infoRest = info.split(/\s+/).slice(1).join(' ');
    if (infoRest) path = pathFromText(infoRest);
    // 2) comentario na primeira linha do bloco
    if (!path && body.length > 0) {
      const comment = body[0].match(COMMENT_PATH_PATTERN);
      if (comment) path = sanitizeZipPath(comment[1]);
    }
    // 3) linha de titulo logo antes do bloco
    if (!path) {
      for (let back = index - 1, seen = 0; back >= 0 && seen < 2; back -= 1) {
        if (!lines[back].trim()) continue;
        seen += 1;
        if (/^\s*(`{3,}|~{3,})/.test(lines[back])) break;
        if (looksLikeFileHint(lines[back])) { path = pathFromText(lines[back]); }
        break;
      }
    }

    const named = path !== null;
    if (!path) {
      counter += 1;
      const extension = EXTENSION_BY_LANGUAGE[language] || 'txt';
      path = extension === 'Dockerfile' ? 'Dockerfile' : `arquivo-${counter}.${extension}`;
    }

    let finalPath = path;
    for (let n = 2; used.has(finalPath); n += 1) {
      const dot = path.lastIndexOf('.');
      finalPath = dot > path.lastIndexOf('/') ? `${path.slice(0, dot)}-${n}${path.slice(dot)}` : `${path}-${n}`;
    }
    used.add(finalPath);

    if (body.length > 0 || closed) {
      files.push({ path: finalPath, content: body.join('\n').replace(/\s+$/, '') + '\n', language, named });
    }
    index = closed ? cursor + 1 : cursor;
  }
  return files;
}

/** O botao so aparece quando ha mais de um bloco ou um arquivo claramente nomeado. */
export function shouldOfferZip(files: ExtractedFile[]): boolean {
  return files.length >= 2 || (files.length === 1 && files[0].named);
}
