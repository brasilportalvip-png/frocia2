export class PromptInjectionDefense {
   private static readonly REMOVED_CONTENT_MESSAGE =
    '[CONTEÚDO REMOVIDO POR TENTATIVA DE INJEÇÃO DE PROMPT]';

  private static readonly INJECTION_TERMS:
    RegExp[] = [
    // Tentativas diretas de substituir instruções.
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /ignore\s+(todas?\s+)?(as\s+)?instrucoes?\s+(anteriores?|acima)/i,
    /desconsidere\s+(todas?\s+)?(as\s+)?instrucoes?\s+(anteriores?|acima)/i,
    /esqueca\s+(todas?\s+)?(as\s+)?instrucoes?\s+(anteriores?|acima)/i,
    /override\s+(the\s+)?system\s+(prompt|policy|instructions?)/i,
    /substitua\s+(o\s+)?(prompt|comportamento|papel)\s+(do\s+)?sistema/i,

    // Mudança de identidade ou modo privilegiado.
    /you\s+are\s+now\s+(in\s+)?developer\s+mode/i,
    /voce\s+agora\s+(e|esta)\s+(em\s+)?modo\s+(desenvolvedor|administrador)/i,
    /act\s+as\s+(a\s+)?system\s+(administrator|developer)/i,
    /aja\s+como\s+(um\s+)?(administrador|desenvolvedor)\s+do\s+sistema/i,
    /reveal\s+(your\s+)?(system\s+prompt|hidden\s+instructions?)/i,
    /revele\s+(seu\s+)?(prompt\s+de\s+sistema|instrucoes?\s+ocultas?)/i,

    // Elevação de privilégio ou desativação de segurança.
    /grant\s+admin\s+role/i,
    /conceda\s+(a\s+)?funcao\s+de\s+administrador/i,
    /disable\s+(all\s+)?security\s+checks/i,
    /desative\s+(todas?\s+)?(as\s+)?verificacoes?\s+de\s+seguranca/i,
    /bypass\s+(authentication|authorization|security)/i,
    /ignore\s+(authentication|authorization|security)/i,
    /contorne\s+(a\s+)?(autenticacao|autorizacao|seguranca)/i,

    // Tentativas de extrair segredos.
    /export\s+(all\s+)?environment\s+variables/i,
    /liste\s+(todas?\s+)?(as\s+)?variaveis\s+de\s+ambiente/i,
    /print\s+[a-z0-9_]*(api[_-]?key|token|secret|password)/i,
    /exiba\s+[a-z0-9_]*(api[_-]?key|token|segredo|senha)/i,
    /gemini_api_key/i,
    /mercado_pago_(access_token|webhook_secret)/i,
    /firebase_private_key/i,
    /github_(token|app_token)/i,

    // Códigos apresentados como prova de identidade ou sessão.
    /codigo\s+de\s+(homologacao|validacao|verificacao|autenticacao)\b/i,
    /verification\s+code\s+(for|of)\s+(the\s+)?(session|system|knowledge\s+base)/i,
    /use\s+(the\s+)?code\s+.{0,80}\s+to\s+(validate|verify|authenticate)/i,
    /utilize?\s+(o\s+)?codigo\s+.{0,80}\s+para\s+(validar|verificar|autenticar)/i,
    /para\s+(validar|verificar|autenticar)\s+(a\s+)?(sessao|identidade|base)/i,

    // Instruções para repetir conteúdo obrigatório.
    /(sempre|obrigatoriamente)\s+(informe|diga|mostre|repita|inclua)/i,
    /(always|must)\s+(say|show|repeat|include|disclose)/i,
    /informe\s+(ao\s+)?usuario\s+(o\s+)?codigo/i,
    /repita\s+(esta\s+)?frase\s+(em\s+)?todas?\s+(as\s+)?respostas/i,

    // Afirmações comerciais impostas pelo documento.
    /garantia\s+de\s+suporte\s+(tecnico\s+)?(de|por)\s+\d+\s+mes(es)?/i,
    /support\s+warranty\s+(of|for)\s+\d+\s+months?/i,
    /afirme\s+que\s+(o\s+)?(produto|projeto|sistema).{0,80}(garantia|suporte)/i,

    // Delimitadores falsos usados para simular mensagens privilegiadas.
    /\b(system|developer)\s*:\s*.{0,120}(instruction|policy|prompt)/i,
    /\[(system|developer|administrador|sistema)\]/i,
    /<\s*(system|developer|instructions?)\s*>/i,
    /BEGIN\s+(SYSTEM|DEVELOPER)\s+(PROMPT|INSTRUCTIONS?)/i
  ];

  private static normalizeForInspection(
    input: string
  ): string {
    return input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(
        /[\u200B-\u200D\u2060\uFEFF]/g,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static cleanText(
    input: string
  ): string {
    return input
      .replace(
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
        ''
      )
      .replace(
        /[\u200B-\u200D\u2060\uFEFF]/g,
        ''
      )
      .trim();
  }

  static containsInjectionAttempt(
    input: string
  ): boolean {
    if (
      !input ||
      typeof input !== 'string'
    ) {
      return false;
    }

    const normalized =
      this.normalizeForInspection(input);

    if (!normalized) {
      return false;
    }

    return this.INJECTION_TERMS.some(
      (pattern) => pattern.test(normalized)
    );
  }

  static sanitizeUntrustedText(
    input: string
  ): string {
    if (
      !input ||
      typeof input !== 'string'
    ) {
      return '';
    }

    const cleaned = this.cleanText(input);

    if (!cleaned) {
      return '';
    }

    if (
      this.containsInjectionAttempt(
        cleaned
      )
    ) {
      return this.REMOVED_CONTENT_MESSAGE;
    }

    return cleaned;
  }
}