import { isIP } from 'node:net';
import {
  KnowledgeChunk,
  MessageCitation,
} from './types/ai.js';
import { SocialSearchItem } from './socialSearchService.js';

const MAX_TITLE_LENGTH = 240;
const MAX_SNIPPET_LENGTH = 500;

function cleanText(
  value: unknown,
  maxLength: number
): string {
  if (typeof value !== 'string') return '';

  return value
    .normalize('NFKC')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function isBlockedIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255
    )
  ) {
    return true;
  }

  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase();

  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }

  const mappedIpv4 = normalized.match(
    /(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/
  )?.[1];

  return mappedIpv4
    ? isBlockedIpv4(mappedIpv4)
    : false;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname
    .replace(/\.$/, '')
    .toLowerCase();

  if (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home.arpa')
  ) {
    return true;
  }

  const ipVersion = isIP(
    normalized.replace(/^\[|\]$/g, '')
  );

  if (ipVersion === 4) {
    return isBlockedIpv4(normalized);
  }

  if (ipVersion === 6) {
    return isBlockedIpv6(normalized);
  }

  return false;
}

export function normalizePublicHttpsUrl(
  value: unknown
): URL | null {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value.trim());

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      isBlockedHostname(url.hostname)
    ) {
      return null;
    }

    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function sourceDomain(url: URL): string {
  return url.hostname
    .replace(/^www\./, '')
    .toLowerCase();
}

function numberCitations(
  citations: MessageCitation[]
): MessageCitation[] {
  return citations.map((citation, index) => ({
    ...citation,
    index: index + 1,
  }));
}

export class CitationService {
  static buildSocialCitations(
    items: SocialSearchItem[]
  ): MessageCitation[] {
    const citations = items.flatMap(
      (item): MessageCitation[] => {
        const url = normalizePublicHttpsUrl(
          item.permalink
        );
        if (!url) return [];

        return [
          {
            title: cleanText(
              item.title,
              MAX_TITLE_LENGTH
            ),
            uri: url.href,
            snippet: cleanText(
              item.text,
              MAX_SNIPPET_LENGTH
            ),
            sourceType: 'social',
            domain: sourceDomain(url),
            retrievedAt: item.retrievedAt,
            platform: item.platform,
            account: item.accountHandle,
            externalId: item.externalId,
            accessMode:
              item.platform === 'youtube'
                ? 'public_api'
                : 'authenticated_api',
          },
        ];
      }
    );

    return numberCitations(citations);
  }

  static buildRAGCitationPill(
    chunk: KnowledgeChunk,
    filename?: string
  ): MessageCitation {
    const snippet = cleanText(
      chunk.text,
      MAX_SNIPPET_LENGTH
    );

    return {
      title:
        cleanText(
          filename || chunk.filename,
          MAX_TITLE_LENGTH
        ) ||
        `Documento RAG #${chunk.documentId.substring(0, 6)}`,
      uri: `#knowledge-chunk-${chunk.id}`,
      snippet:
        snippet.length === MAX_SNIPPET_LENGTH
          ? `${snippet}…`
          : snippet,
      sourceType: 'knowledge_base',
      docId: chunk.documentId,
      retrievedAt: new Date().toISOString(),
    };
  }

  static extractSearchGroundingCitations(
    groundingMetadata: unknown
  ): MessageCitation[] {
    const chunks =
      groundingMetadata &&
      typeof groundingMetadata === 'object' &&
      Array.isArray(
        (groundingMetadata as any).groundingChunks
      )
        ? (groundingMetadata as any).groundingChunks
        : [];

    const citations: MessageCitation[] = [];
    const seen = new Set<string>();

    for (const chunk of chunks) {
      const url = normalizePublicHttpsUrl(
        chunk?.web?.uri
      );

      if (!url || seen.has(url.href)) continue;
      seen.add(url.href);

      citations.push({
        title:
          cleanText(
            chunk?.web?.title,
            MAX_TITLE_LENGTH
          ) || sourceDomain(url),
        uri: url.href,
        snippet: cleanText(
          chunk?.web?.snippet,
          MAX_SNIPPET_LENGTH
        ),
        sourceType: 'web',
        domain: sourceDomain(url),
        retrievedAt: new Date().toISOString(),
      });
    }

    return numberCitations(citations);
  }

  static mergeCitations(
    ...groups: MessageCitation[][]
  ): MessageCitation[] {
    const merged: MessageCitation[] = [];
    const seen = new Set<string>();

    for (const citation of groups.flat()) {
      const normalizedWebUrl =
        citation.sourceType === 'web' ||
        citation.sourceType === 'social'
          ? normalizePublicHttpsUrl(citation.uri)?.href
          : null;
      const key =
        citation.sourceType === 'web' ||
        citation.sourceType === 'social'
          ? normalizedWebUrl
          : `${citation.sourceType}:${citation.docId || citation.uri}`;

      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...citation,
        uri: normalizedWebUrl || citation.uri,
      });
    }

    return numberCitations(merged);
  }
}
