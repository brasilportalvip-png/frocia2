import { MessageCitation } from './types/ai.js';
import { OpenAIResearchAction } from './providers/openAIResearchProvider.js';

export interface ResearchQualityAssessment {
  status: 'strong' | 'partial' | 'insufficient';
  score: number;
  sourceCount: number;
  independentDomainCount: number;
  exactCitationCount: number;
  citedClaimCoverage: number;
  searchCount: number;
  openedPageCount: number;
  inPageFindCount: number;
  limitations: string[];
}

interface TextSpan {
  start: number;
  end: number;
}

function claimSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const pattern = /[^\n.!?]+[.!?]?/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[0].trim();
    if (value.length < 45 || match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

function overlaps(first: TextSpan, second: TextSpan): boolean {
  return first.start < second.end && second.start < first.end;
}

function isExactPageCitation(citation: MessageCitation): boolean {
  try {
    const url = new URL(citation.uri);
    return (
      url.protocol === 'https:' &&
      url.pathname !== '/' &&
      Boolean(citation.startIndex !== undefined && citation.endIndex !== undefined)
    );
  } catch {
    return false;
  }
}

export class ResearchQualityService {
  static evaluate(input: {
    text: string;
    citations: MessageCitation[];
    actions: OpenAIResearchAction[];
    minimumDomains?: number;
  }): ResearchQualityAssessment {
    const webCitations = input.citations.filter(
      (citation) =>
        citation.sourceType === 'web' || citation.sourceType === 'social'
    );
    const domains = new Set(
      webCitations.map((citation) => citation.domain).filter(Boolean)
    );
    const exactCitationCount = webCitations.filter(isExactPageCitation).length;
    const claims = claimSpans(input.text);
    const citationSpans = webCitations.flatMap((citation): TextSpan[] =>
      citation.startIndex !== undefined && citation.endIndex !== undefined
        ? [{ start: citation.startIndex, end: citation.endIndex }]
        : []
    );
    const supportedClaims = claims.filter((claim) =>
      citationSpans.some((citation) => overlaps(claim, citation))
    ).length;
    const citedClaimCoverage =
      claims.length > 0
        ? Number((supportedClaims / claims.length).toFixed(3))
        : 0;
    const searchCount = input.actions.filter(
      (action) => action.type === 'search'
    ).length;
    const openedPageCount = input.actions.filter(
      (action) => action.type === 'open_page'
    ).length;
    const inPageFindCount = input.actions.filter(
      (action) => action.type === 'find_in_page'
    ).length;
    const minimumDomains = Math.max(2, input.minimumDomains || 2);
    const limitations: string[] = [];

    if (domains.size < minimumDomains) {
      limitations.push(
        `Foram encontradas ${domains.size} origens independentes; o mínimo esperado era ${minimumDomains}.`
      );
    }
    if (exactCitationCount === 0) {
      limitations.push('Nenhuma citação foi ligada a um trecho exato da resposta.');
    }
    if (openedPageCount === 0) {
      limitations.push('Não há evidência de abertura direta de páginas nesta execução.');
    }
    if (citedClaimCoverage < 0.5) {
      limitations.push(
        'Menos da metade das afirmações extensas possui uma anotação de fonte sobreposta.'
      );
    }

    const score = Math.round(
      Math.min(30, domains.size * 8) +
        Math.min(20, exactCitationCount * 4) +
        Math.min(20, citedClaimCoverage * 20) +
        Math.min(15, searchCount * 5) +
        Math.min(10, openedPageCount * 5) +
        Math.min(5, inPageFindCount * 2.5)
    );
    const status =
      webCitations.length === 0 || domains.size === 0
        ? 'insufficient'
        : score >= 70 && limitations.length <= 1
          ? 'strong'
          : 'partial';

    return {
      status,
      score,
      sourceCount: webCitations.length,
      independentDomainCount: domains.size,
      exactCitationCount,
      citedClaimCoverage,
      searchCount,
      openedPageCount,
      inPageFindCount,
      limitations,
    };
  }
}
