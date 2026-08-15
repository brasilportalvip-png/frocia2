import { GoogleGenAI } from '@google/genai';

export interface GeminiGenerateOptions {
  model: string;
  systemInstruction?: string;
  userMessage: string;
  attachments?: Array<{ type: string; data?: string; mimeType?: string; url?: string }>;
  responseFormat?: 'text' | 'json';
  jsonSchema?: Record<string, any>;
  tools?: any[];
  enableSearchGrounding?: boolean;
  temperature?: number;
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
      throw new Error('A chave GEMINI_API_KEY nao foi configurada nos Segredos do Servidor.');
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
          mimeType: attachment.mimeType
        }
      });
    }

    contents.push({ text: userMessage });
    return contents;
  }

  static async generate(options: GeminiGenerateOptions): Promise<GeminiResponse> {
    const ai = this.getClient();
    const {
      model,
      systemInstruction,
      userMessage,
      attachments = [],
      responseFormat = 'text',
      enableSearchGrounding = false,
      temperature = 0.7,
    } = options;

    const contents = this.buildContents(
      userMessage,
      attachments
    );

    const config: any = {
      temperature,
    };

    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    if (responseFormat === 'json') {
      config.responseMimeType = 'application/json';
    }

    if (enableSearchGrounding) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
      model,
      contents,
      config,
    });

    const text = response.text || '';
    const usage = response.usageMetadata || {};

    return {
      text,
      inputTokens: usage.promptTokenCount || Math.ceil((userMessage.length + (systemInstruction?.length || 0)) / 4),
      outputTokens: usage.candidatesTokenCount || Math.ceil(text.length / 4),
      groundingMetadata: response.candidates?.[0]?.groundingMetadata,
    };
  }

  static async *generateStream(options: GeminiGenerateOptions) {
    const ai = this.getClient();
    const {
      model,
      systemInstruction,
      userMessage,
      attachments = [],
      responseFormat = 'text',
      enableSearchGrounding = false,
      temperature = 0.7,
    } = options;

    const config: any = { temperature };
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (responseFormat === 'json') config.responseMimeType = 'application/json';
    if (enableSearchGrounding) config.tools = [{ googleSearch: {} }];

    const contents = this.buildContents(
      userMessage,
      attachments
    );

    const responseStream = await ai.models.generateContentStream({
      model,
      contents,
      config,
    });

    for await (const chunk of responseStream) {
      yield {
        text: chunk.text || '',
        groundingMetadata: chunk.candidates?.[0]?.groundingMetadata,
      };
    }
  }
}