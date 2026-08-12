import {
  readFileSync
} from 'node:fs';
import {
  describe,
  expect,
  it
} from 'vitest';

function readProjectFile(
  relativePath: string
): string {
  return readFileSync(
    new URL(
      `../${relativePath}`,
      import.meta.url
    ),
    'utf8'
  );
}

describe(
  'Production readiness critical protections',
  () => {
    it(
      'does not publish the backend source map',
      () => {
        const packageJson = JSON.parse(
          readProjectFile('package.json')
        );

        expect(
          packageJson.scripts.build
        ).not.toContain('--sourcemap');

        expect(
          packageJson.scripts.build
        ).toContain(
          '--outfile=dist/server.js'
        );
      }
    );

    it(
      'configures both Vercel API functions with 60 seconds',
      () => {
        const indexApi =
          readProjectFile('api/index.ts');

        const dynamicApi =
          readProjectFile(
            'api/[...path].ts'
          );

        expect(indexApi).toMatch(
          /export\s+const\s+maxDuration\s*=\s*60/
        );

        expect(dynamicApi).toMatch(
          /export\s+const\s+maxDuration\s*=\s*60/
        );
      }
    );

    it(
      'keeps the required Firestore indexes',
      () => {
        const indexConfig = JSON.parse(
          readProjectFile(
            'firestore.indexes.json'
          )
        );

        const indexes =
          indexConfig.indexes as Array<{
            collectionGroup: string;
            fields: Array<{
              fieldPath: string;
              order: string;
            }>;
          }>;

        const hasRecentMessagesIndex =
          indexes.some(
            (index) =>
              index.collectionGroup ===
                'messages' &&
              index.fields.some(
                (field) =>
                  field.fieldPath ===
                    'conversationId' &&
                  field.order ===
                    'ASCENDING'
              ) &&
              index.fields.some(
                (field) =>
                  field.fieldPath ===
                    'userId' &&
                  field.order ===
                    'ASCENDING'
              ) &&
              index.fields.some(
                (field) =>
                  field.fieldPath ===
                    'createdAt' &&
                  field.order ===
                    'DESCENDING'
              )
          );

        const hasExpiredReservationsIndex =
          indexes.some(
            (index) =>
              index.collectionGroup ===
                'credit_reservations' &&
              index.fields.some(
                (field) =>
                  field.fieldPath ===
                    'status' &&
                  field.order ===
                    'ASCENDING'
              ) &&
              index.fields.some(
                (field) =>
                  field.fieldPath ===
                    'expiresAt' &&
                  field.order ===
                    'ASCENDING'
              )
          );

        expect(
          hasRecentMessagesIndex
        ).toBe(true);

        expect(
          hasExpiredReservationsIndex
        ).toBe(true);
      }
    );

    it(
      'keeps backup projects and bounded RAG retrieval',
      () => {
        const recoverySource =
          readProjectFile(
            'server/services/portableRecoveryService.ts'
          );

        const ragSource =
          readProjectFile(
            'server/ai/ragService.ts'
          );

        expect(
          recoverySource
        ).toMatch(
          /PORTABLE_BACKUP_COLLECTIONS[\s\S]*['"]projects['"]/
        );

        expect(ragSource).toContain(
          'MAX_RETRIEVAL_CANDIDATES'
        );

        expect(ragSource).toMatch(
          /\.limit\(MAX_RETRIEVAL_CANDIDATES\)/
        );

        expect(ragSource).toContain(
          'EMBEDDING_CONCURRENCY'
        );

        expect(ragSource).toContain(
          'adminDb.batch()'
        );
      }
    );

    it(
      'prevents false self-evolution success',
      () => {
        const policySource =
          readProjectFile(
            'server/selfEvolution/selfEvolutionPolicyEngine.ts'
          );

        const orchestratorSource =
          readProjectFile(
            'server/selfEvolution/selfEvolutionOrchestrator.ts'
          );

        const rollbackSource =
          readProjectFile(
            'server/selfEvolution/rollbackService.ts'
          );

        const githubSource =
          readProjectFile(
            'server/selfEvolution/githubAutomationService.ts'
          );

        expect(policySource).toContain(
          'isSelfEvolutionEnabledPersisted'
        );

        expect(orchestratorSource).toContain(
          'isSelfEvolutionEnabledPersisted'
        );

        expect(orchestratorSource).toMatch(
          /createBranchAndPR\s*\(\s*candidate,\s*patch\s*\)/
        );

        expect(rollbackSource).toContain(
          'nenhuma reversão foi executada'
        );

        expect(githubSource).toContain(
          '/git/blobs'
        );

        expect(githubSource).toContain(
          '/git/trees'
        );

        expect(githubSource).toContain(
          '/git/commits'
        );

        expect(githubSource).toContain(
          'createdCommitSha'
        );
      }
    );

    it(
      'documents production integrations without real secrets',
      () => {
        const environmentExample =
          readProjectFile('.env.example');

        const requiredVariables = [
          'GEMINI_API_KEY',
          'FIREBASE_SERVICE_ACCOUNT_KEY',
          'VITE_FIREBASE_API_KEY',
          'MERCADO_PAGO_ACCESS_TOKEN',
          'MERCADO_PAGO_PUBLIC_KEY',
          'MERCADO_PAGO_WEBHOOK_SECRET',
          'INTERNAL_CRON_SECRET'
        ];

        for (
          const variable of
          requiredVariables
        ) {
          expect(
            environmentExample
          ).toContain(`${variable}=`);
        }

        expect(
          environmentExample
        ).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);

        expect(
          environmentExample
        ).not.toMatch(/APP_USR-[0-9A-Za-z_-]+/);

        expect(
          environmentExample
        ).not.toMatch(
          /Bearer\s+[0-9A-Za-z._-]{10,}/i
        );
      }
    );
  }
);