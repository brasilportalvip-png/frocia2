import { GoogleGenAI } from '@google/genai';

export class GeminiProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'GeminiProviderError';
  }
}

export function normalizeGeminiProviderError(
  error: unknown
): GeminiProviderError {
  if (error instanceof GeminiProviderError) {
    return error;
  }

  const details =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : {};
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  const searchable = [
    rawMessage,
    details.code,
    details.status,
  ]
    .join(' ')
    .toUpperCase();

  if (
    searchable.includes('RESOURCE_EXHAUSTED') ||
    searchable.includes('PREPAYMENT CREDITS') ||
    /(?:^|\D)429(?:\D|$)/.test(searchable)
  ) {
    return new GeminiProviderError(
      'gemini_quota_exhausted',
      'O provedor Gemini recusou a execução por limite ou saldo de API. Verifique a cota e o faturamento do projeto configurado.'
    );
  }

  if (
    searchable.includes('UNAUTHENTICATED') ||
    searchable.includes('PERMISSION_DENIED') ||
    /(?:^|\D)(401|403)(?:\D|$)/.test(searchable)
  ) {
    return new GeminiProviderError(
      'gemini_not_authorized',
      'O provedor Gemini recusou a chave ou as permissões configuradas.'
    );
  }

  if (
    searchable.includes('ABORT') ||
    searchable.includes('TIMEOUT') ||
    searchable.includes('DEADLINE_EXCEEDED')
  ) {
    return new GeminiProviderError(
      'gemini_timeout',
      'O provedor Gemini excedeu o tempo limite da solicitação.'
    );
  }

  return new GeminiProviderError(
    'gemini_provider_failed',
    'O provedor Gemini não concluiu a solicitação. Tente novamente ou consulte os registros da execução.'
  );
}

export interface GeminiGenerateOptions {
  model: string;
  systemInstruction?: string;
  userMessage: string;
  attachments?: Array<{
    type: string;
    data?: string;
    mimeType?: string;
    url?: string;
  }>;
  responseFormat?: 'text' | 'json';
  jsonSchema?: Record<string, any>;
  tools?: any[];
  enableSearchGrounding?: boolean;
  temperature?: number;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface GeminiResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  groundingMetadata?: any;
  toolCalls?: any[];
}

export class GeminiProvider {
  private static getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error(
        'A chave GEMINI_API_KEY nao foi configurada nos Segredos do Servidor.'
      );
    }

    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  private static buildContents(
    userMessage: string,
    attachments: GeminiGenerateOptions['attachments'] = []
  ): any[] {
    const contents: any[] = [];

    for (const attachment of attachments) {
      if (!attachment.data || !attachment.mimeType) {
        continue;
      }

      contents.push({
        inlineData: {
          data: attachment.data,
          mimeType: attachment.mimeType,
        },
      });
    }

    contents.push({
      text: userMessage,
    });

    return contents;
  }

  static async generate(
    options: GeminiGenerateOptions
  ): Promise<GeminiResponse> {
    const ai = this.getClient();

    const {
      model,
      systemInstruction,
      userMessage,
      attachments = [],
      responseFormat = 'text',
      enableSearchGrounding = false,
      temperature = 0.7,
      abortSignal,
      timeoutMs = 30000,
      maxRetries = 2,
    } = options;

    const contents = this.buildContents(
      userMessage,
      attachments
    );

    const config: any = {
      temperature,
      abortSignal,
      httpOptions: {
        timeout: timeoutMs,
        retryOptions: {
          attempts: Math.max(1, maxRetries + 1),
        },
      },
    };

    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    if (responseFormat === 'json') {
      config.responseMimeType = 'application/json';
    }

    if (enableSearchGrounding) {
      config.tools = [
        {
          googleSearch: {},
        },
      ];
    }

    let response: Awaited<
      ReturnType<typeof ai.models.generateContent>
    >;
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config,
      });
    } catch (error) {
      throw normalizeGeminiProviderError(error);
    }

    const text = response.text || '';
    const usage = response.usageMetadata || {};

    return {
      text,
      inputTokens:
        usage.promptTokenCount ||
        Math.ceil(
          (
            userMessage.length +
            (systemInstruction?.length || 0)
          ) / 4
        ),
      outputTokens:
        usage.candidatesTokenCount ||
        Math.ceil(text.length / 4),
      groundingMetadata:
        response.candidates?.[0]?.groundingMetadata,
    };
  }

  static async *generateStream(
    options: GeminiGenerateOptions
  ) {
    const ai = this.getClient();

    const {
      model,
      systemInstruction,
      userMessage,
      attachments = [],
      responseFormat = 'text',
      enableSearchGrounding = false,
      temperature = 0.7,
      abortSignal,
      timeoutMs = 30000,
      maxRetries = 2,
    } = options;

    const config: any = {
      temperature,
      abortSignal,
      httpOptions: {
        timeout: timeoutMs,
        retryOptions: {
          attempts: Math.max(1, maxRetries + 1),
        },
      },
    };

    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    if (responseFormat === 'json') {
      config.responseMimeType = 'application/json';
    }

    if (enableSearchGrounding) {
      config.tools = [
        {
          googleSearch: {},
        },
      ];
    }

    const contents = this.buildContents(
      userMessage,
      attachments
    );

    try {
      const responseStream =
        await ai.models.generateContentStream({
          model,
          contents,
          config,
        });

      for await (const chunk of responseStream) {
        yield {
          text: chunk.text || '',
          groundingMetadata:
            chunk.candidates?.[0]?.groundingMetadata,
        };
      }
    } catch (error) {
      throw normalizeGeminiProviderError(error);
    }
  }
}
