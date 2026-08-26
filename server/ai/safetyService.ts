import { z } from 'zod';
import { ToolRegistry } from './toolRegistry.js';
import { ToolDeclaration } from './types/ai.js';

function matchesJsonSchema(
  value: unknown,
  schema: Record<string, unknown>
): boolean {
  const type = schema.type;

  if (type === 'STRING') {
    return typeof value === 'string';
  }

  if (type === 'NUMBER') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value)
    );
  }

  if (type === 'BOOLEAN') {
    return typeof value === 'boolean';
  }

  if (type === 'ARRAY') {
    if (!Array.isArray(value)) return false;

    const itemSchema = schema.items;

    return !(
      itemSchema &&
      typeof itemSchema === 'object'
    ) || value.every((item) =>
      matchesJsonSchema(
        item,
        itemSchema as Record<string, unknown>
      )
    );
  }

  if (type === 'OBJECT') {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      return false;
    }

    const objectValue = value as Record<
      string,
      unknown
    >;
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
          (item): item is string =>
            typeof item === 'string'
        )
      : [];

    if (
      required.some(
        (field) => !(field in objectValue)
      )
    ) {
      return false;
    }

    const properties = schema.properties;

    if (
      properties &&
      typeof properties === 'object'
    ) {
      for (const [key, propertySchema] of Object.entries(
        properties
      )) {
        if (!(key in objectValue)) continue;

        if (
          !propertySchema ||
          typeof propertySchema !== 'object' ||
          !matchesJsonSchema(
            objectValue[key],
            propertySchema as Record<string, unknown>
          )
        ) {
          return false;
        }
      }
    }

    return true;
  }

  return false;
}

export class SafetyService {
  /**
   * Checks prompt for prompt injection patterns or system instruction override attempts
   */
  static inspectPrompt(prompt: string): { safe: boolean; reason?: string } {
    if (!prompt || typeof prompt !== 'string') {
      return { safe: false, reason: 'Prompt invalido ou vazio.' };
    }

    const lower = prompt.toLowerCase();
    const injectionPatterns = [
      'ignore previous instructions',
      'ignore all rules',
      'system prompt:',
      'you are now in developer mode',
      'bypass security',
      'reveal system prompt',
      'print your instructions',
    ];

    for (const pattern of injectionPatterns) {
      if (lower.includes(pattern)) {
        return {
          safe: false,
          reason: `Tentativa de violacao de seguranca detectada (padrao: ${pattern}).`,
        };
      }
    }

    return { safe: true };
  }

  /**
   * Sanitizes prompt text to isolate user inputs cleanly
   */
  static sanitizeInput(text: string): string {
    return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  }

  /**
   * Validates tool parameters strictly using Zod
   */
  static validateToolCall(
    toolName: string,
    args: Record<string, unknown>,
    declaration?: ToolDeclaration
  ): {
    valid: boolean;
    data?: Record<string, unknown>;
    error?: string;
  } {
    const registeredTool =
      declaration || ToolRegistry.getTool(toolName);

    if (
      !registeredTool ||
      registeredTool.name !== toolName
    ) {
      return {
        valid: false,
        error: 'Ferramenta não registrada ou não permitida.',
      };
    }

    if (toolName === 'execute_calculator') {
      const schema = z.object({ expression: z.string().max(200) });
      const parse = schema.safeParse(args);
      if (!parse.success) return { valid: false, error: 'Parametros de calculo invalidos.' };
      return { valid: true, data: parse.data };
    }

    if (toolName === 'read_project_files') {
      const schema = z.object({
        path: z.string().refine((p) => !p.includes('..') && !p.startsWith('/'), {
          message: 'Path traversal nao permitido.',
        }),
      });
      const parse = schema.safeParse(args);
      if (!parse.success) return { valid: false, error: 'Caminho de arquivo invalido ou nao permitido.' };
      return { valid: true, data: parse.data };
    }

    if (toolName === 'web_search') {
      const schema = z.object({
        query: z.string().trim().min(2).max(500),
      });
      const parse = schema.safeParse(args);
      if (!parse.success) {
        return {
          valid: false,
          error: 'Consulta de pesquisa inválida.',
        };
      }
      return { valid: true, data: parse.data };
    }

    if (toolName === 'search_knowledge_base') {
      const schema = z.object({
        query: z.string().trim().min(2).max(500),
        knowledgeBaseId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,200}$/)
          .optional(),
      });
      const parse = schema.safeParse(args);
      if (!parse.success) {
        return {
          valid: false,
          error: 'Consulta da base de conhecimento inválida.',
        };
      }
      return { valid: true, data: parse.data };
    }

    return {
      valid: false,
      error: 'Ferramenta sem validador explícito.',
    };
  }

  static validateToolOutput(
    toolName: string,
    output: unknown,
    declaration?: ToolDeclaration
  ): { valid: boolean; error?: string } {
    const registeredTool =
      declaration || ToolRegistry.getTool(toolName);

    if (
      !registeredTool ||
      registeredTool.name !== toolName
    ) {
      return {
        valid: false,
        error: 'Ferramenta não registrada ou não permitida.',
      };
    }

    if (
      !matchesJsonSchema(
        output,
        registeredTool.outputSchema
      )
    ) {
      return {
        valid: false,
        error:
          'Resultado da ferramenta não corresponde ao esquema declarado.',
      };
    }

    return { valid: true };
  }
}
