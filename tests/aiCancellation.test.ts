import {
  describe,
  expect,
  it
} from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ExecutionAbortRegistry
} from '../server/ai/executionAbortRegistry.js';

describe(
  'AI cancellation and timeout protection',
  () => {
    it(
      'registers and cancels an active execution',
      () => {
        const executionId =
          `execution-${Date.now()}`;

        const signal =
          ExecutionAbortRegistry.register(
            executionId
          );

        expect(signal.aborted).toBe(false);

        const cancelled =
          ExecutionAbortRegistry.cancel(
            executionId,
            'Cancelamento de teste'
          );

        expect(cancelled).toBe(true);
        expect(signal.aborted).toBe(true);
      }
    );

    it(
      'returns false when execution is not active',
      () => {
        const cancelled =
          ExecutionAbortRegistry.cancel(
            'execution-not-found'
          );

        expect(cancelled).toBe(false);
      }
    );

    it(
      'clears an execution without aborting it',
      () => {
        const executionId =
          `clear-${Date.now()}`;

        const signal =
          ExecutionAbortRegistry.register(
            executionId
          );

        ExecutionAbortRegistry.clear(
          executionId
        );

        expect(signal.aborted).toBe(false);

        expect(
          ExecutionAbortRegistry.cancel(
            executionId
          )
        ).toBe(false);
      }
    );

    it(
      'keeps backend timeout and cancellation connected',
      () => {
        const routeSource =
          fs.readFileSync(
            path.resolve(
              process.cwd(),
              'server/routes/aiRoutes.ts'
            ),
            'utf8'
          );

        expect(routeSource).toContain(
          'ExecutionAbortRegistry.register'
        );

        expect(routeSource).toContain(
          'streamModelConfig.timeoutMs'
        );

        expect(routeSource).toContain(
          'requestAbortController.signal'
        );

        expect(routeSource).toContain(
          'releaseReservation'
        );
      }
    );

    it(
      'keeps frontend stop button connected to request abort',
      () => {
        const appSource =
          fs.readFileSync(
            path.resolve(
              process.cwd(),
              'src/App.tsx'
            ),
            'utf8'
          );

        const clientSource =
          fs.readFileSync(
            path.resolve(
              process.cwd(),
              'src/services/apiClient.ts'
            ),
            'utf8'
          );

        expect(appSource).toContain(
          'activeRequestControllerRef'
        );

        expect(appSource).toContain(
          'onStopGeneration={handleStopGeneration}'
        );

        expect(clientSource).toContain(
          "'request_aborted'"
        );
      }
    );
  }
);