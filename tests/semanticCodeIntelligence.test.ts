import { describe, expect, it } from 'vitest';
import { SemanticCodeIntelligenceService } from '../server/ai/semanticCodeIntelligenceService.js';

describe('SemanticCodeIntelligenceService', () => {
  it('indexa símbolos, definições, referências, impacto e código inseguro', () => {
    const report = SemanticCodeIntelligenceService.analyze([
      { path: 'src/domain/user.ts', content: 'export interface User { id: string }\nexport function loadUser(id:string){ return { id }; }' },
      { path: 'src/api.ts', content: "import { loadUser } from './domain/user'; export const result = loadUser('1'); eval('bad');" },
      { path: 'src/unused.ts', content: 'export const neverUsed = 1;' },
    ]);
    expect(report.schemaVersion).toBe('semantic-code-v1');
    expect(SemanticCodeIntelligenceService.definition(report, 'loadUser')).toEqual([
      expect.objectContaining({ path: 'src/domain/user.ts' }),
    ]);
    expect(SemanticCodeIntelligenceService.references(report, 'loadUser')).toEqual([
      expect.objectContaining({ path: 'src/api.ts' }),
      expect.objectContaining({ path: 'src/api.ts' }),
    ]);
    expect(report.possibleDeadExports.map((item) => item.name)).toContain('neverUsed');
    expect(report.securityFindings).toEqual([
      expect.objectContaining({ rule: 'dynamic-code-execution', severity: 'high' }),
    ]);
    expect(report.architecture.importGraph).toContainEqual({ from: 'src/api.ts', to: 'src/domain/user.ts' });
  });

  it('ignora paths inseguros e não executa conteúdo analisado', () => {
    const report = SemanticCodeIntelligenceService.analyze([
      { path: '../escape.ts', content: "throw new Error('executed')" },
      { path: 'src/safe.ts', content: 'export const safe = true;' },
    ]);
    expect(report.symbols.map((item) => item.name)).toEqual(['safe']);
  });
});
