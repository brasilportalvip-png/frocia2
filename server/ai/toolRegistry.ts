import { ToolDeclaration } from './types/ai.js';

export class ToolRegistry {
  private static tools: Map<string, ToolDeclaration> = new Map([
    [
      'search_knowledge_base',
      {
        name: 'search_knowledge_base',
        description: 'Pesquisa trechos relevantes na base de conhecimento ou documentos indexados do usuario.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Termos de busca ou pergunta' },
            knowledgeBaseId: { type: 'STRING', description: 'ID da base de conhecimento (opcional)' },
          },
          required: ['query'],
        },
        outputSchema: {
          type: 'ARRAY',
          items: { type: 'OBJECT' },
        },
        authScopes: ['user'],
        riskLevel: 'low',
        mutatesState: false,
        requiresConfirmation: false,
        idempotencyRequired: false,
        timeoutMs: 10_000,
        maxRetries: 1,
        retryBackoffMs: 250,
        costLimitCredits: 5,
        rateLimit: {
          windowMs: 60_000,
          maxRequests: 30,
        },
        redactFields: [],
        verificationStrategy: 'deterministic',
      },
    ],
    [
      'read_project_files',
      {
        name: 'read_project_files',
        description: 'Lê arquivos autorizados do projeto atual.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'Caminho relativo do arquivo' },
          },
          required: ['path'],
        },
        outputSchema: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING' },
            content: { type: 'STRING' },
          },
        },
        authScopes: ['user', 'project'],
        riskLevel: 'medium',
        mutatesState: false,
        requiresConfirmation: false,
        idempotencyRequired: false,
        timeoutMs: 5_000,
        maxRetries: 0,
        retryBackoffMs: 0,
        costLimitCredits: 2,
        rateLimit: {
          windowMs: 60_000,
          maxRequests: 60,
        },
        redactFields: ['content'],
        verificationStrategy: 'deterministic',
      },
    ],
    [
      'execute_calculator',
      {
        name: 'execute_calculator',
        description: 'Executa calculo matematico ou financeiro interno.',
        parameters: {
          type: 'OBJECT',
          properties: {
            expression: { type: 'STRING', description: 'Expressao matematica simples' },
          },
          required: ['expression'],
        },
        outputSchema: {
          type: 'OBJECT',
          properties: {
            value: { type: 'NUMBER' },
          },
        },
        authScopes: ['user'],
        riskLevel: 'low',
        mutatesState: false,
        requiresConfirmation: false,
        idempotencyRequired: false,
        timeoutMs: 2_000,
        maxRetries: 0,
        retryBackoffMs: 0,
        costLimitCredits: 1,
        rateLimit: {
          windowMs: 60_000,
          maxRequests: 120,
        },
        redactFields: [],
        verificationStrategy: 'deterministic',
      },
    ],
    [
      'web_search',
      {
        name: 'web_search',
        description: 'Realiza pesquisa externa na web via Google Search grounding.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Consulta de busca na web' },
          },
          required: ['query'],
        },
        outputSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              uri: { type: 'STRING' },
              snippet: { type: 'STRING' },
            },
          },
        },
        authScopes: ['user'],
        riskLevel: 'low',
        mutatesState: false,
        requiresConfirmation: false,
        idempotencyRequired: false,
        timeoutMs: 20_000,
        maxRetries: 2,
        retryBackoffMs: 500,
        costLimitCredits: 5,
        rateLimit: {
          windowMs: 60_000,
          maxRequests: 20,
        },
        redactFields: [],
        verificationStrategy: 'provider_receipt',
      },
    ],
  ]);

  static getTool(name: string): ToolDeclaration | undefined {
    return this.tools.get(name);
  }

  static listTools(names?: string[]): ToolDeclaration[] {
    if (!names || names.length === 0) {
      return Array.from(this.tools.values());
    }
    return names.map((n) => this.tools.get(n)).filter((t): t is ToolDeclaration => t !== undefined);
  }
}
