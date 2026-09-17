import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  evaluateRequiredReadiness,
  healthRouter,
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
  it('impede cache intermediário nos probes operacionais', async () => {
    const app = express();
    app.use('/api', healthRouter);
    const response = await request(app).get('/api/live');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.pragma).toBe('no-cache');
  });
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
