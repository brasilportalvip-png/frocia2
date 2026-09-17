import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultCodeAgentAdapter } from '../server/selfEvolution/codeAgentService.js';
import { REQUIRED_ENGINEERING_COMMANDS } from '../server/selfEvolution/engineeringSandboxEvidenceService.js';
import { ImprovementCandidate } from '../server/selfEvolution/selfEvolutionTypes.js';

const candidate = {
  id: 'candidate-sandbox', title: 'Corrigir API', summary: 'Corrige API', evidence: [],
  frequency: 1, affectedUsersCount: 1, severity: 'medium', confidence: 1,
  affectedComponents: ['api'], probableFiles: ['server/fix.ts'], hypothesis: 'bug',
  expectedBehavior: 'funciona', riskLevel: 'R1', estimatedCostCredits: 2,
  testPlan: 'testar', rollbackStrategy: 'reverter', duplicates: [],
  requiresApproval: false, state: 'approved_for_work',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
} satisfies ImprovementCandidate;

describe('DefaultCodeAgentAdapter sandbox contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SELF_EVOLUTION_WORKER_URL;
    delete process.env.SELF_EVOLUTION_WORKER_TOKEN;
    delete process.env.SELF_EVOLUTION_WORKER_SIGNING_SECRET;
  });

  it('aceita patch apenas com evidência assinada, SHA e comandos aprovados', async () => {
    const secret = 'z'.repeat(32);
    process.env.SELF_EVOLUTION_WORKER_URL = 'https://worker.example.com';
    process.env.SELF_EVOLUTION_WORKER_TOKEN = 'bearer-token';
    process.env.SELF_EVOLUTION_WORKER_SIGNING_SECRET = secret;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const startedAt = new Date().toISOString();
      const completedAt = startedAt;
      const baseSha = 'a'.repeat(40);
      const commands = REQUIRED_ENGINEERING_COMMANDS.map((id) => ({
        id,
        command: id === 'install' ? 'npm ci'
          : id === 'typecheck' ? 'npm run typecheck'
            : id === 'test' ? 'npm test'
              : id === 'production-integrity' ? 'npm run validate:production-integrity'
                : id === 'build' ? 'npm run build' : 'git diff --check',
        exitCode: 0, startedAt, completedAt, durationMs: 0,
        stdoutSha256: '1'.repeat(64), stderrSha256: '2'.repeat(64),
      }));
      const payload = {
        files: [{ path: 'server/fix.ts', content: 'export const fixed = true;' }],
        linesAdded: 1, linesRemoved: 0, baseSha,
        executionEvidence: {
          schemaVersion: 'engineering-sandbox-v1', candidateId: candidate.id,
          requestNonce: request.requestNonce, sandboxId: 'sandbox:test-001', baseSha,
          networkPolicy: 'restricted', workspaceBeforeSha256: '3'.repeat(64),
          workspaceAfterSha256: '4'.repeat(64), diffSha256: '5'.repeat(64),
          rollbackVerified: true, commands, issuedAt: new Date().toISOString(),
        },
      };
      const raw = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      return new Response(raw, {
        status: 200,
        headers: { 'x-frocia-worker-signature': `sha256=${signature}` },
      });
    }));

    const result = await new DefaultCodeAgentAdapter().generatePatchAndTest(candidate);
    expect(result).toMatchObject({
      success: true, baseSha: 'a'.repeat(40), filesModified: ['server/fix.ts'],
      executionEvidence: { sandboxId: 'sandbox:test-001', rollbackVerified: true },
    });
  });

  it('fica indisponível sem segredo independente de assinatura', async () => {
    process.env.SELF_EVOLUTION_WORKER_URL = 'https://worker.example.com';
    process.env.SELF_EVOLUTION_WORKER_TOKEN = 'bearer-token';
    const result = await new DefaultCodeAgentAdapter().generatePatchAndTest(candidate);
    expect(result.status).toBe('not_configured');
  });
});
