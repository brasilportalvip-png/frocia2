export class PromptInjectionDefense {
  private static readonly INJECTION_TERMS: RegExp[] = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /you\s+are\s+now\s+in\s+developer\s+mode/i,
    /override\s+system\s+policy/i,
    /grant\s+admin\s+role/i,
    /disable\s+security\s+checks/i,
    /bypass\s+authentication/i,
    /export\s+environment\s+variables/i,
    /print\s+gemini_api_key/i,
  ];

  static containsInjectionAttempt(input: string): boolean {
    if (!input || typeof input !== 'string') return false;
    return this.INJECTION_TERMS.some((regex) => regex.test(input));
  }

  static sanitizeUntrustedText(input: string): string {
    if (!input || typeof input !== 'string') return '';
    if (this.containsInjectionAttempt(input)) {
      return '[CONTEÚDO REMOVIDO POR TENTATIVA DE INJEÇÃO DE PROMPT]';
    }
    return input;
  }
}
