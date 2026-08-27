import fs from 'node:fs';
import path from 'node:path';

const roots = ['server', 'src', 'api'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

interface Violation {
  file: string;
  rule: string;
}

function filesIn(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(target);
    return extensions.has(path.extname(entry.name)) ? [target] : [];
  });
}

const files = [...roots.flatMap(filesIn), 'server.ts'].filter((file) => fs.existsSync(file));
const rules: Array<{ name: string; expression: RegExp }> = [
  { name: 'catch vazio', expression: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/m },
  { name: 'mock de teste em código de produção', expression: /\b(?:vi|jest)\.(?:fn|mock|spyOn)\b|mockResolvedValue|mockRejectedValue/m },
  { name: 'execução dinâmica insegura', expression: /\beval\s*\(|\bnew\s+Function\s*\(/m },
  { name: 'chave Google hardcoded', expression: /AIzaSy[A-Za-z0-9_-]{30,}/m },
  { name: 'token Mercado Pago hardcoded', expression: /APP_USR-[A-Za-z0-9_-]{20,}/m },
  { name: 'chave privada hardcoded', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/m },
];

const violations: Violation[] = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const rule of rules) {
    if (rule.expression.test(source)) violations.push({ file, rule: rule.name });
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`Integridade inválida: ${violation.file} — ${violation.rule}.`);
  }
  process.exit(1);
}

console.log(
  `Integridade de produção válida: ${files.length} arquivos sem catch vazio, mocks, execução dinâmica ou segredos hardcoded.`
);
