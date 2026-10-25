import { describe, expect, it, vi } from 'vitest';
import { createEngineeringModelSession } from '../worker/engineering-model-session.mjs';
import { generateStructuredPatch } from '../worker/patch-generation.mjs';
import { executeAutonomousRepairCycle } from '../worker/autonomous-repair-cycle.mjs';
const primary = 'gemini-3.1-pro-preview';
const alternate = 'gemini-2.5-flash';
const entry = (name: string) => ({ name: 'models/' + name, supportedActions: ['generateContent'], outputTokenLimit: 65536 });
const feedback = (status = 504) => ({ stage: 'generation', summary: 'generator_provider_error', providerStatus: status });
const setup = (extra = {}) => createEngineeringModelSession({ preferred: primary,
  listModels: vi.fn(async () => [entry(primary), entry(alternate)]), wait: vi.fn(async () => undefined), ...extra });
describe('troca limitada do modelo de engenharia', () => {
  it('mantém o modelo configurado e não consulta catálogo no caminho saudável', async () => {
    const listModels = vi.fn(); const session = setup({ listModels });
    expect(await session.next()).toBe(primary);
    expect(listModels).not.toHaveBeenCalled();
  });
  it.each([404, 504])('troca após HTTP %s para modelo retornado pela API', async status => {
    const session = setup(); await session.next();
    expect(await session.next(feedback(status))).toBe(alternate);
  });
  it('não troca por JSON incompleto ou por teste de certificação reprovado', async () => {
    const session = setup();
    for (const previous of [{ stage: 'generation', summary: 'generator_invalid_json' }, { stage: 'test', summary: 'test failed' }])
      expect(await session.next(previous)).toBe(primary);
  });
  it('não escolhe modelos de imagem, voz, sem generateContent ou com saída insuficiente', async () => {
    const session = setup({ listModels: async () => [entry('gemini-image-preview'), entry('gemini-tts-preview'),
      { ...entry('gemini-embedding-2'), supportedActions: ['embedContent'] }, { ...entry('gemini-old-flash'), outputTokenLimit: 8192 }, { ...entry('gemini-small-flash'), outputTokenLimit: 32768 }, entry(alternate)] });
    expect(await session.next(feedback())).toBe(alternate);
  });
  it('respeita alternativa configurada disponível e não inventa nomes ausentes', async () => {
    const session = setup({ fallbacks: 'gemini-missing,gemini-2.5-flash' });
    expect(await session.next(feedback(503))).toBe(alternate);
  });
  it('conserva erro de catálogo sem expor segredo nem gerar modelos fictícios', async () => {
    const log = vi.fn(); const session = setup({ listModels: async () => { throw new Error('private-api-key'); }, onDiagnostic: log });
    expect(await session.next(feedback())).toBe(primary);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-api-key');
  });
  it('não multiplica chamadas: 504, alternativa válida, certificação e retorno', async () => {
    const session = setup();
    const patch = { files: [{ path: 'src/App.tsx', content: 'export const fixed = true;' }], commitMessage: 'fix: teste' };
    const call = vi.fn().mockRejectedValueOnce(Object.assign(new Error('gateway'), { status: 504 }))
      .mockResolvedValueOnce({ text: JSON.stringify(patch), candidates: [{ finishReason: 'STOP' }] });
    const apply = vi.fn(); const certify = vi.fn(async () => ({ passed: true }));
    const result = await executeAutonomousRepairCycle({ restoreBaseline: vi.fn(), apply, certify,
      generate: async ({ feedback, attempt }: any) => generateStructuredPatch({ generateContent: call,
        model: await session.next(feedback), input: {}, allowed: new Set(['src/App.tsx']), attempt, feedback }) });
    expect(result.passed).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls.map(c => c[0].model)).toEqual([primary, alternate]);
    expect(apply).toHaveBeenCalledTimes(1); expect(certify).toHaveBeenCalledTimes(1);
  });
  it('para na autenticação negada; não tenta contornar 401/403', async () => {
    const session = setup(); const call = vi.fn(async () => { throw Object.assign(new Error('denied'), { status: 403 }); });
    const result = await executeAutonomousRepairCycle({ restoreBaseline: vi.fn(), apply: vi.fn(), certify: vi.fn(),
      generate: async ({ feedback }: any) => generateStructuredPatch({ generateContent: call, model: await session.next(feedback), input: {}, allowed: new Set() }) });
    expect(result.passed).toBe(false); expect(call).toHaveBeenCalledTimes(1);
  });
});
