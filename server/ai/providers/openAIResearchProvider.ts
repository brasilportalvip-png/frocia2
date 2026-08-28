import { env } from '../../config/env.js';
import { normalizePublicHttpsUrl } from '../citationService.js';
import { MessageCitation } from '../types/ai.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_CITATIONS = 100;

type JsonRecord = Record<string, unknown>;

export type OpenAIResearchStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete';

export interface OpenAIResearchAction {
  type: 'search' | 'open_page' | 'find_in_page' | 'other';
  query?: string;
  url?: string;
  pattern?: string;
  sourceCount: number;
}

export interface OpenAIResearchSnapshot {
  responseId: string;
  status: OpenAIResearchStatus;
  model: string;
  text: string;
  citations: MessageCitation[];
  actions: OpenAIResearchAction[];
  inputTokens: number;
  outputTokens: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export class OpenAIResearchProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'OpenAIResearchProviderError';
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object'
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeString(value: unknown, maxLength = 4_000): string {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .replace(/[\x00-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
    : '';
}

function safeOutputText(value: unknown, maxLength = 200_000): string {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .trim()
        .slice(0, maxLength)
    : '';
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function normalizedStatus(value: unknown): OpenAIResearchStatus {
  return [
    'queued',
    'in_progress',
    'completed',
    'failed',
    'cancelled',
    'incomplete',
  ].includes(String(value))
    ? (String(value) as OpenAIResearchStatus)
    : 'failed';
}

function sourceDomain(url: URL): string {
  return url.hostname.replace(/^www\./, '').toLowerCase();
}

function annotationCitation(
  annotationValue: unknown,
  text: string
): MessageCitation | null {
  const annotation = asRecord(annotationValue);
  const nested = asRecord(annotation.url_citation);
  const citation = Object.keys(nested).length > 0 ? nested : annotation;

  if (
    annotation.type !== 'url_citation' &&
    citation.type !== 'url_citation' &&
    !citation.url
  ) {
    return null;
  }

  const url = normalizePublicHttpsUrl(citation.url);
  if (!url) return null;

  const rawStart = safeInteger(citation.start_index);
  const rawEnd = safeInteger(citation.end_index);
  const startIndex = rawStart === null ? undefined : Math.min(rawStart, text.length);
  const endIndex =
    rawEnd === null || startIndex === undefined
      ? undefined
      : Math.max(startIndex, Math.min(rawEnd, text.length));
  const supportedText =
    startIndex !== undefined && endIndex !== undefined
      ? text.slice(startIndex, endIndex).trim().slice(0, 500)
      : '';

  return {
    title: safeString(citation.title, 300) || sourceDomain(url),
    uri: url.href,
    snippet: supportedText || undefined,
    sourceType: 'web',
    domain: sourceDomain(url),
    startIndex,
    endIndex,
    supportedText: supportedText || undefined,
  };
}

function actionFromItem(itemValue: unknown): OpenAIResearchAction | null {
  const item = asRecord(itemValue);
  if (item.type !== 'web_search_call') return null;
  const action = asRecord(item.action);
  const rawType = safeString(action.type, 40);
  const type: OpenAIResearchAction['type'] = [
    'search',
    'open_page',
    'find_in_page',
  ].includes(rawType)
    ? (rawType as OpenAIResearchAction['type'])
    : 'other';

  return {
    type,
    query: safeString(action.query, 500) || undefined,
    url: normalizePublicHttpsUrl(action.url)?.href,
    pattern: safeString(action.pattern, 300) || undefined,
    sourceCount: asArray(action.sources).length,
  };
}

function citationsFromSources(output: unknown[]): MessageCitation[] {
  return output.flatMap((itemValue) => {
    const item = asRecord(itemValue);
    if (item.type !== 'web_search_call') return [];
    const action = asRecord(item.action);

    return asArray(action.sources).flatMap((sourceValue) => {
      const source = asRecord(sourceValue);
      const url = normalizePublicHttpsUrl(source.url);
      if (!url) return [];
      return [
        {
          title: safeString(source.title, 300) || sourceDomain(url),
          uri: url.href,
          sourceType: 'web' as const,
          domain: sourceDomain(url),
        },
      ];
    });
  });
}

function mergeCitations(values: MessageCitation[]): MessageCitation[] {
  const byUrl = new Map<string, MessageCitation>();

  for (const citation of values) {
    const current = byUrl.get(citation.uri);
    if (!current || (!current.supportedText && citation.supportedText)) {
      byUrl.set(citation.uri, citation);
    }
  }

  return [...byUrl.values()]
    .slice(0, MAX_CITATIONS)
    .map((citation, index) => ({ ...citation, index: index + 1 }));
}

export function parseOpenAIResearchResponse(
  payloadValue: unknown
): OpenAIResearchSnapshot {
  const payload = asRecord(payloadValue);
  const output = asArray(payload.output);
  let text = safeOutputText(payload.output_text);
  const annotatedCitations: MessageCitation[] = [];

  for (const itemValue of output) {
    const item = asRecord(itemValue);
    if (item.type !== 'message') continue;

    for (const contentValue of asArray(item.content)) {
      const content = asRecord(contentValue);
      if (content.type !== 'output_text') continue;
      const contentText = safeOutputText(content.text);
      if (!text && contentText) text = contentText;

      for (const annotation of asArray(content.annotations)) {
        const parsed = annotationCitation(annotation, contentText || text);
        if (parsed) annotatedCitations.push(parsed);
      }
    }
  }

  const usage = asRecord(payload.usage);
  const error = asRecord(payload.error);
  const incomplete = asRecord(payload.incomplete_details);
  const status = normalizedStatus(payload.status);

  return {
    responseId: safeString(payload.id, 200),
    status,
    model: safeString(payload.model, 160),
    text,
    citations: mergeCitations([
      ...annotatedCitations,
      ...citationsFromSources(output),
    ]),
    actions: output
      .map(actionFromItem)
      .filter((action): action is OpenAIResearchAction => Boolean(action)),
    inputTokens: safeInteger(usage.input_tokens) || 0,
    outputTokens: safeInteger(usage.output_tokens) || 0,
    errorCode:
      safeString(error.code, 100) ||
      safeString(incomplete.reason, 100) ||
      null,
    errorMessage: safeString(error.message, 500) || null,
  };
}

function publicError(status: number): OpenAIResearchProviderError {
  if (status === 401 || status === 403) {
    return new OpenAIResearchProviderError(
      'openai_not_authorized',
      'A OpenAI recusou a chave ou as permissões configuradas.',
      status
    );
  }
  if (status === 429) {
    return new OpenAIResearchProviderError(
      'openai_quota_exhausted',
      'A OpenAI recusou a pesquisa por limite de uso ou faturamento.',
      status
    );
  }
  return new OpenAIResearchProviderError(
    'openai_research_failed',
    'A OpenAI não conseguiu concluir a operação de pesquisa.',
    status
  );
}

async function request(
  path: string,
  init: RequestInit,
  runtime: { fetchFn?: typeof fetch; apiKey?: string } = {}
): Promise<unknown> {
  const apiKey = runtime.apiKey || env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAIResearchProviderError(
      'openai_not_configured',
      'A pesquisa OpenAI não está configurada.',
      503
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await (runtime.fetchFn || fetch)(
      `${OPENAI_RESPONSES_URL}${path}`,
      {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      }
    );

    if (!response.ok) throw publicError(response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof OpenAIResearchProviderError) throw error;
    if (controller.signal.aborted) {
      throw new OpenAIResearchProviderError(
        'openai_timeout',
        'A OpenAI não respondeu dentro do limite de tempo.',
        504
      );
    }
    throw new OpenAIResearchProviderError(
      'openai_unreachable',
      'Não foi possível conectar ao serviço de pesquisa da OpenAI.',
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

export class OpenAIResearchProvider {
  static isConfigured(): boolean {
    return (
      env.OPENAI_RESEARCH_ENABLED === 'true' &&
      Boolean(env.OPENAI_API_KEY?.trim())
    );
  }

  static async start(
    input: {
      prompt: string;
      instructions: string;
      model?: string;
      maxToolCalls?: number;
    },
    runtime: { fetchFn?: typeof fetch; apiKey?: string } = {}
  ): Promise<OpenAIResearchSnapshot> {
    const model = input.model || env.OPENAI_RESEARCH_MODEL;
    const maxToolCalls = Math.max(
      4,
      Math.min(100, input.maxToolCalls || env.OPENAI_RESEARCH_MAX_TOOL_CALLS)
    );
    const payload = await request(
      '',
      {
        method: 'POST',
        body: JSON.stringify({
          model,
          instructions: input.instructions,
          input: input.prompt,
          background: true,
          store: false,
          reasoning: {
            effort: env.OPENAI_RESEARCH_REASONING_EFFORT,
          },
          tools: [
            {
              type: 'web_search',
              return_token_budget: 'unlimited',
            },
          ],
          tool_choice: 'required',
          max_tool_calls: maxToolCalls,
          include: ['web_search_call.action.sources'],
        }),
      },
      runtime
    );

    return parseOpenAIResearchResponse(payload);
  }

  static async retrieve(
    responseId: string,
    runtime: { fetchFn?: typeof fetch; apiKey?: string } = {}
  ): Promise<OpenAIResearchSnapshot> {
    if (!/^resp_[A-Za-z0-9_-]{4,200}$/.test(responseId)) {
      throw new OpenAIResearchProviderError(
        'openai_response_id_invalid',
        'O identificador da pesquisa OpenAI é inválido.',
        400
      );
    }
    const payload = await request(`/${responseId}`, { method: 'GET' }, runtime);
    return parseOpenAIResearchResponse(payload);
  }

  static async cancel(
    responseId: string,
    runtime: { fetchFn?: typeof fetch; apiKey?: string } = {}
  ): Promise<OpenAIResearchSnapshot> {
    if (!/^resp_[A-Za-z0-9_-]{4,200}$/.test(responseId)) {
      throw new OpenAIResearchProviderError(
        'openai_response_id_invalid',
        'O identificador da pesquisa OpenAI é inválido.',
        400
      );
    }
    const payload = await request(
      `/${responseId}/cancel`,
      { method: 'POST' },
      runtime
    );
    return parseOpenAIResearchResponse(payload);
  }
}
