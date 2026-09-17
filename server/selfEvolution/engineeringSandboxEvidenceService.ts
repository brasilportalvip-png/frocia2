import crypto from 'node:crypto';
import { ImprovementCandidate } from './selfEvolutionTypes.js';

export const REQUIRED_ENGINEERING_COMMANDS = [
  'install',
  'typecheck',
  'lint',
  'test',
  'e2e',
  'security-audit',
  'production-integrity',
  'build',
  'diff-check',
] as const;

export type EngineeringCommandId =
  (typeof REQUIRED_ENGINEERING_COMMANDS)[number];

const COMMAND_CONTRACT: Record<EngineeringCommandId, string[]> = {
  install: ['npm ci'],
  typecheck: ['npm run typecheck', 'npm run lint'],
  lint: ['npm run lint', 'npm run typecheck'],
  test: ['npm test'],
  e2e: ['npm run test:e2e'],
  'security-audit': ['npm audit --omit=dev --audit-level=moderate'],
  'production-integrity': ['npm run validate:production-integrity'],
  build: ['npm run build'],
  'diff-check': ['git diff --check'],
};

export interface EngineeringCommandEvidence {
  id: EngineeringCommandId;
  command: string;
  exitCode: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  stdoutSha256: string;
  stderrSha256: string;
}

export interface EngineeringSandboxEvidence {
  schemaVersion: 'engineering-sandbox-v1';
  candidateId: string;
  requestNonce: string;
  sandboxId: string;
  baseSha: string;
  networkPolicy: 'restricted';
  workspaceBeforeSha256: string;
  workspaceAfterSha256: string;
  diffSha256: string;
  rollbackVerified: boolean;
  commands: EngineeringCommandEvidence[];
  issuedAt: string;
}

export interface SandboxEvidenceVerification {
  valid: boolean;
  evidence?: EngineeringSandboxEvidence;
  error?: string;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function secureSignature(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

export class EngineeringSandboxEvidenceService {
  static createRequestNonce(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  static isCompleteEvidence(
    evidence: EngineeringSandboxEvidence | undefined,
    candidateId: string,
    baseSha: string | undefined
  ): boolean {
    if (
      !evidence ||
      evidence.schemaVersion !== 'engineering-sandbox-v1' ||
      evidence.candidateId !== candidateId ||
      evidence.baseSha !== baseSha ||
      evidence.networkPolicy !== 'restricted' ||
      evidence.rollbackVerified !== true
    ) return false;
    return REQUIRED_ENGINEERING_COMMANDS.every((id) =>
      evidence.commands.some((command) => command.id === id && command.exitCode === 0)
    );
  }

  static verifySignedResponse(input: {
    rawBody: string;
    signatureHeader: string | null;
    signingSecret: string;
    requestNonce: string;
    candidate: ImprovementCandidate;
    now?: Date;
  }): SandboxEvidenceVerification {
    const supplied = input.signatureHeader?.match(/^sha256=([a-f0-9]{64})$/i)?.[1];
    if (!supplied) {
      return { valid: false, error: 'Worker não apresentou assinatura HMAC válida.' };
    }
    const expected = secureSignature(input.rawBody, input.signingSecret);
    if (!crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))) {
      return { valid: false, error: 'Assinatura do worker não corresponde ao corpo recebido.' };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      return { valid: false, error: 'Worker retornou JSON inválido.' };
    }
    const raw = payload.executionEvidence;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { valid: false, error: 'Worker não retornou executionEvidence.' };
    }
    const evidence = raw as unknown as EngineeringSandboxEvidence;
    if (
      evidence.schemaVersion !== 'engineering-sandbox-v1' ||
      evidence.candidateId !== input.candidate.id ||
      evidence.requestNonce !== input.requestNonce ||
      !/^[A-Za-z0-9._:-]{8,160}$/.test(evidence.sandboxId || '') ||
      !/^[a-f0-9]{40}$/i.test(evidence.baseSha || '') ||
      evidence.networkPolicy !== 'restricted' ||
      !isSha256(evidence.workspaceBeforeSha256) ||
      !isSha256(evidence.workspaceAfterSha256) ||
      !isSha256(evidence.diffSha256) ||
      evidence.rollbackVerified !== true ||
      !isIsoTimestamp(evidence.issuedAt) ||
      !Array.isArray(evidence.commands)
    ) {
      return { valid: false, error: 'Atestado estrutural da sandbox está incompleto ou inválido.' };
    }

    const now = input.now || new Date();
    const issuedAt = new Date(evidence.issuedAt).getTime();
    if (Math.abs(now.getTime() - issuedAt) > 10 * 60_000) {
      return { valid: false, error: 'Atestado da sandbox está expirado ou possui horário inválido.' };
    }

    const byId = new Map<string, EngineeringCommandEvidence>();
    for (const command of evidence.commands) {
      if (!command || typeof command !== 'object' || byId.has(command.id)) {
        return { valid: false, error: 'Evidência de comando ausente ou duplicada.' };
      }
      if (
        !REQUIRED_ENGINEERING_COMMANDS.includes(command.id) ||
        !COMMAND_CONTRACT[command.id].includes(command.command) ||
        command.exitCode !== 0 ||
        !isIsoTimestamp(command.startedAt) ||
        !isIsoTimestamp(command.completedAt) ||
        !Number.isSafeInteger(command.durationMs) ||
        command.durationMs < 0 ||
        command.durationMs > 30 * 60_000 ||
        !isSha256(command.stdoutSha256) ||
        !isSha256(command.stderrSha256)
      ) {
        return { valid: false, error: `Evidência inválida para comando ${command.id || '(desconhecido)'}.` };
      }
      const measured = Date.parse(command.completedAt) - Date.parse(command.startedAt);
      if (measured < 0 || Math.abs(measured - command.durationMs) > 2_000) {
        return { valid: false, error: `Duração inconsistente no comando ${command.id}.` };
      }
      byId.set(command.id, command);
    }
    const missing = REQUIRED_ENGINEERING_COMMANDS.filter((id) => !byId.has(id));
    if (missing.length) {
      return { valid: false, error: `Comandos obrigatórios sem evidência: ${missing.join(', ')}.` };
    }
    return { valid: true, evidence };
  }
}
