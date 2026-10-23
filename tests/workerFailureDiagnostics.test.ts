import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandDiagnosticExcerpt, workerFailurePayload } from '../worker/worker-failure.mjs';
import { EngineeringSandboxEvidenceService } from '../server/selfEvolution/engineeringSandboxEvidenceService.js';
import { DefaultCodeAgentAdapter } from '../server/selfEvolution/codeAgentService.js';
import type { ImprovementCandidate } from '../server/selfEvolution/selfEvolutionTypes.js';
import { WorkerHttpClient } from '../server/selfEvolution/workerHttpClient.js';

const secret = 's'.repeat(40);
const body = { candidateId: 'site-fault', requestNonce: 'a'.repeat(48) };
function signed(payload: unknown) {
  const rawBody = JSON.stringify(payload);
  return { rawBody, signatureHeader: 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex') };
}
function verify(payload: unknown) {
  return EngineeringSandboxEvidenceService.verifySignedFailure({ ...signed(payload), signingSecret: secret,
    candidateId: body.candidateId, requestNonce: body.requestNonce });
}
const candidate = { id: body.candidateId, title: 'Falha real', probableFiles: ['src/App.tsx'] } as ImprovementCandidate;

describe('Diagnostico autenticado do HTTP 422', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('preserva a etapa de geracao e o erro do provedor sem declarar um teste reprovado', () => {
    const payload = workerFailurePayload({ body, stage: 'generation', error: Object.assign(new Error('MODEL_NOT_AVAILABLE'), { status: 404 }) });
    expect(verify(payload)).toEqual({ stage: 'generation', error: 'MODEL_NOT_AVAILABLE', detail: '', providerStatus: 404 });
    expect(payload.commands).toEqual([]);
  });

  it('preserva o ultimo comando reprovado e sua saida ao esgotar as tentativas', () => {
    const payload = workerFailurePayload({ body, stage: 'certification', error: new Error('autonomous_repair_exhausted'),
      repairCycle: { attempts: [{ attempt: 3, passed: false, failure: { stage: 'typecheck', exitCode: 2,
        summary: 'command_failed:typecheck', stdoutTail: 'src/App.tsx(10): error TS2322' } }] } });
    expect(verify(payload)).toMatchObject({ stage: 'typecheck', detail: 'src/App.tsx(10): error TS2322' });
  });

  it('mostra a falha de navegador em stdout mesmo quando stderr contem aviso do Firebase', () => {
    const stdout = commandDiagnosticExcerpt('Running tests\nError: browserType.launch: Executable doesn\'t exist at /ms-playwright/chromium_headless_shell-1234/chrome\nInstale o navegador exigido.\n' + 'caso listado no resumo\n'.repeat(200));
    const payload = workerFailurePayload({ body, stage: 'certification', error: new Error('autonomous_repair_exhausted'),
      repairCycle: { attempts: [{ failure: { stage: 'e2e', stdoutTail: stdout,
        stderrTail: 'Credenciais completas do Firebase Admin nao foram fornecidas.' } }] } });
    expect(verify(payload)?.detail).toContain("Executable doesn't exist");
    expect(verify(payload)?.detail).toContain('chromium_headless_shell-1234');
    expect(verify(payload)?.detail).toContain('Firebase');
  });

  it('mantem os dois canais limitados e remove segredos antes de selecionar a mensagem', () => {
    vi.stubEnv('BROWSER_TEST_PASSWORD', 'senha-nao-publicar');
    const stdout = commandDiagnosticExcerpt('\u001b[31mError: senha-nao-publicar\u001b[0m\n' + 'detalhe\n'.repeat(400));
    const payload = workerFailurePayload({ body, stage: 'e2e', error: Object.assign(new Error('e2e_failed'),
      { stdoutTail: stdout, stderrTail: 'senha-nao-publicar ' + 'aviso '.repeat(1000) }) });
    expect(payload.detail.length).toBeLessThanOrEqual(1800);
    expect(payload.detail).not.toContain('senha-nao-publicar');
    expect(payload.detail).not.toContain('\u001b');
    expect(payload.detail).toContain('stdout:');
    expect(payload.detail).toContain('stderr:');
  });

  it('remove segredos do ambiente, bearer e chaves conhecidas antes de assinar', () => {
    vi.stubEnv('GEMINI_API_KEY', 'private-google-value');
    vi.stubEnv('BROWSER_TEST_PASSWORD', 'private-browser-value');
    const error = new Error('private-google-value\nprivate-browser-value Bearer access-value ghp_abcdefghijklmnopqrstuvwxyz');
    const payload = workerFailurePayload({ body, stage: 'generation', error });
    expect(payload.error).not.toMatch(/private-google-value|private-browser-value|access-value|ghp_/);
    expect(payload.error).not.toContain('\n');
    expect(payload.error).toContain('[REDACTED_SECRET]');
  });

  it('rejeita adulteracao, assinatura ausente e mensagens de outro pedido ou candidato', () => {
    const payload = workerFailurePayload({ body, stage: 'generation', error: new Error('original') });
    const input = { ...signed(payload), signingSecret: secret, ...body };
    expect(EngineeringSandboxEvidenceService.verifySignedFailure({ ...input, rawBody: input.rawBody.replace('original', 'alterado') })).toBeNull();
    expect(EngineeringSandboxEvidenceService.verifySignedFailure({ ...input, signatureHeader: null })).toBeNull();
    expect(verify({ ...payload, candidateId: 'another-candidate' })).toBeNull();
    expect(verify({ ...payload, requestNonce: 'b'.repeat(48) })).toBeNull();
    expect(verify({ ...payload, issuedAt: '2000-01-01T00:00:00Z' })).toBeNull();
    expect(verify({ ...payload, schemaVersion: 'engineering-sandbox-v1' })).toBeNull();
    expect(verify({ ...payload, error: 'x'.repeat(121_000) })).toBeNull();
  });

  it('leva o diagnostico real do worker ate a mensagem do candidato no runner', async () => {
    vi.stubEnv('SELF_EVOLUTION_WORKER_URL', 'https://worker.example.com');
    vi.stubEnv('SELF_EVOLUTION_WORKER_TOKEN', 'private-worker-token');
    vi.stubEnv('SELF_EVOLUTION_WORKER_SIGNING_SECRET', secret);
    vi.spyOn(WorkerHttpClient, 'postJson').mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init.body));
      const payload = workerFailurePayload({ body: request, stage: 'generation',
        error: Object.assign(new Error('PROVIDER_LIMIT private-worker-token'), { status: 429 }) });
      const response = signed(payload);
      return new Response(response.rawBody, { status: 422, headers: { 'x-frocia-worker-signature': response.signatureHeader } });
    });
    const result = await new DefaultCodeAgentAdapter().generatePatchAndTest(candidate);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('HTTP 422 [generation], provedor HTTP 429');
    expect(result.errorMessage).toContain('PROVIDER_LIMIT');
    expect(result.errorMessage).not.toContain('private-worker-token');
    expect(result.executionEvidence).toBeUndefined();
  });

  it('nao confia no texto de falha sem assinatura e continua recusando o patch', async () => {
    vi.stubEnv('SELF_EVOLUTION_WORKER_URL', 'https://worker.example.com');
    vi.stubEnv('SELF_EVOLUTION_WORKER_TOKEN', 'private-worker-token');
    vi.stubEnv('SELF_EVOLUTION_WORKER_SIGNING_SECRET', secret);
    vi.spyOn(WorkerHttpClient, 'postJson').mockResolvedValue(Response.json({ error: 'UNTRUSTED_TEXT' }, { status: 422 }));
    const result = await new DefaultCodeAgentAdapter().generatePatchAndTest(candidate);
    expect(result).toMatchObject({ success: false, files: [] });
    expect(result.errorMessage).toContain('diagnostico autenticado indisponivel');
    expect(result.errorMessage).not.toContain('UNTRUSTED_TEXT');
  });
});
