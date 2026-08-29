import { readFileSync } from 'node:fs';
import { MIGRATION_CATALOG, validateMigrationCatalog } from '../server/migrations/migrationCatalog.js';

const validation = validateMigrationCatalog();
if (!validation.valid) {
  console.error(validation.errors.join('\n'));
  process.exit(1);
}

const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as {
  indexes?: unknown[];
  fieldOverrides?: unknown[];
};
if (!Array.isArray(indexes.indexes) || !Array.isArray(indexes.fieldOverrides)) {
  throw new Error('firestore.indexes.json não possui estrutura válida.');
}

const rules = readFileSync('firestore.rules', 'utf8');
if (!rules.includes("rules_version = '2'")) {
  throw new Error('firestore.rules deve declarar rules_version 2.');
}

console.log(
  `Migrations válidas: ${MIGRATION_CATALOG.length}; versão alvo: ${MIGRATION_CATALOG.at(-1)?.version || 0}.`
);
