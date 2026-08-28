import { describe, expect, it, vi } from 'vitest';
import {
  OpenAIResearchProvider,
  parseOpenAIResearchResponse,
} from '../server/ai/providers/openAIResearchProvider.js';

describe('OpenAIResearchProvider', () => {
  it('extrai trajetória, fontes e o trecho exato sustentado por cada citação', () => {
    const text =
      'A documentação oficial confirma que pesquisas longas podem rodar em segundo plano.';
    const start = text.indexOf('pesquisas longas');
    const end = text.length;
    const parsed = parseOpenAIResearchResponse({
      id: 'resp_research123',
      status: 'completed',
      model: 'gpt-5.5',
      output_text: text,
      usage: { input_tokens: 120, output_tokens: 80 },
      output: [
        {
          type: 'web_search_call',
          action: {
            type: 'search',
            query: 'OpenAI background research',
            sources: [
              {
                title: 'Background mode',
                url: 'https://developers.openai.com/api/docs/guides/background',
              },
              { title: 'Bloqueada', url: 'http://127.0.0.1/admin' },
            ],
          },
        },
        {
          type: 'web_search_call',
          action: {
            type: 'open_page',
            url: 'https://developers.openai.com/api/docs/guides/background',
          },
        },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text,
              annotations: [
                {
                  type: 'url_citation',
                  title: 'Background mode',
                  url: 'https://developers.openai.com/api/docs/guides/background',
                  start_index: start,
                  end_index: end,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.status).toBe('completed');
    expect(parsed.actions.map((action) => action.type)).toEqual([
      'search',
      'open_page',
    ]);
    expect(parsed.citations).toHaveLength(1);
    expect(parsed.citations[0]).toMatchObject({
      index: 1,
      domain: 'developers.openai.com',
      startIndex: start,
      endIndex: end,
      supportedText: text.slice(start, end),
    });
    expect(parsed.citations.some((citation) => citation.uri.includes('127.0.0.1'))).toBe(false);
    expect(parsed.inputTokens).toBe(120);
    expect(parsed.outputTokens).toBe(80);
  });

  it('inicia pesquisa em background com busca obrigatória e orçamento limitado', async () => {
    let requestBody: Record<string, unknown> = {};
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}'));
      return new Response(
        JSON.stringify({
          id: 'resp_background123',
          status: 'queued',
          model: 'gpt-5.5',
          output: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const result = await OpenAIResearchProvider.start(
      {
        prompt: 'Compare duas fontes oficiais.',
        instructions: 'Cite todas as conclusões.',
        model: 'gpt-5.5',
        maxToolCalls: 27,
      },
      { fetchFn: fetchFn as typeof fetch, apiKey: 'sk-test-not-real' }
    );

    expect(result.status).toBe('queued');
    expect(requestBody).toMatchObject({
      model: 'gpt-5.5',
      background: true,
      store: false,
      tool_choice: 'required',
      max_tool_calls: 27,
      include: ['web_search_call.action.sources'],
    });
    expect(requestBody.tools).toEqual([
      { type: 'web_search', return_token_budget: 'unlimited' },
    ]);
    expect(JSON.stringify(requestBody)).not.toContain('sk-test-not-real');
  });

  it('transforma limite do provedor em erro público sem vazar o corpo remoto', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: 'secret remote billing detail' } }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      )
    );

    await expect(
      OpenAIResearchProvider.start(
        { prompt: 'Pesquisa', instructions: 'Pesquise.' },
        { fetchFn: fetchFn as typeof fetch, apiKey: 'sk-test-not-real' }
      )
    ).rejects.toMatchObject({
      code: 'openai_quota_exhausted',
      statusCode: 429,
      message: 'A OpenAI recusou a pesquisa por limite de uso ou faturamento.',
    });
  });
});
