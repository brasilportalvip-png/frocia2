import { normalizePublicHttpsUrl } from './citationService.js';
import { MessageCitation } from './types/ai.js';

const GROUNDING_REDIRECT_HOST =
  'vertexaisearch.cloud.google.com';
const GROUNDING_REDIRECT_PATH =
  '/grounding-api-redirect/';
const MAX_REDIRECTS = 4;
const MAX_URLS_PER_RESPONSE = 20;
const REDIRECT_TIMEOUT_MS = 4_000;
const GROUNDING_URL_PATTERN =
  /https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s<>"\])}]+/g;

function isGroundingRedirect(url: URL): boolean {
  return (
    url.hostname.toLowerCase() ===
      GROUNDING_REDIRECT_HOST &&
    url.pathname.startsWith(
      GROUNDING_REDIRECT_PATH
    )
  );
}

function sourceDomain(url: URL): string {
  return url.hostname
    .replace(/^www\./, '')
    .toLowerCase();
}

async function resolveOne(
  rawUrl: string,
  fetchFn: typeof fetch
): Promise<string | null> {
  let current = normalizePublicHttpsUrl(rawUrl);
  if (!current || !isGroundingRedirect(current)) {
    return null;
  }

  for (
    let redirectCount = 0;
    redirectCount < MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REDIRECT_TIMEOUT_MS
    );

    try {
      const response = await fetchFn(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent':
            'Froc.IA/1.0 (+https://frocia2.vercel.app)',
        },
      });
      void response.body?.cancel().catch(() => undefined);

      if (
        response.status < 300 ||
        response.status >= 400
      ) {
        return isGroundingRedirect(current)
          ? null
          : current.href;
      }

      const location = response.headers.get('location');
      if (!location) return null;

      const next = normalizePublicHttpsUrl(
        new URL(location, current).href
      );
      if (!next) return null;

      if (!isGroundingRedirect(next)) {
        return next.href;
      }

      current = next;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

export interface ResolvedCitationPayload {
  text: string;
  citations: MessageCitation[];
  resolvedCount: number;
}

export class CitationUrlResolver {
  static async resolve(
    input: {
      text: string;
      citations: MessageCitation[];
    },
    runtime: { fetchFn?: typeof fetch } = {}
  ): Promise<ResolvedCitationPayload> {
    const fetchFn = runtime.fetchFn || fetch;
    const candidates = new Set<string>();

    for (const citation of input.citations) {
      const url = normalizePublicHttpsUrl(
        citation.uri
      );
      if (url && isGroundingRedirect(url)) {
        candidates.add(url.href);
      }
    }

    for (const match of input.text.matchAll(
      GROUNDING_URL_PATTERN
    )) {
      const url = normalizePublicHttpsUrl(match[0]);
      if (url && isGroundingRedirect(url)) {
        candidates.add(url.href);
      }
    }

    const selected = [...candidates].slice(
      0,
      MAX_URLS_PER_RESPONSE
    );
    const resolvedEntries = await Promise.all(
      selected.map(async (source) => [
        source,
        await resolveOne(source, fetchFn),
      ] as const)
    );
    const resolved = new Map(
      resolvedEntries.filter(
        (entry): entry is readonly [string, string] =>
          Boolean(entry[1])
      )
    );

    let text = input.text;
    for (const [source, destination] of resolved) {
      text = text.split(source).join(destination);
    }

    const citations = input.citations.map(
      (citation): MessageCitation => {
        const source = normalizePublicHttpsUrl(
          citation.uri
        )?.href;
        const destination = source
          ? resolved.get(source)
          : null;
        if (!destination) return citation;

        const destinationUrl =
          normalizePublicHttpsUrl(destination);
        if (!destinationUrl) return citation;

        return {
          ...citation,
          uri: destinationUrl.href,
          domain: sourceDomain(destinationUrl),
        };
      }
    );

    return {
      text,
      citations,
      resolvedCount: resolved.size,
    };
  }
}
