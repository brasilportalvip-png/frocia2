import { describe, expect, it } from 'vitest';
import {
  benchmarkCasePassed,
  RESEARCH_BENCHMARK_V1,
} from '../server/ai/researchBenchmarkCatalog.js';

describe('Benchmark auditável de pesquisa profunda', () => {
  it('possui 100 casos únicos, dez domínios e critérios de alto risco e redes sociais', () => {
    expect(RESEARCH_BENCHMARK_V1).toHaveLength(100);
    expect(new Set(RESEARCH_BENCHMARK_V1.map((item) => item.id)).size).toBe(100);
    expect(new Set(RESEARCH_BENCHMARK_V1.map((item) => item.category)).size).toBe(10);
    expect(RESEARCH_BENCHMARK_V1.filter((item) => item.sensitivity === 'high-stakes').length).toBe(50);
    expect(RESEARCH_BENCHMARK_V1.filter((item) => item.requiresSocialEvidence).length).toBe(10);
    expect(RESEARCH_BENCHMARK_V1.every((item) => item.prompt.includes('Cite inline'))).toBe(true);
  });

  it('não aprova caso social sem evidência social, mesmo com boa pontuação geral', () => {
    const testCase = RESEARCH_BENCHMARK_V1.find((item) => item.requiresSocialEvidence)!;
    const quality = {
      status: 'strong' as const,
      score: 90,
      sourceCount: 6,
      independentDomainCount: 4,
      exactCitationCount: 6,
      citedClaimCoverage: 0.8,
      searchCount: 3,
      openedPageCount: 3,
      inPageFindCount: 2,
      limitations: [],
    };

    expect(
      benchmarkCasePassed({
        testCase,
        quality,
        hasPrimarySource: true,
        hasCurrentSource: true,
        hasSocialEvidence: false,
      })
    ).toBe(false);
    expect(
      benchmarkCasePassed({
        testCase,
        quality,
        hasPrimarySource: true,
        hasCurrentSource: true,
        hasSocialEvidence: true,
      })
    ).toBe(true);
  });
});
