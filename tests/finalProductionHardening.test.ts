import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Hardening final de produção', () => {
  it('não executa processos locais em rota HTTP de leitura', () => {
    const engine = readFileSync(
      new URL('../server/selfEvolution/evaluationEngine.ts', import.meta.url),
      'utf8'
    );
    const routes = readFileSync(
      new URL('../server/routes/selfEvolutionRoutes.ts', import.meta.url),
      'utf8'
    );

    expect(engine).not.toContain("from 'child_process'");
    expect(engine).not.toContain('execSync(');
    expect(routes).toContain('EvaluationEngine.listResults()');
    expect(routes).toContain("executionEndpoint: '/api/admin/ai/evaluations/run'");
  });

  it('mantém CI no Node 22 e auditoria sem mascarar falhas', () => {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    expect(ci).toContain("node-version: '22'");
    expect(ci).toContain('npm audit --omit=dev --audit-level=high');
    expect(ci).not.toContain('|| true');
  });

  it('implementa rollback por RevertPullRequest e merge condicionado', () => {
    const rollback = readFileSync(
      new URL('../server/selfEvolution/rollbackService.ts', import.meta.url),
      'utf8'
    );
    expect(rollback).toContain('revertPullRequest(input: $input)');
    expect(rollback).toContain('AUTONOMOUS_PRODUCTION_DEPLOY_ENABLED');
    expect(rollback).toContain('revert_pr_created');
  });
});
