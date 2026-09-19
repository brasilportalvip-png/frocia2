import { normalizePublicHttpsUrl } from './citationService.js';
import { MessageCitation } from './types/ai.js';

function canonical(value: string): string | null {
  const url = normalizePublicHttpsUrl(value);
  if (!url) return null;
  url.searchParams.sort();
  return url.href.replace(/\/$/, '');
}

interface ParsedMarkdownLink {
  start: number;
  end: number;
  label: string;
  url: string;
}

function nextMarkdownLink(text: string, from: number): ParsedMarkdownLink | null {
  const opening = text.indexOf('[', from);
  if (opening < 0) return null;
  const labelEnd = text.indexOf('](', opening + 1);
  if (labelEnd < 0) return null;
  const label = text.slice(opening + 1, labelEnd);
  if (!label || label.includes('\n')) return nextMarkdownLink(text, opening + 1);

  const urlStart = labelEnd + 2;
  if (!text.slice(urlStart).toLowerCase().startsWith('https://')) {
    return nextMarkdownLink(text, opening + 1);
  }

  let depth = 0;
  for (let index = urlStart; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character) && depth === 0) return null;
    if (character === '(') depth += 1;
    if (character !== ')') continue;
    if (depth > 0) {
      depth -= 1;
      continue;
    }
    return {
      start: opening,
      end: index + 1,
      label,
      url: text.slice(urlStart, index),
    };
  }
  return null;
}

function sanitizeLinks(text: string, approved: Set<string>): ResearchLinkIntegrityResult {
  let cursor = 0;
  let output = '';
  let removedLinks = 0;
  while (cursor < text.length) {
    const link = nextMarkdownLink(text, cursor);
    if (!link) {
      output += text.slice(cursor);
      break;
    }
    output += text.slice(cursor, link.start);
    const target = canonical(link.url);
    if (target && approved.has(target)) {
      output += text.slice(link.start, link.end);
    } else {
      output += link.label.trim();
      removedLinks += 1;
    }
    cursor = link.end;
  }
  return { text: output, removedLinks };
}

function verifiedSources(citations: MessageCitation[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const citation of citations) {
    const target = canonical(citation.uri);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    const title = citation.title.replace(/[\[\]\r\n]/g, ' ').trim() || citation.domain || 'Fonte';
    lines.push(`- [${title}](${citation.uri})`);
  }
  return lines.length ? `**Links diretos verificados**\n\n${lines.join('\n')}` : '';
}

export interface ResearchLinkIntegrityResult {
  text: string;
  removedLinks: number;
}

export class ResearchLinkIntegrityService {
  static enforce(
    text: string,
    citations: MessageCitation[],
    options: { appendVerifiedSources?: boolean } = {}
  ): ResearchLinkIntegrityResult {
    const approved = new Set(
      citations
        .map((citation) => canonical(citation.uri))
        .filter((uri): uri is string => Boolean(uri))
    );
    const result = sanitizeLinks(text, approved);
    const sourceSection = options.appendVerifiedSources
      ? verifiedSources(citations)
      : '';
    return {
      ...result,
      text: sourceSection
        ? `${result.text.trim()}\n\n${sourceSection}`
        : result.text,
    };
  }
}
