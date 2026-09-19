import { describe, expect, it } from 'vitest';
import { EngineeringCodePlannerService } from '../server/ai/engineeringCodePlannerService.js';

describe('EngineeringCodePlannerService', () => {
  it('descobre implementação, dependentes, símbolos e testes além do palpite inicial', () => {
    const plan = EngineeringCodePlannerService.plan([
      { path: 'src/domain/user.ts', content: 'export interface User { id: string }' },
      { path: 'server/services/userService.ts', content: "import type { User } from '../../src/domain/user'; export function loadUser(): User { return { id: '1' }; }" },
      { path: 'server/routes/users.ts', content: "import { loadUser } from '../services/userService'; export const user = loadUser();" },
      { path: 'tests/userService.test.ts', content: "import { loadUser } from '../server/services/userService'; test('loads user', () => expect(loadUser()).toBeTruthy());" },
    ], {
      title: 'Corrigir carregamento de usuário', summary: 'loadUser retorna usuário incorreto',
      hypothesis: 'contrato do domínio', expectedBehavior: 'carregar User válido',
      probableFiles: ['server/services/userService.ts'],
    });

    expect(plan.schemaVersion).toBe('engineering-code-plan-v1');
    expect(plan.selectedFiles).toContain('server/services/userService.ts');
    expect([...plan.selectedFiles, ...plan.supportingFiles]).toContain('server/routes/users.ts');
    expect([...plan.selectedFiles, ...plan.supportingFiles]).toContain('tests/userService.test.ts');
    expect(plan.relevantSymbols).toContain('loadUser');
    expect(plan.requiredEvidence).toContain('rollback');
    expect(plan.planId).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produz plano determinístico e limita o contexto selecionado', () => {
    const files = Array.from({ length: 80 }, (_, index) => ({ path: `src/file${index}.ts`, content: `export const target${index} = 'memory target';` }));
    const request = { title: 'memory target', summary: 'memory target', hypothesis: 'memory', expectedBehavior: 'target', probableFiles: [] };
    const first = EngineeringCodePlannerService.plan(files, request);
    const second = EngineeringCodePlannerService.plan(files, request);
    expect(first).toEqual(second);
    expect(first.selectedFiles.length).toBeLessThanOrEqual(40);
  });
});
