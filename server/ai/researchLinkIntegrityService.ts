import { normalizePublicHttpsUrl } from './citationService.js';
import { MessageCitation } from './types/ai.js';

const MARKDOWN_LINK = /\[([^\]]+)\]\((https:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)/gi;

function canonical(value: string): string | null {
  const url = normalizePublicHttpsUrl(value);
  if (!url) return null;
  url.searchParams.sort();
  return url.href.replace(/\/$/, '');
}

export interface ResearchLinkIntegrityResult {
  text: string;
  removedLinks: number;
}

export class ResearchLinkIntegrityService {
  static enforce(
    text: string,
    citations: MessageCitation[]
  ): ResearchLinkIntegrityResult {
    const approved = new Set(
      citations
        .map((citation) => canonical(citation.uri))
        .filter((uri): uri is string => Boolean(uri))
    );
    let removedLinks = 0;
    const sanitized = text.replace(
      MARKDOWN_LINK,
      (match, label: string, rawUrl: string) => {
        const target = canonical(rawUrl);
        if (target && approved.has(target)) return match;
        removedLinks += 1;
        return label.trim();
      }
    );
    return { text: sanitized, removedLinks };
  }
}
