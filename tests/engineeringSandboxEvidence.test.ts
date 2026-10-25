import { artifactManifest } from '../worker/patch-workspace.mjs';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EngineeringSandboxEvidence,
  EngineeringSandboxEvidenceService,
  REQUIRED_ENGINEERING_COMMANDS,
} from '../server/selfEvolution/engineeringSandboxEvidenceService.js';
import { ImprovementCandidate } from '../server/selfEvolution/selfEvolutionTypes.js';

const candidate = {
  id: 'candidate-1', title: 'Fix', summary: 'Fix test', evidence: [],
  frequency: 1, affectedUsersCount: 1, severity: 'medium', confidence: 1,
  affectedComponents: ['api'], probableFiles: ['server/fix.ts'],
  hypothesis: 'bug', expectedBehavior: 'works', riskLevel: 'R1',
  estimatedCostCredits: 1, testPlan: 'npm test', rollbackStrategy: 'revert',
  duplicates: [], requiresApproval: false, state: 'approved_for_work',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
} satisfies ImprovementCandidate;

function evidence(nonce: string): EngineeringSandboxEvidence {
  const startedAt = '2026-09-17T10:00:00.000Z';
  const completedAt = '2026-09-17T10:00:01.000Z';
  const commands = REQUIRED_ENGINEERING_COMMANDS.map((id) => ({
    id,
    command: id === 'install' ? 'npm ci'
      : id === 'typecheck' ? 'npm run typecheck'
        : id === 'lint' ? 'npm run lint'
        : id === 'test' ? 'npm test'
          : id === 'e2e' ? 'npm run test:e2e'
            : id === 'security-audit' ? 'npm audit --omit=dev --audit-level=moderate'
          : id === 'production-integrity' ? 'npm run validate:production-integrity'
            : id === 'build' ? 'npm run build' : 'git diff --check',
    exitCode: 0, startedAt, completedAt, durationMs: 1000,
    stdoutSha256: 'a'.repeat(64), stderrSha256: 'b'.repeat(64),
  }));
  return {
    schemaVersion: 'engineering-sandbox-v1', candidateId: candidate.id,
    requestNonce: nonce, sandboxId: 'sandbox:verified-001', baseSha: 'c'.repeat(40),
    networkPolicy: 'restricted', workspaceBeforeSha256: 'd'.repeat(64),
    workspaceAfterSha256: 'e'.repeat(64), diffSha256: 'f'.repeat(64),
    rollbackVerified: true, commands, issuedAt: '2026-09-17T10:00:02.000Z',
  };
}

function signedBody(value: unknown, secret: string) {
  const rawBody = JSON.stringify(value);
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return { rawBody, signatureHeader: `sha256=${digest}` };
}

describe('EngineeringSandboxEvidenceService', () => {
  const secret = 's'.repeat(32);
  const nonce = 'n'.repeat(48);

  it('aprova somente atestado assinado com todos os comandos obrigatórios', () => {
    const signed = signedBody({ executionEvidence: evidence(nonce) }, secret);
    const result = EngineeringSandboxEvidenceService.verifySignedResponse({
      ...signed, signingSecret: secret, requestNonce: nonce, candidate,
      now: new Date('2026-09-17T10:00:03.000Z'),
    });
    expect(result.valid).toBe(true);
    expect(result.evidence?.commands).toHaveLength(9);
  });

  it('rejeita corpo alterado depois da assinatura', () => {
    const signed = signedBody({ executionEvidence: evidence(nonce) }, secret);
    const result = EngineeringSandboxEvidenceService.verifySignedResponse({
      ...signed, rawBody: signed.rawBody.replace('restricted', 'unrestricted'),
      signingSecret: secret, requestNonce: nonce, candidate,
      now: new Date('2026-09-17T10:00:03.000Z'),
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Assinatura');
  });

  it('rejeita teste com falha mesmo quando o corpo está corretamente assinado', () => {
    const failed = evidence(nonce);
    failed.commands.find((item) => item.id === 'test')!.exitCode = 1;
    const signed = signedBody({ executionEvidence: failed }, secret);
    const result = EngineeringSandboxEvidenceService.verifySignedResponse({
      ...signed, signingSecret: secret, requestNonce: nonce, candidate,
      now: new Date('2026-09-17T10:00:03.000Z'),
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('test');
  });
  it('rejeita certificação de diff vazio e workspaces idênticos', () => {
    const empty = evidence(nonce); empty.workspaceAfterSha256 = empty.workspaceBeforeSha256;
    empty.diffSha256 = crypto.createHash('sha256').update('').digest('hex');
    expect(EngineeringSandboxEvidenceService.verifySignedResponse({ ...signedBody({ executionEvidence: empty }, secret),
      signingSecret: secret, requestNonce: nonce, candidate, now: new Date('2026-09-17T10:00:03.000Z') }).valid).toBe(false);
  });
  it('rejeita alteração do arquivo retornado mesmo com envelope assinado válido', () => {
    const files = [{ path: 'server/fix.ts', content: 'certified' }];
    const manifest = { ...evidence(nonce), artifactManifestSha256: artifactManifest(files) };
    const checked = (returned: typeof files) => EngineeringSandboxEvidenceService.verifySignedResponse({
      ...signedBody({ files: returned, executionEvidence: manifest }, secret), signingSecret: secret,
      requestNonce: nonce, candidate, now: new Date('2026-09-17T10:00:03.000Z') });
    expect(checked(files).valid).toBe(true);
    expect(checked([{ ...files[0], content: 'not-certified' }]).valid).toBe(false);
  });
  it('autentica diagnóstico sem alteração e rejeita outro nonce', () => {
    const data = { schemaVersion: 'engineering-no-change-v1', status: 'no_change', candidateId: candidate.id,
      requestNonce: nonce, baseSha: 'a'.repeat(40), reason: 'Nenhuma alteração efetiva encontrada.', issuedAt: new Date().toISOString() };
    const input = { ...signedBody(data, secret), signingSecret: secret, requestNonce: nonce, candidateId: candidate.id };
    expect(EngineeringSandboxEvidenceService.verifyNoChange(input)).toMatchObject({ reason: data.reason });
    expect(EngineeringSandboxEvidenceService.verifyNoChange({ ...input, requestNonce: 'other' })).toBeNull();
  });

});
