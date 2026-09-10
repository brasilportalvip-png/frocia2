import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('janela de geração da fábrica de sites', () => {
  it('permite geração longa sem retries internos que ultrapassem a função', () => {
    const source = readFileSync(
      new URL('../server/routes/siteBuilderRoutes.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('const SITE_GENERATION_TIMEOUT_MS = 180_000');
    expect(source).toMatch(
      /timeoutMs:\s*SITE_GENERATION_TIMEOUT_MS,\s*maxRetries:\s*0/
    );
  });
});
