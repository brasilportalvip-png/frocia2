// Gera server/forja/kit/siteKitSource.ts a partir de siteKit.source.txt (o servidor da Vercel
// não lê arquivos soltos, então o kit vai embutido como texto). Rode: node scripts/build-site-kit.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync(new URL('../server/forja/kit/siteKit.source.txt', import.meta.url), 'utf8');
const out =
  '// Arquivo gerado por scripts/build-site-kit.mjs a partir de siteKit.source.txt. Não edite à mão.\n' +
  'export const SITE_KIT_SOURCE: string = ' + JSON.stringify(source) + ';\n';
writeFileSync(new URL('../server/forja/kit/siteKitSource.ts', import.meta.url), out);
console.log('siteKitSource.ts gerado (' + source.length + ' caracteres).');
