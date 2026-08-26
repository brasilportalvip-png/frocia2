const ALLOWED_STATES = new Set([
  'OPEN',
  'IN_PROGRESS',
  'FIXED_NOT_VERIFIED',
  'VERIFIED',
  'EXTERNAL_BLOCKER',
  'REJECTED'
]);

const REQUIRED_FIELDS = [
  'id',
  'section',
  'subsection',
  'requirement',
  'risk',
  'owner',
  'implementationFiles',
  'testFiles',
  'testNames',
  'command',
  'result',
  'commit',
  'environment',
  'evidence',
  'independentReviewer',
  'residualRisk',
  'state'
] as const;

const VERIFIED_REQUIRED_FIELDS = [
  'implementationFiles',
  'testFiles',
  'testNames',
  'command',
  'result',
  'commit',
  'environment',
  'evidence',
  'independentReviewer'
] as const;

type TrackerRow = Record<string, unknown>;

function hasEvidence(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(
      (item) =>
        typeof item === 'string' &&
        item.trim().length > 0
    );
  }

  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function fail(message: string): never {
  throw new Error(
    `Tracker inválido: ${message}`
  );
}

export function validateRequirementTracker(
  source: string
): {
  requirementCount: number;
  uniqueIdCount: number;
} {
  const lines = source
    .split(/\r?\n/)
    .filter(
      (line) => line.trim().length > 0
    );

  if (lines.length === 0) {
    fail('nenhum requisito foi registrado.');
  }

  const seenIds = new Set<string>();

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    let row: TrackerRow;

    try {
      row = JSON.parse(line) as TrackerRow;
    } catch {
      fail(
        `linha ${lineNumber} não contém JSON válido.`
      );
    }

    for (const field of REQUIRED_FIELDS) {
      if (!(field in row)) {
        fail(
          `linha ${lineNumber} não contém o campo ${field}.`
        );
      }
    }

    if (
      typeof row.id !== 'string' ||
      !/^PM-\d{2}-\d{3}$/.test(row.id)
    ) {
      fail(
        `linha ${lineNumber} possui ID inválido.`
      );
    }

    if (seenIds.has(row.id)) {
      fail(`ID duplicado ${row.id}.`);
    }
    seenIds.add(row.id);

    if (
      typeof row.requirement !== 'string' ||
      row.requirement.trim().length === 0
    ) {
      fail(`${row.id} não possui requisito.`);
    }

    if (
      typeof row.state !== 'string' ||
      !ALLOWED_STATES.has(row.state)
    ) {
      fail(
        `${row.id} possui estado não permitido.`
      );
    }

    for (const field of [
      'implementationFiles',
      'testFiles',
      'testNames'
    ]) {
      if (!Array.isArray(row[field])) {
        fail(
          `${row.id} exige uma lista no campo ${field}.`
        );
      }
    }

    if (row.state === 'VERIFIED') {
      for (
        const field of VERIFIED_REQUIRED_FIELDS
      ) {
        if (!hasEvidence(row[field])) {
          fail(
            `${row.id} não pode ser VERIFIED sem ${field}.`
          );
        }
      }

      if (
        row.owner === row.independentReviewer
      ) {
        fail(
          `${row.id} exige revisor independente do implementador.`
        );
      }

      if (
        typeof row.commit !== 'string' ||
        !/^[a-f0-9]{7,40}$/i.test(
          row.commit
        )
      ) {
        fail(
          `${row.id} não possui hash de commit válido.`
        );
      }
    }
  }

  return {
    requirementCount: lines.length,
    uniqueIdCount: seenIds.size
  };
}
