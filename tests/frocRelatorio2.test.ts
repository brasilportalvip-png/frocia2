import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createFactoryModel, isCompleteJson } from '../server/siteFactory/professionalBuildService.js';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('Correções do 2º relatório do teste completo', () => {
  it('construção de site: JSON cortado pelo limite de saída é refeito com limite maior', async () => {
    const budgets: number[] = [];
    const model = createFactoryModel(async (input) => {
      budgets.push(input.maxOutputTokens);
      return budgets.length === 1
        ? { text: '{"contributions":[{"agentId":"a","decis', inputTokens: 10, outputTokens: 8000 }
        : { text: '{"contributions":[]}', inputTokens: 10, outputTokens: 20 };
    }, () => 'modelo-teste');
    const result = await model.generate({ systemInstruction: 's', userMessage: 'u', maxOutputTokens: 8000 });
    expect(isCompleteJson(result.text)).toBe(true);
    expect(budgets[0]).toBeGreaterThanOrEqual(32768);
    expect(budgets[1]).toBe(65536);
    expect(result.inputTokens).toBe(20);
    expect(result.model).toBe('modelo-teste');
  });

  it('erro temporário da construção não aparece como falha enquanto ela tenta de novo', () => {
    const panel = read('src/components/ProfessionalBuildPanel.tsx');
    expect(panel).toContain('build.error && build.status === "failed"');
    expect(panel).toContain('Ajustando e tentando de novo automaticamente');
  });

  it('vídeo: faturamento fechado tenta a outra chave e explica o motivo em português', () => {
    const media = read('server/routes/mediaRoutes.ts');
    expect(media).toContain('export function videoApiKeys()');
    expect(media).toContain('isProviderBillingError(providerMessage) && alternate');
    expect(media).toContain('conta de faturamento do projeto da chave GEMINI_MEDIA_API_KEY está fechada');
    expect(media).toContain("videoKeyFor(job.apiKeyRef)");
  });
});
