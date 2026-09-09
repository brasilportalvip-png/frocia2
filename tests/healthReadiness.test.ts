import { describe, expect, it } from 'vitest';
import {
  evaluateRequiredReadiness,
  RequiredReadinessChecks,
} from '../server/routes/healthRoutes.js';

const allRequiredChecks: RequiredReadinessChecks = {
  firebaseAdminConfigured: true,
  firestoreReachable: true,
  geminiConfigured: true,
  mercadoPagoConfigured: true,
  internalMaintenanceConfigured: true,
  automaticBackupConfigured: true,
  migrationsCurrent: true,
};

describe('production readiness policy', () => {
  it('declares readiness only when every production dependency is available', () => {
    expect(evaluateRequiredReadiness(allRequiredChecks)).toBe(true);
  });

  it.each(Object.keys(allRequiredChecks) as Array<keyof RequiredReadinessChecks>)(
    'blocks readiness when %s is unavailable',
    (dependency) => {
      expect(
        evaluateRequiredReadiness({
          ...allRequiredChecks,
          [dependency]: false,
        })
      ).toBe(false);
    }
  );
});
