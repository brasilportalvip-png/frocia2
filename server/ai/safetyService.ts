import { z } from 'zod';

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
  static validateToolCall(toolName: string, args: Record<string, any>): { valid: boolean; data?: any; error?: string } {
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

    return { valid: true, data: args };
  }
}
