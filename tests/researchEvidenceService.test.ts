import { describe, expect, it } from 'vitest';
import { ResearchEvidenceService } from '../server/ai/researchEvidenceService.js';

describe('ResearchEvidenceService', () => {
  it('marca como limitada uma pesquisa sustentada por apenas uma fonte', () => {
    const result = ResearchEvidenceService.finalize({
      text: 'O modelo informado está disponível.',
      citations: [
        {
          title: 'Documentação oficial',
          uri: 'https://example.com/docs',
          sourceType: 'web',
          domain: 'example.com',
        },
      ],
      requiresSearch: true,
      sensitivity: 'normal',
      knowledgeBaseRequested: false,
      ragChunksUsed: [],
    });

    expect(result.researchStatus).toBe('limited');
    expect(result.sourceCount).toBe(1);
    expect(result.sourceDomains).toEqual(['example.com']);
    expect(result.text).toContain(
      'A resposta está baseada em uma única fonte verificável.'
    );
  });

  it('considera suportada a pesquisa com duas fontes independentes', () => {
    const result = ResearchEvidenceService.finalize({
      text: 'A informação foi confirmada.',
      citations: [
        {
          title: 'Fonte oficial',
          uri: 'https://example.com/docs',
          sourceType: 'web',
          domain: 'example.com',
        },
        {
          title: 'Segunda fonte',
          uri: 'https://example.org/report',
          sourceType: 'web',
          domain: 'example.org',
        },
      ],
      requiresSearch: true,
      sensitivity: 'normal',
      knowledgeBaseRequested: false,
      ragChunksUsed: [],
    });

    expect(result.researchStatus).toBe('supported');
    expect(result.sourceCount).toBe(2);
    expect(result.sourceDomains).toEqual([
      'example.com',
      'example.org',
    ]);
  });
});