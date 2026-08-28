import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CitationService } from '../server/ai/citationService.js';
import { AIRequestOrchestrator } from '../server/ai/requestOrchestrator.js';
import { ResearchEvidenceService } from '../server/ai/researchEvidenceService.js';
import {
  SOCIAL_PLATFORMS,
  SocialSearchService,
} from '../server/ai/socialSearchService.js';
import {
  SocialSearchPolicyService,
  SocialSearchRateLimitError,
} from '../server/ai/socialSearchPolicyService.js';
import { InMemoryToolExecutionStateStore } from '../server/ai/toolExecutionStore.js';

const NOW = new Date('2026-08-27T12:00:00.000Z');

function response(
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchMock(
  ...responses: Response[]
): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected_fetch');
    return next;
  });
}

describe('Pesquisa oficial e verificável em redes sociais', () => {
  it('distingue plataformas explícitas de uma busca social genérica', () => {
    expect(
      SocialSearchService.extractRequestedPlatforms(
        'Pesquise vídeos recentes no YouTube e posts no X'
      )
    ).toEqual(['youtube', 'x']);
    expect(
      SocialSearchService.extractRequestedPlatforms(
        'Busque tendências nas redes sociais'
      )
    ).toEqual([...SOCIAL_PLATFORMS]);
    expect(
      SocialSearchService.shouldSearch(
        'Crie uma legenda para Instagram',
        'smart'
      )
    ).toBe(false);
    expect(
      SocialSearchService.shouldSearch(
        'Pesquise menções recentes no Instagram',
        'smart'
      )
    ).toBe(true);
  });

  it('não chama rede sem credencial e não finge acesso', async () => {
    const mock = fetchMock();
    const report = await SocialSearchService.search(
      {
        query: 'Pesquise inteligência artificial no X e LinkedIn',
        platforms: ['x', 'linkedin'],
      },
      { fetchFn: mock as unknown as typeof fetch, env: {}, now: NOW }
    );

    expect(mock).not.toHaveBeenCalled();
    expect(report.items).toEqual([]);
    expect(report.hasOfficialApiEvidence).toBe(false);
    expect(report.results).toEqual([
      expect.objectContaining({
        platform: 'x',
        status: 'not_configured',
      }),
      expect.objectContaining({
        platform: 'linkedin',
        status: 'unsupported',
        accessMode: 'unavailable',
      }),
    ]);
    expect(
      SocialSearchService.evidenceStatus(report)
    ).toBe('unsupported');
  });

  it('pesquisa vídeos públicos pela YouTube Data API e cria permalink', async () => {
    const mock = fetchMock(
      response({
        items: [
          {
            id: { videoId: 'video123' },
            snippet: {
              channelId: 'channel9',
              channelTitle: 'Canal Oficial',
              title: 'Notícia verificada',
              description: 'Descrição pública',
              publishedAt: '2026-08-27T10:00:00Z',
            },
          },
        ],
      })
    );
    const report = await SocialSearchService.search(
      {
        query: 'notícia verificada',
        platforms: ['youtube'],
        limit: 5,
      },
      {
        fetchFn: mock as unknown as typeof fetch,
        env: { YOUTUBE_DATA_API_KEY: 'youtube-secret' },
        now: NOW,
      }
    );

    expect(report.items[0]).toMatchObject({
      platform: 'youtube',
      externalId: 'video123',
      accountId: 'channel9',
      accountHandle: 'Canal Oficial',
      permalink:
        'https://www.youtube.com/watch?v=video123',
    });
    expect(JSON.stringify(report)).not.toContain(
      'youtube-secret'
    );
    expect(String(mock.mock.calls[0][0])).toContain(
      'www.googleapis.com/youtube/v3/search'
    );
  });

  it('pesquisa posts públicos do Bluesky sem credencial e preserva o permalink', async () => {
    const mock = fetchMock(
      response({
        posts: [
          {
            uri: 'at://did:plc:abc/app.bsky.feed.post/post123',
            indexedAt: '2026-08-28T10:00:00.000Z',
            author: {
              did: 'did:plc:abc',
              handle: 'frocia.bsky.social',
            },
            record: {
              text: 'Pesquisa pública verificável no Bluesky.',
              createdAt: '2026-08-28T09:59:00.000Z',
            },
            likeCount: 12,
            replyCount: 3,
            repostCount: 4,
            quoteCount: 1,
          },
        ],
      })
    );
    const report = await SocialSearchService.search(
      {
        query: 'Froc IA',
        platforms: ['bluesky'],
        limit: 10,
      },
      { fetchFn: mock as unknown as typeof fetch, env: {}, now: NOW }
    );

    expect(report.items).toEqual([
      expect.objectContaining({
        platform: 'bluesky',
        accountHandle: 'frocia.bsky.social',
        permalink: 'https://bsky.app/profile/frocia.bsky.social/post/post123',
        metrics: { likes: 12, replies: 3, reposts: 4, quotes: 1 },
      }),
    ]);
    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining('public.api.bsky.app/xrpc/app.bsky.feed.searchPosts'),
      expect.any(Object)
    );
    expect(SocialSearchService.evidenceStatus(report)).toBe('supported');
  });

  it('aumenta a cobertura por rede quando o usuário pede pesquisa profunda', () => {
    expect(SocialSearchService.requestedLimit('Pesquise este tema')).toBe(5);
    expect(
      SocialSearchService.requestedLimit('Faça uma pesquisa profunda e completa')
    ).toBe(10);
  });

  it('declara pesquisa profunda parcial quando não há duas fontes independentes', () => {
    const result = ResearchEvidenceService.finalize({
      text: 'Conclusão preliminar.',
      citations: [
        {
          title: 'Fonte única',
          uri: 'https://example.com/fonte',
          domain: 'example.com',
          sourceType: 'web',
        },
      ],
      requiresSearch: true,
      sensitivity: 'normal',
      knowledgeBaseRequested: false,
      ragChunksUsed: [],
      minimumSourceDomains: 2,
    });
    expect(result.researchStatus).toBe('limited');
    expect(result.text).toContain('cobertura completa da internet');
  });

  it('pesquisa posts recentes no X com bearer somente no header', async () => {
    const mock = fetchMock(
      response({
        data: [
          {
            id: '19001',
            author_id: '42',
            text: 'Resultado oficial da busca',
            created_at: '2026-08-27T11:00:00Z',
            public_metrics: {
              like_count: 9,
              reply_count: 2,
              retweet_count: 3,
              quote_count: 1,
            },
          },
        ],
        includes: {
          users: [
            { id: '42', username: 'froc_ai', name: 'Froc IA' },
          ],
        },
      })
    );
    const report = await SocialSearchService.search(
      {
        query: 'Froc IA',
        platforms: ['x'],
        account: '@froc_ai',
      },
      {
        fetchFn: mock as unknown as typeof fetch,
        env: { X_BEARER_TOKEN: 'x-secret' },
        now: NOW,
      }
    );

    expect(report.items[0]).toMatchObject({
      platform: 'x',
      externalId: '19001',
      accountHandle: 'froc_ai',
      permalink: 'https://x.com/froc_ai/status/19001',
      metrics: {
        likes: 9,
        replies: 2,
        reposts: 3,
        quotes: 1,
      },
    });
    const init = mock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer x-secret',
      })
    );
    expect(String(mock.mock.calls[0][0])).not.toContain(
      'x-secret'
    );
    expect(JSON.stringify(report)).not.toContain('x-secret');
  });

  it('pesquisa Reddit por OAuth e preserva subreddit, autor e data', async () => {
    const mock = fetchMock(
      response({
        data: {
          children: [
            {
              data: {
                id: 'abc123',
                author: 'usuario_publico',
                subreddit: 'tecnologia',
                title: 'Discussão relevante',
                selftext: 'Conteúdo público resumido',
                permalink: '/r/tecnologia/comments/abc123/discussao/',
                created_utc: 1787832000,
                score: 20,
                num_comments: 4,
              },
            },
          ],
        },
      })
    );
    const report = await SocialSearchService.search(
      {
        query: 'tecnologia',
        platforms: ['reddit'],
      },
      {
        fetchFn: mock as unknown as typeof fetch,
        env: {
          REDDIT_ACCESS_TOKEN: 'reddit-secret',
          REDDIT_USER_AGENT: 'frocia2/1.0 by test',
        },
        now: NOW,
      }
    );

    expect(report.items[0]).toMatchObject({
      platform: 'reddit',
      accountId: 'tecnologia',
      accountHandle: 'usuario_publico',
      permalink:
        'https://www.reddit.com/r/tecnologia/comments/abc123/discussao/',
      metrics: { score: 20, comments: 4 },
    });
    expect(JSON.stringify(report)).not.toContain(
      'reddit-secret'
    );
  });

  it('obtém token application-only do Reddit sem devolvê-lo', async () => {
    const mock = fetchMock(
      response({ access_token: 'generated-token' }),
      response({ data: { children: [] } })
    );
    const report = await SocialSearchService.search(
      { query: 'tema', platforms: ['reddit'] },
      {
        fetchFn: mock as unknown as typeof fetch,
        env: {
          REDDIT_CLIENT_ID: 'client-id',
          REDDIT_CLIENT_SECRET: 'client-secret',
          REDDIT_USER_AGENT: 'frocia2/1.0 by test',
        },
        now: NOW,
      }
    );

    expect(mock).toHaveBeenCalledTimes(2);
    expect(String(mock.mock.calls[0][0])).toBe(
      'https://www.reddit.com/api/v1/access_token'
    );
    expect(JSON.stringify(report)).not.toContain(
      'generated-token'
    );
    expect(JSON.stringify(report)).not.toContain(
      'client-secret'
    );
  });

  it('pesquisa hashtag no Instagram em duas chamadas oficiais', async () => {
    const mock = fetchMock(
      response({ data: [{ id: 'hashtag77' }] }),
      response({
        data: [
          {
            id: 'media55',
            username: 'criador',
            caption: 'Conteúdo com #froc',
            permalink: 'https://www.instagram.com/p/media55/',
            timestamp: '2026-08-27T11:00:00Z',
          },
        ],
      })
    );
    const report = await SocialSearchService.search(
      {
        query: '#froc novidades',
        platforms: ['instagram'],
      },
      {
        fetchFn: mock as unknown as typeof fetch,
        env: {
          META_ACCESS_TOKEN: 'meta-secret',
          META_GRAPH_API_VERSION: 'v99.0',
          INSTAGRAM_USER_ID: 'ig-user-1',
        },
        now: NOW,
      }
    );

    expect(mock).toHaveBeenCalledTimes(2);
    expect(String(mock.mock.calls[0][0])).toContain(
      '/v99.0/ig_hashtag_search?'
    );
    expect(String(mock.mock.calls[1][0])).toContain(
      '/v99.0/hashtag77/recent_media?'
    );
    expect(String(mock.mock.calls[0][0])).not.toContain(
      'meta-secret'
    );
    expect(report.items[0]).toMatchObject({
      platform: 'instagram',
      accountHandle: 'criador',
      permalink: 'https://www.instagram.com/p/media55/',
    });
  });

  it('limita Facebook à busca oficial de Páginas públicas', async () => {
    const mock = fetchMock(
      response({
        data: [
          {
            id: 'page10',
            name: 'Página Oficial',
            link: 'https://www.facebook.com/paginaoficial',
            verification_status: 'blue_verified',
          },
        ],
      })
    );
    const report = await SocialSearchService.search(
      { query: 'Página Oficial', platforms: ['facebook'] },
      {
        fetchFn: mock as unknown as typeof fetch,
        env: {
          META_ACCESS_TOKEN: 'meta-secret',
          META_GRAPH_API_VERSION: 'v99.0',
        },
        now: NOW,
      }
    );

    expect(report.items[0]).toMatchObject({
      platform: 'facebook',
      externalId: 'page10',
      title: 'Página Oficial',
    });
    expect(report.results[0].limitation).toContain(
      'Páginas públicas'
    );
  });

  it('pesquisa TikTok somente na Research API e registra métricas', async () => {
    const mock = fetchMock(
      response({
        data: {
          videos: [
            {
              id: '7412345',
              username: 'criador_tiktok',
              video_description: 'Vídeo relevante',
              create_time: 1787832000,
              view_count: 100,
              like_count: 12,
              comment_count: 3,
              share_count: 2,
            },
          ],
        },
        error: { code: 'ok', message: '' },
      })
    );
    const report = await SocialSearchService.search(
      {
        query: 'inteligência artificial',
        platforms: ['tiktok'],
        startDate: '2026-08-20',
        endDate: '2026-08-27',
      },
      {
        fetchFn: mock as unknown as typeof fetch,
        env: {
          TIKTOK_RESEARCH_ACCESS_TOKEN: 'tiktok-secret',
        },
        now: NOW,
      }
    );

    expect(mock.mock.calls[0][0]).toBe(
      'https://open.tiktokapis.com/v2/research/video/query/?fields=id,video_description,create_time,username,view_count,like_count,comment_count,share_count'
    );
    const init = mock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      start_date: '20260820',
      end_date: '20260827',
      max_count: 5,
    });
    expect(report.items[0]).toMatchObject({
      platform: 'tiktok',
      permalink:
        'https://www.tiktok.com/@criador_tiktok/video/7412345',
      metrics: {
        views: 100,
        likes: 12,
        comments: 3,
        shares: 2,
      },
    });
  });

  it('recusa janela do TikTok maior que trinta dias', async () => {
    await expect(
      SocialSearchService.search(
        {
          query: 'tema',
          platforms: ['tiktok'],
          startDate: '2026-06-01',
          endDate: '2026-08-27',
        },
        {
          fetchFn: fetchMock() as unknown as typeof fetch,
          env: {
            TIKTOK_RESEARCH_ACCESS_TOKEN: 'token',
          },
          now: NOW,
        }
      )
    ).rejects.toThrow('no máximo 30 dias');
  });

  it('marca 401/403 como credencial ou escopo recusado', async () => {
    const mock = fetchMock(response({ error: 'forbidden' }, 403));
    const report = await SocialSearchService.search(
      { query: 'tema', platforms: ['x'] },
      {
        fetchFn: mock as unknown as typeof fetch,
        env: { X_BEARER_TOKEN: 'invalid-token' },
        now: NOW,
      }
    );

    expect(report.results[0]).toMatchObject({
      status: 'not_authorized',
      items: [],
    });
    expect(report.results[0].limitation).toContain(
      'recusou a credencial'
    );
  });

  it('aplica limite persistível por usuário e tenant antes de chamar provedores', async () => {
    const store = new InMemoryToolExecutionStateStore();
    const input = {
      userId: 'user-a',
      tenantId: 'tenant-a',
      nowMs: NOW.getTime(),
    };

    for (let index = 0; index < 10; index += 1) {
      await SocialSearchPolicyService.assertAllowed(
        input,
        store
      );
    }

    await expect(
      SocialSearchPolicyService.assertAllowed(
        input,
        store
      )
    ).rejects.toBeInstanceOf(
      SocialSearchRateLimitError
    );
  });

  it('transforma somente permalinks HTTPS públicos em citações sociais', () => {
    const citations = CitationService.buildSocialCitations([
      {
        platform: 'x',
        externalId: '1',
        accountId: '2',
        accountHandle: 'conta',
        title: 'Post público',
        text: 'Texto do post',
        permalink: 'https://x.com/conta/status/1',
        publishedAt: null,
        retrievedAt: NOW.toISOString(),
        metrics: {},
      },
      {
        platform: 'x',
        externalId: '2',
        accountId: '2',
        accountHandle: 'conta',
        title: 'URL interna',
        text: 'Não pode entrar',
        permalink: 'https://127.0.0.1/private',
        publishedAt: null,
        retrievedAt: NOW.toISOString(),
        metrics: {},
      },
    ]);

    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      sourceType: 'social',
      domain: 'x.com',
      platform: 'x',
      account: 'conta',
      externalId: '1',
    });
  });

  it('aceita evidência social oficial no gate de pesquisa', () => {
    const result = ResearchEvidenceService.finalize({
      text: 'Síntese sustentada por um post oficial.',
      citations: [
        {
          title: 'Post oficial',
          uri: 'https://x.com/conta/status/1',
          sourceType: 'social',
          domain: 'x.com',
          platform: 'x',
        },
      ],
      requiresSearch: true,
      sensitivity: 'normal',
      knowledgeBaseRequested: false,
      ragChunksUsed: [],
    });

    expect(result.researchStatus).toBe('supported');
    expect(result.sourceDomains).toEqual(['x.com']);
  });

  it('adiciona social_search automaticamente ao plano de pesquisa social', () => {
    const plan = AIRequestOrchestrator.plan({
      mode: 'research',
      prompt: 'Pesquise menções recentes à Froc.IA no YouTube e Reddit',
    });

    expect(plan.classification.requiresSearch).toBe(true);
    expect(plan.classification.socialPlatforms).toEqual([
      'youtube',
      'reddit',
    ]);
    expect(plan.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['web_search', 'social_search'])
    );
    expect(plan.classification.reasons).toContain(
      'official_social_api_search_required'
    );
  });

  it('expõe capabilities autenticadas e monta contexto sem segredos', () => {
    const capabilities = SocialSearchService.capabilities({
      X_BEARER_TOKEN: 'secret-x',
      META_ACCESS_TOKEN: 'secret-meta',
      META_GRAPH_API_VERSION: 'v99.0',
      INSTAGRAM_USER_ID: 'ig-id',
    });
    expect(
      capabilities.find(
        (capability) => capability.platform === 'x'
      )?.configured
    ).toBe(true);
    expect(JSON.stringify(capabilities)).not.toContain('secret-x');
    expect(JSON.stringify(capabilities)).not.toContain('secret-meta');

    const context = SocialSearchService.toGroundingContext({
      query: 'tema',
      requestedPlatforms: ['linkedin'],
      searchedAt: NOW.toISOString(),
      results: [
        {
          platform: 'linkedin',
          status: 'unsupported',
          accessMode: 'unavailable',
          accountRequested: null,
          checkedAt: NOW.toISOString(),
          items: [],
          limitation: 'Sem busca pública genérica.',
        },
      ],
      items: [],
      limitations: ['Sem busca pública genérica.'],
      hasOfficialApiEvidence: false,
    });
    expect(context).toContain('status');
    expect(context).toContain('não alegue acesso');
  });

  it('monta a rota protegida e documenta todas as credenciais sem valores reais', () => {
    const serverSource = readFileSync(
      new URL('../server.ts', import.meta.url),
      'utf8'
    );
    const envSource = readFileSync(
      new URL('../.env.example', import.meta.url),
      'utf8'
    );
    const routeSource = readFileSync(
      new URL(
        '../server/routes/socialSearchRoutes.ts',
        import.meta.url
      ),
      'utf8'
    );

    expect(serverSource).toContain(
      "app.use('/api/social-search', socialSearchRouter)"
    );
    expect(routeSource).toContain('requireAuth');
    expect(routeSource).toContain('socialSearchLimiter');
    expect(envSource).toContain('YOUTUBE_DATA_API_KEY=');
    expect(envSource).toContain('X_BEARER_TOKEN=');
    expect(envSource).toContain('META_ACCESS_TOKEN=');
    expect(envSource).toContain(
      'TIKTOK_RESEARCH_ACCESS_TOKEN='
    );
    expect(envSource).not.toContain('secret-x');
  });
});
