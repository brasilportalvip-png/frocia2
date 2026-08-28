import { describe, expect, it } from 'vitest';
import {
  attachCitationMarkers,
  parseResearchPlan,
} from '../server/ai/researchJobService.js';

describe('Pesquisa agêntica Gemini sem dependência OpenAI', () => {
  it('interpreta e limita um plano de subconsultas independente', () => {
    const plan = parseResearchPlan(
      JSON.stringify({
        queries: [
          'fonte oficial do tema',
          'dados atuais do tema',
          'contraponto independente',
          'estudo acadêmico',
          'consulta excedente',
        ],
      }),
      'tema principal'
    );

    expect(plan).toHaveLength(4);
    expect(plan[0]).toBe('fonte oficial do tema');
    expect(new Set(plan).size).toBe(plan.length);
  });

  it('cria um plano conservador quando o modelo não devolve JSON válido', () => {
    const plan = parseResearchPlan('resposta inválida', 'energia solar no Brasil');

    expect(plan).toHaveLength(3);
    expect(plan.join(' ')).toContain('energia solar no Brasil');
    expect(plan.join(' ')).toContain('fontes oficiais');
  });

  it('liga marcadores de fonte ao trecho exato da resposta', () => {
    const text =
      'O relatório oficial confirma crescimento no período analisado [S1]. Uma fonte independente aponta uma limitação relevante [S2].';
    const citations = attachCitationMarkers(text, [
      {
        title: 'Relatório oficial',
        uri: 'https://example.gov/reports/2026',
        domain: 'example.gov',
        sourceType: 'web',
      },
      {
        title: 'Análise independente',
        uri: 'https://independent.org/analysis/2026',
        domain: 'independent.org',
        sourceType: 'web',
      },
    ]);

    expect(citations[0].supportedText).toContain('relatório oficial');
    expect(citations[1].supportedText).toContain('fonte independente');
    expect(citations.every((citation) => citation.startIndex !== undefined)).toBe(true);
    expect(citations.every((citation) => citation.endIndex !== undefined)).toBe(true);
  });
});
