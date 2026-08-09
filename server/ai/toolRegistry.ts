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
        riskLevel: 'low',
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
        riskLevel: 'medium',
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
        riskLevel: 'low',
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
        riskLevel: 'low',
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
