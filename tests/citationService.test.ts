import { describe, expect, it } from 'vitest';
import { CitationService } from '../server/ai/citationService.js';

describe('CitationService', () => {
  it('ignora fontes de grounding que não sustentam nenhum trecho da resposta', () => {
    const groundingMetadata = {
      groundingChunks: [
        {
          web: {
            uri: 'https://fonte-valida.com/artigo',
            title: 'Fonte válida',
          },
        },
        {
          web: {
            uri: 'https://fonte-nao-utilizada.com/artigo',
            title: 'Fonte não utilizada',
          },
        },
      ],
      groundingSupports: [
        {
          groundingChunkIndices: [0],
          segment: {
            startIndex: 0,
            endIndex: 20,
            text: 'Trecho sustentado pela fonte válida.',
          },
        },
      ],
    };

    const citations =
      CitationService.extractSearchGroundingCitations(
        groundingMetadata
      );

    expect(citations).toHaveLength(1);
    expect(citations[0]?.uri).toBe(
      'https://fonte-valida.com/artigo'
    );
    expect(citations[0]?.title).toBe('Fonte válida');
    expect(citations[0]?.supportedText).toContain(
      'Trecho sustentado pela fonte válida.'
    );

    expect(
      citations.some(
        (citation) =>
          citation.uri ===
          'https://fonte-nao-utilizada.com/artigo'
      )
    ).toBe(false);
  });
});