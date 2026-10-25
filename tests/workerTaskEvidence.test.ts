import { describe, expect, it, vi } from 'vitest';
import { engineeringTask, generationInput } from '../worker/task-evidence.mjs';
import { buildEngineeringContext } from '../worker/engineering-context.mjs';
import { generateStructuredPatch } from '../worker/patch-generation.mjs';

describe('Evidência chega ao modelo e à busca de causa raiz', () => {
  it('serializa o erro real e o pedido do revisor na chamada do gerador', async () => {
    const body = { title: 'Corrigir o site', summary: 'Erro observado', evidence: [
      'TypeError: messageStreamUndefined em src/stream.ts:13',
      'CORREÇÃO SOLICITADA PELO COMITÊ: QA exige teste de regressão da conexão.',
    ] };
    const allowed = new Set(['src/stream.ts']);
    const input = generationInput(body, allowed, [], {});
    const generateContent = vi.fn(async (_request: any) => ({ text: JSON.stringify({
      files: [{ path: 'src/stream.ts', content: 'export const connected = true;' }], commitMessage: 'fix: stream',
    }), candidates: [{ finishReason: 'STOP' }] }));
    await generateStructuredPatch({ generateContent, model: 'test-model', allowed, input });
    const wire = JSON.parse(generateContent.mock.calls[0][0].contents[0].text);
    expect(wire.task.evidence).toEqual(body.evidence);
  });
  it('usa o diagnóstico para selecionar código mesmo quando o resumo é genérico', () => {
    const task = engineeringTask({ title: 'Manutenção do site', evidence: ['messageStreamUndefined'] });
    const context = buildEngineeringContext([
      { path: 'src/stream.ts', content: 'export const messageStreamUndefined = true;' },
      { path: 'src/unrelated.ts', content: 'export const unrelated = true;' },
    ], task);
    expect(context.selectedFiles).toContain('src/stream.ts');
    expect(context.queryTerms).toContain('messagestreamundefined');
  });
  it('limita entradas enormes e não inventa evidência quando ela está ausente', () => {
    expect(engineeringTask({}).evidence).toEqual([]);
    const result = engineeringTask({ evidence: Array.from({ length: 40 }, () => 'x'.repeat(20_000)) });
    expect(result.evidence).toHaveLength(32);
    expect(result.evidence.every((line: string) => line.length <= 16_000)).toBe(true);
  });
});
