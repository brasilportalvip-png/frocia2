import { describe, expect, it } from 'vitest';
import { buildEngineeringContext } from '../worker/engineering-context.mjs';

describe('worker engineering context', () => {
  it('expande o arquivo provável para imports, dependentes e testes', () => {
    const report = buildEngineeringContext([
      { path: 'src/domain.ts', content: 'export type User = { id: string };' },
      { path: 'server/service.ts', content: "import type { User } from '../src/domain'; export const loadUser = (): User => ({ id: '1' });" },
      { path: 'server/route.ts', content: "import { loadUser } from './service'; export const result = loadUser();" },
      { path: 'tests/service.test.ts', content: "import { loadUser } from '../server/service'; test('user', () => loadUser());" },
    ], { title: 'corrigir loadUser', summary: 'user', hypothesis: 'contrato', expectedBehavior: 'User', testPlan: 'teste' }, ['server/service.ts']);
    expect(report.selectedFiles).toContain('src/domain.ts');
    expect(report.selectedFiles).toContain('server/route.ts');
    expect(report.relatedTests).toContain('tests/service.test.ts');
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('não autoriza arquivos operacionais sensíveis automaticamente', () => {
    const report = buildEngineeringContext([
      { path: 'worker/server.mjs', content: 'export const target = true;' },
      { path: '.github/workflows/ci.yml', content: 'name: target' },
      { path: 'package-lock.json', content: '{"target":true}' },
    ], { title: 'target' }, []);
    expect(report.editablePaths).toEqual([]);
  });
});
