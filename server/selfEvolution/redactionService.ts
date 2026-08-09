export class RedactionService {
  private static readonly PATTERNS: RegExp[] = [
    /bearer\s+[a-zA-Z0-9\-\._~\+\/]+=*/gi,
    /AIzaSy[a-zA-Z0-9\-_]{30,35}/g, // Gemini / Google API Key
    /APP_USR-[0-9a-zA-Z\-_]+/g, // Mercado Pago Key
    /eyJ[a-zA-Z0-9\-_]+\.eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g, // JWT
    /("password"|"secret"|"token"|"apiKey")\s*:\s*"[^"]+"/gi,
  ];

  static redactSensitiveData(input: string): string {
    if (!input || typeof input !== 'string') return '';
    let sanitized = input;

    for (const pattern of this.PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED_SECRET]');
    }

    return sanitized;
  }
}
