import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRequirementTracker } from '../server/selfEvolution/requirementTrackerValidator.js';

const trackerPath = resolve(
  process.cwd(),
  'audit-evidence/prompt-master-tracker.jsonl'
);
const result = validateRequirementTracker(
  readFileSync(trackerPath, 'utf8')
);

console.log(
  `Tracker válido: ${result.requirementCount} requisitos, ${result.uniqueIdCount} IDs únicos.`
);
