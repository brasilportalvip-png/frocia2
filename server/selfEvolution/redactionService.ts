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

  static redactValue(
    input: unknown,
    redactFields: string[] = []
  ): unknown {
    const protectedFields = new Set(
      [
        'password',
        'secret',
        'token',
        'authorization',
        'apikey',
        'api_key',
        'credential',
        ...redactFields,
      ].map((field) => field.toLowerCase())
    );

    const visit = (
      value: unknown,
      seen: WeakSet<object>
    ): unknown => {
      if (typeof value === 'string') {
        return this.redactSensitiveData(value);
      }

      if (
        value === null ||
        typeof value !== 'object'
      ) {
        return value === undefined ? null : value;
      }

      if (seen.has(value)) {
        return '[REDACTED_CIRCULAR]';
      }

      seen.add(value);

      if (Array.isArray(value)) {
        return value.map((item) =>
          visit(item, seen)
        );
      }

      const output: Record<string, unknown> = {};

      for (const [key, item] of Object.entries(value)) {
        output[key] = protectedFields.has(
          key.toLowerCase()
        )
          ? '[REDACTED_SECRET]'
          : visit(item, seen);
      }

      return output;
    };

    return visit(input, new WeakSet<object>());
  }
}
