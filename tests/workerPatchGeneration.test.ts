import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleGenAI } from '@google/genai';
import { generateStructuredPatch, safeRepoPath } from '../worker/patch-generation.mjs';
import { executeAutonomousRepairCycle } from '../worker/autonomous-repair-cycle.mjs';

const allowed = new Set(['src/App.tsx']);
const patch = { files: [{ path: 'src/App.tsx', content: 'export const title = "Froc.IA";\n' }], commitMessage: 'fix: teste' };
const input = { task: { title: 'Corrigir erro real' }, allowedPaths: [...allowed], sourceFiles: [], engineeringContext: {} };
const response = (text = JSON.stringify(patch), finishReason = 'STOP') => ({ text, candidates: [{ finishReason }], usageMetadata: { candidatesTokenCount: 500 } });
const generate = (generateContent: any, extra: Record<string, unknown> = {}) =>
  generateStructuredPatch({ generateContent, model: 'gemini-3.1-pro-preview', input, allowed, ...extra });

describe('Geracao completa e validada do patch', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('aceita diagnóstico explícito sem inventar um arquivo alterado', async () => {
    const result = await generate(async () => response(JSON.stringify({ files: [], commitMessage: '', noChangeReason: 'A investigação não justificou uma mudança nestes arquivos.' })));
    expect(result).toMatchObject({ files: [], noChangeReason: expect.stringContaining('não justificou') });
  });
  it('reproduz a string JSON sem fechamento e recupera por geracao nova, antes de aplicar arquivos', async () => {
    const malformed = '{\n "files": [\n {\n "path": "src/App.tsx",\n "content": "' + 'x'.repeat(9200);
    expect(() => JSON.parse(malformed)).toThrow(/Unterminated string/);
    const generateContent = vi.fn().mockResolvedValueOnce(response(malformed)).mockResolvedValueOnce(response());
    const apply = vi.fn(async () => undefined); const certify = vi.fn(async () => ({ passed: true }));
    const result = await executeAutonomousRepairCycle({ maximumAttempts: 3, restoreBaseline: vi.fn(async () => undefined), apply, certify,
      generate: ({ attempt, feedback }: any) => generate(generateContent, { attempt, feedback }) });
    expect(result).toMatchObject({ passed: true, selectedAttempt: 2, patch });
    expect(apply).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledWith(patch);
    expect(certify).toHaveBeenCalledTimes(1);
    const feedback = JSON.parse(generateContent.mock.calls[1][0].contents[0].text).repairFeedback;
    expect(feedback.summary).toContain('generator_invalid_json');
    expect(feedback.summary).not.toContain('xxx');
    expect(generateContent.mock.calls[0][0].config.maxOutputTokens).toBe(32768);
    expect(generateContent.mock.calls[1][0].config.maxOutputTokens).toBe(65536);
  });

  it('exige esquema de arquivos, conteudo e commit; limita SDK a uma chamada com timeout', async () => {
    const f = vi.fn(async (_request: any) => response());
    expect(await generate(f)).toEqual(patch);
    expect(f.mock.calls[0][0].config).toMatchObject({ responseMimeType: 'application/json', candidateCount: 1,
      responseJsonSchema: { required: ['files', 'commitMessage'], properties: { files: { minItems: 0, maxItems: 25 } } },
      httpOptions: { timeout: 180000, retryOptions: { attempts: 1 } } });
  });

  it.each([
    ['gemini-3.1-pro-preview', { thinkingLevel: 'LOW' }],
    ['gemini-3.8-flash', { thinkingLevel: 'LOW' }],
    ['gemini-2.5-flash', { thinkingBudget: 4096 }],
  ])('usa configuração de raciocínio compatível com %s', async (model, thinkingConfig) => {
    const call = vi.fn(async (_request: any) => response());
    await generate(call, { model });
    expect(call.mock.calls[0][0].config.thinkingConfig).toEqual(thinkingConfig);
  });
  it('registra causa categorizada do HTTP 400 sem copiar corpo ou credenciais', async () => {
    const onDiagnostic = vi.fn();
    const err = await generate(async () => { throw Object.assign(new Error(JSON.stringify({ error: { message: 'response_json_schema is not supported private-api-key' } })), { status: 400 }); }, { onDiagnostic }).catch(e => e);
    expect(err).toMatchObject({ status: 400, diagnostic: { reason: 'response_schema' }, retryable: false });
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('private-api-key');
    expect(String(err)).not.toContain('private-api-key');
  });
  it('confere a serializacao real do SDK Google, com a rede simulada e o texto preservado', async () => {
    const contents = 'const text = "aspas \\\", barra \\\\, acento ação e emoji 🦜";\n';
    const wirePatch = { ...patch, files: [{ path: 'src/App.tsx', content: contents }] };
    const f = vi.fn(async (_url: unknown, _init: RequestInit) => Response.json({
      candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(wirePatch) }] } }],
      usageMetadata: { candidatesTokenCount: 123 },
    }));
    vi.stubGlobal('fetch', f);
    const ai = new GoogleGenAI({ apiKey: 'test-api-key-not-real' });
    const result = await generate((request: any) => ai.models.generateContent(request));
    expect(result).toEqual(wirePatch);
    expect(f).toHaveBeenCalledTimes(1);
    const wire = JSON.parse(String(f.mock.calls[0][1].body));
    expect(wire.generationConfig).toMatchObject({ responseMimeType: 'application/json', maxOutputTokens: 32768 });
    expect(wire.generationConfig.responseJsonSchema ?? wire.generationConfig._responseJsonSchema).toMatchObject({ required: ['files', 'commitMessage'] });
  });

  it('recusa MAX_TOKENS mesmo com um prefixo JSON sintaticamente valido', async () => {
    const error = await generate(async () => response(JSON.stringify(patch), 'MAX_TOKENS')).catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'generator_response_incomplete', retryable: true,
      diagnostic: { finishReason: 'MAX_TOKENS', outputTokens: 500 } });
  });

  it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'])('nao repete uma resposta bloqueada (%s)', async finish => {
    expect(await generate(async () => response(JSON.stringify(patch), finish)).catch((e: Error) => e))
      .toMatchObject({ retryable: false });
  });

  it('recusa bloqueio do prompt antes de tentar interpretar conteudo', async () => {
    expect(await generate(async () => ({ ...response(), promptFeedback: { blockReason: 'SAFETY' } })).catch((e: Error) => e))
      .toMatchObject({ code: 'generator_response_blocked', retryable: false });
  });

  it.each(['', ' ', '```json\n{}\n```', '{"files":'])('rejeita texto vazio ou JSON incompleto (%s)', async text => {
    expect(await generate(async () => response(text)).catch((e: Error) => e)).toMatchObject({ retryable: true });
  });

  it.each([
    { ...patch, files: [] }, { ...patch, commitMessage: null },
    { ...patch, files: [{ path: 'src/Other.tsx', content: 'fora do escopo' }] },
    { ...patch, files: [...patch.files, ...patch.files] },
    { ...patch, files: [{ path: '../outside.ts', content: 'escape' }] },
    { ...patch, files: [{ path: 'tests/private.env.test.ts', content: 123 }] },
    { ...patch, files: [{ path: '.env', content: 'segredo' }] },
  ])('recusa formato, repeticao ou arquivo fora do escopo antes de escrever (%j)', async invalid => {
    expect(await generate(async () => response(JSON.stringify(invalid))).catch((e: Error) => e)).toMatchObject({ retryable: true });
  });

  it('aceita novo teste e preserva o arquivo completo sem cortar texto valido', async () => {
    const large = '// Froc.IA 🦜\n'.repeat(12000);
    const valid = { files: [patch.files[0], { path: 'tests/regression.test.ts', content: large }], commitMessage: 'fix: regressao' };
    expect(await generate(async () => response(JSON.stringify(valid)))).toEqual(valid);
  });

  it('limita o tamanho de arquivo antes da aplicacao', async () => {
    const oversized = { ...patch, files: [{ path: 'src/App.tsx', content: 'x'.repeat(1_000_001) }] };
    expect(await generate(async () => response(JSON.stringify(oversized))).catch((e: Error) => e)).toMatchObject({ code: 'generator_patch_too_large' });
  });

  it('registra somente metadados e nunca o texto gerado ou a chave', async () => {
    const onDiagnostic = vi.fn();
    const text = 'segredo-do-codigo ' + 'x'.repeat(100);
    const error = await generate(async () => response(text), { onDiagnostic }).catch((e: Error) => e);
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('segredo-do-codigo');
    expect(String(error)).not.toContain('segredo-do-codigo');
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ responseCharacters: text.length, finishReason: 'STOP' }));
  });

  it.each([401, 403, 429, 503])('classifica HTTP %s sem expor a mensagem do provedor', async status => {
    expect(await generate(async () => { throw Object.assign(new Error('private-api-key'), { status }); }).catch((e: Error) => e))
      .toMatchObject({ code: 'generator_provider_error', status, retryable: status >= 429 });
  });

  it.each(['../src/App.tsx', '/etc/passwd', 'C:\\secrets.txt', '.git/config', '.env.local', 'account.pem'])('rejeita caminho protegido %s', value => {
    expect(safeRepoPath(value)).toBeNull();
  });
});
