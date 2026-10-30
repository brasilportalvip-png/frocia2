import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { extractFileBlocks, sanitizeZipPath, shouldOfferZip } from '../src/services/codeBlocksParse.js';
import { buildZipBytes } from '../src/services/codeBlocksZip.js';

const message = [
  'Aqui estao os arquivos:', '',
  '**`src/App.tsx`**', '```tsx', 'export default function App() { return null; }', '```', '',
  '### server/index.ts', '```ts', 'console.log(1);', '```', '',
  '```json package.json', '{"name":"x"}', '```', '',
  '```bash', '// scripts/build.sh', 'echo ok', '```', '',
  'Arquivo: `../../etc/passwd`', '```txt', 'malicioso', '```', '',
  '**src/App.tsx**', '```tsx', 'duplicado', '```',
].join('\n');

describe('ZIP a partir dos blocos de codigo do chat', () => {
  it('identifica o caminho pelo titulo, pela cerca e pelo comentario', () => {
    const paths = extractFileBlocks(message).map(file => file.path);
    expect(paths).toContain('src/App.tsx');
    expect(paths).toContain('server/index.ts');
    expect(paths).toContain('package.json');
    expect(paths).toContain('scripts/build.sh');
  });

  it('nunca aceita caminho fora da pasta (zip-slip) e evita nomes repetidos', () => {
    const paths = extractFileBlocks(message).map(file => file.path);
    expect(paths.every(path => !path.includes('..') && !path.startsWith('/'))).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
    expect(sanitizeZipPath('../x')).toBeNull();
    expect(sanitizeZipPath('C:\\a.txt')).toBeNull();
    expect(sanitizeZipPath('./src/a.ts')).toBe('src/a.ts');
  });

  it('so oferece o botao quando faz sentido', () => {
    expect(shouldOfferZip(extractFileBlocks(message))).toBe(true);
    expect(shouldOfferZip(extractFileBlocks('```js\nlet a = 1;\n```'))).toBe(false);
    expect(shouldOfferZip(extractFileBlocks('`a/b.js`\n```js\nlet a = 1;\n```'))).toBe(true);
    expect(shouldOfferZip(extractFileBlocks('Sem codigo nenhum.'))).toBe(false);
  });

  it('gera um ZIP valido com o conteudo integro', () => {
    const files = extractFileBlocks(message);
    const unzipped = unzipSync(buildZipBytes(files));
    expect(strFromU8(unzipped['src/App.tsx'])).toContain('export default function App()');
    expect(strFromU8(unzipped['package.json'])).toContain('"name":"x"');
    expect(Object.keys(unzipped).length).toBe(files.length);
  });
});
