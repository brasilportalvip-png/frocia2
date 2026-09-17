import { describe, expect, it } from 'vitest';
import { analyzeTypeScriptLanguage } from '../worker/typescript-language-engine.mjs';

describe('TypeScript language engine', () => {
  it('usa language service real para definições, referências e diagnósticos', () => {
    const report = analyzeTypeScriptLanguage([
      { path: 'domain.ts', content: 'export interface User { id: string }' },
      { path: 'service.ts', content: "import type { User } from './domain'; export const loadUser = (): User => ({ id: '1' });" },
      { path: 'route.ts', content: "import { loadUser } from './service'; loadUser();" },
    ], ['loadUser', 'User']);
    expect(report.schemaVersion).toBe('typescript-language-engine-v1');
    expect(report.symbols.some((symbol) => symbol.name === 'loadUser' && symbol.definitions.length > 0)).toBe(true);
    expect(report.symbols.some((symbol) => symbol.name === 'loadUser' && symbol.references.length > 0)).toBe(true);
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
