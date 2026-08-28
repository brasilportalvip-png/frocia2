import { describe, expect, it, vi } from 'vitest';
import { CitationUrlResolver } from '../server/ai/citationUrlResolver.js';

const REDIRECT_URL =
  'https://vertexaisearch.cloud.google.com/grounding-api-redirect/source-token';

describe('Resolução segura de URLs de pesquisa', () => {
  it('substitui o redirecionamento do grounding pela URL pública final', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: {
          Location:
            'https://www.example.com/noticia?id=42#trecho',
        },
      })
    );

    const result = await CitationUrlResolver.resolve(
      {
        text: `Fonte: [notícia](${REDIRECT_URL})`,
        citations: [
          {
            title: 'Notícia',
            uri: REDIRECT_URL,
            sourceType: 'web',
            domain: 'vertexaisearch.cloud.google.com',
          },
        ],
      },
      { fetchFn: fetchFn as unknown as typeof fetch }
    );

    expect(result.text).toContain(
      'https://www.example.com/noticia?id=42'
    );
    expect(result.text).not.toContain(
      'grounding-api-redirect'
    );
    expect(result.citations[0]).toMatchObject({
      uri: 'https://www.example.com/noticia?id=42',
      domain: 'example.com',
    });
    expect(result.resolvedCount).toBe(1);
  });

  it('recusa destino privado ou não HTTPS', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: {
          Location: 'http://127.0.0.1/admin',
        },
      })
    );

    const result = await CitationUrlResolver.resolve(
      {
        text: REDIRECT_URL,
        citations: [],
      },
      { fetchFn: fetchFn as unknown as typeof fetch }
    );

    expect(result.text).toBe(REDIRECT_URL);
    expect(result.resolvedCount).toBe(0);
  });

  it('não acessa URLs comuns nem altera citações sociais', async () => {
    const fetchFn = vi.fn();
    const result = await CitationUrlResolver.resolve(
      {
        text: 'https://bsky.app/profile/exemplo/post/abc',
        citations: [
          {
            title: 'Post',
            uri: 'https://bsky.app/profile/exemplo/post/abc',
            sourceType: 'social',
            platform: 'bluesky',
          },
        ],
      },
      { fetchFn: fetchFn as unknown as typeof fetch }
    );

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.citations[0].uri).toBe(
      'https://bsky.app/profile/exemplo/post/abc'
    );
  });
});
