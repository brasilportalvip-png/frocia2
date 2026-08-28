import { describe, expect, it } from 'vitest';
import { ResearchQualityService } from '../server/ai/researchQualityService.js';

describe('ResearchQualityService', () => {
  it('aprova pesquisa com fontes independentes, páginas abertas e citações exatas', () => {
    const first =
      'A primeira conclusão factual possui evidência oficial e atualizada para esta análise.';
    const second =
      'A segunda conclusão foi comparada com uma publicação independente e também está sustentada.';
    const text = `${first} ${second}`;
    const result = ResearchQualityService.evaluate({
      text,
      citations: [
        {
          title: 'Fonte oficial',
          uri: 'https://example.gov/report/2026',
          domain: 'example.gov',
          sourceType: 'web',
          startIndex: 0,
          endIndex: first.length,
          supportedText: first,
        },
        {
          title: 'Fonte independente',
          uri: 'https://independent.org/analysis/2026',
          domain: 'independent.org',
          sourceType: 'web',
          startIndex: first.length + 1,
          endIndex: text.length,
          supportedText: second,
        },
        {
          title: 'Segunda confirmação independente',
          uri: 'https://research.example.edu/paper/2026',
          domain: 'research.example.edu',
          sourceType: 'web',
          startIndex: first.length + 1,
          endIndex: text.length,
          supportedText: second,
        },
      ],
      actions: [
        { type: 'search', query: 'tema', sourceCount: 5 },
        { type: 'search', query: 'tema contraponto', sourceCount: 4 },
        { type: 'open_page', url: 'https://example.gov/report/2026', sourceCount: 0 },
        { type: 'open_page', url: 'https://independent.org/analysis/2026', sourceCount: 0 },
        { type: 'open_page', url: 'https://research.example.edu/paper/2026', sourceCount: 0 },
        { type: 'find_in_page', pattern: 'conclusão', sourceCount: 0 },
      ],
    });

    expect(result.status).toBe('strong');
    expect(result.independentDomainCount).toBe(3);
    expect(result.exactCitationCount).toBe(3);
    expect(result.citedClaimCoverage).toBe(1);
    expect(result.openedPageCount).toBe(3);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('recusa qualidade quando não existe fonte verificável', () => {
    const result = ResearchQualityService.evaluate({
      text: 'Uma afirmação longa foi escrita sem qualquer evidência pública verificável nesta execução.',
      citations: [],
      actions: [],
    });

    expect(result.status).toBe('insufficient');
    expect(result.score).toBe(0);
    expect(result.limitations).toContain(
      'Nenhuma citação foi ligada a um trecho exato da resposta.'
    );
  });

  it('marca como parcial quando há links, mas não abertura nem suporte por trecho', () => {
    const result = ResearchQualityService.evaluate({
      text: 'Esta afirmação suficientemente longa depende de uma fonte que não foi aberta diretamente.',
      citations: [
        {
          title: 'Página inicial',
          uri: 'https://example.com/',
          domain: 'example.com',
          sourceType: 'web',
        },
      ],
      actions: [{ type: 'search', query: 'tema', sourceCount: 1 }],
    });

    expect(result.status).toBe('partial');
    expect(result.exactCitationCount).toBe(0);
    expect(result.openedPageCount).toBe(0);
  });
});
