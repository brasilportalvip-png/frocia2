export interface CIGateResult {
  status: 'configured' | 'not_configured' | 'pending' | 'failed' | 'success';
  passed: boolean;
  typecheckPassed: boolean;
  unitTestsPassed: boolean;
  securityAuditPassed: boolean;
  details: string;
}

export class CIGateService {
  private static isConfigured(): boolean {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    return Boolean(token && token.trim().length > 0 && owner && repo);
  }

  static async runCIGate(refOrSha?: string): Promise<CIGateResult> {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN;
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';

    if (!this.isConfigured()) {
      return {
        status: 'not_configured',
        passed: false,
        typecheckPassed: false,
        unitTestsPassed: false,
        securityAuditPassed: false,
        details: 'Portão de CI do GitHub Actions não configurado (GITHUB_TOKEN ausente).',
      };
    }

    if (!refOrSha) {
      return {
        status: 'pending',
        passed: false,
        typecheckPassed: false,
        unitTestsPassed: false,
        securityAuditPassed: false,
        details: 'Aguardando SHA do commit/PR para consulta de status do GitHub Actions.',
      };
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${refOrSha}/check-runs`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'FrocIA-SelfEvolution',
        },
      });

      if (!response.ok) {
        return {
          status: 'failed',
          passed: false,
          typecheckPassed: false,
          unitTestsPassed: false,
          securityAuditPassed: false,
          details: `Falha ao consultar check-runs no GitHub: HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const checkRuns = data.check_runs || [];

      if (checkRuns.length === 0) {
        return {
          status: 'pending',
          passed: false,
          typecheckPassed: false,
          unitTestsPassed: false,
          securityAuditPassed: false,
          details: 'Nenhuma verificação do GitHub Actions foi iniciada para este commit ainda.',
        };
      }

      let typecheckPassed = false;
      let unitTestsPassed = false;
      let securityAuditPassed = false;
      let allCompleted = true;

      for (const run of checkRuns) {
        if (run.status !== 'completed') {
          allCompleted = false;
        }
        const name = (run.name || '').toLowerCase();
        const conclusion = run.conclusion;

        if (name.includes('lint') || name.includes('typecheck')) {
          if (conclusion === 'success') typecheckPassed = true;
        }
        if (name.includes('test') || name.includes('vitest')) {
          if (conclusion === 'success') unitTestsPassed = true;
        }
        if (name.includes('audit') || name.includes('security')) {
          if (conclusion === 'success') securityAuditPassed = true;
        }
      }

      if (!allCompleted) {
        return {
          status: 'pending',
          passed: false,
          typecheckPassed,
          unitTestsPassed,
          securityAuditPassed,
          details: 'Verificações do CI do GitHub Actions ainda em andamento.',
        };
      }

      const passed = typecheckPassed && unitTestsPassed && securityAuditPassed;

      return {
        status: passed ? 'success' : 'failed',
        passed,
        typecheckPassed,
        unitTestsPassed,
        securityAuditPassed,
        details: passed
          ? 'Todas as verificações obrigatórias de CI (lint, testes, segurança) foram concluídas com sucesso.'
          : 'Uma ou mais verificações de CI (lint, testes, segurança) falharam ou não foram aprovadas.',
      };
    } catch (err: any) {
      return {
        status: 'failed',
        passed: false,
        typecheckPassed: false,
        unitTestsPassed: false,
        securityAuditPassed: false,
        details: `Erro na consulta do CI Gate: ${err?.message || err}`,
      };
    }
  }
}

