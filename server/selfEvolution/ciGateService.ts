import { GithubAppService } from '../services/githubAppService.js';
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
    const token =
      process.env.GITHUB_TOKEN ||
      process.env.GITHUB_APP_TOKEN;

    const owner =
      process.env.GITHUB_OWNER ||
      'brasilportalvip-png';

    const repo =
      process.env.GITHUB_REPO ||
      'frocia2';

    return Boolean(
      (
        token?.trim() ||
        GithubAppService.isConfigured()
      ) &&
      owner &&
      repo
    );
  }

  private static async resolveAccessToken(
    owner: string,
    repo: string
  ): Promise<string> {
    const staticToken =
      process.env.GITHUB_TOKEN ||
      process.env.GITHUB_APP_TOKEN;

    if (staticToken?.trim()) {
      return staticToken.trim();
    }

    const installationId =
      await GithubAppService.findRepositoryInstallation(
        owner,
        repo
      );

    const access =
      await GithubAppService.installationToken(
        installationId
      );

    return access.token;
  }

  static async runCIGate(refOrSha?: string): Promise<CIGateResult> {
    const owner =
      process.env.GITHUB_OWNER ||
      'brasilportalvip-png';

    const repo =
      process.env.GITHUB_REPO ||
      'frocia2';

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

    if (!/^[a-f0-9]{7,40}$/i.test(refOrSha)) {
      return {
        status: 'failed', passed: false, typecheckPassed: false,
        unitTestsPassed: false, securityAuditPassed: false,
        details: 'O CI Gate exige o SHA imutável do commit, não uma branch ou referência mutável.',
      };
    }

    const result = (status: CIGateResult['status'], details: string): CIGateResult => ({
      status, passed: status === 'success', typecheckPassed: status === 'success', unitTestsPassed: status === 'success', securityAuditPassed: status === 'success', details,
    });
    try {
      const token = await this.resolveAccessToken(owner, repo);
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'FrocIA-SelfEvolution' };
      const root = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      const response = await fetch(`${root}/actions/runs?head_sha=${refOrSha}&per_page=100`, { headers, signal: AbortSignal.timeout(20000) });
      if (!response.ok) return result('failed', `Falha ao consultar workflows oficiais: HTTP ${response.status}.`);
      const data = await response.json();
      const runs = (Array.isArray(data.workflow_runs) ? data.workflow_runs : []).filter(run => run.head_sha === refOrSha &&
        String(run.path || '').split('@')[0] === '.github/workflows/ci.yml' && ['workflow_dispatch', 'pull_request', 'push'].includes(run.event));
      // The explicit official dispatch is the supported path for bot-generated PRs.
      // A separate PR approval request must not hide its result or replace it.
      const eligible = runs.filter(run => run.conclusion !== 'action_required');
      const latest = (eligible.length ? eligible : runs).sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (!latest) return result('pending', 'Nenhuma execução do workflow oficial ci.yml comprovada para este SHA.');
      if (latest.conclusion === 'action_required') return result('pending', 'O workflow oficial aguarda aprovação no GitHub; nenhum dispatch alternativo foi comprovado.');
      if (latest.status !== 'completed') return result('pending', 'O workflow oficial ainda está em andamento.');
      if (latest.conclusion !== 'success') return result('failed', `O workflow oficial terminou com ${String(latest.conclusion || 'resultado ausente')}.`);
      if (!Number.isSafeInteger(latest.id) || latest.id <= 0) return result('failed', 'Identificador de execução oficial inválido.');
      const jobsResponse = await fetch(`${root}/actions/runs/${latest.id}/jobs?filter=latest&per_page=100`, { headers, signal: AbortSignal.timeout(20000) });
      if (!jobsResponse.ok) return result('failed', `Não foi possível conferir os jobs oficiais: HTTP ${jobsResponse.status}.`);
      const jobsData = await jobsResponse.json();
      const jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
      if (!jobs.length || jobsData.total_count > jobs.length) return result('pending', 'Lista de jobs oficiais ausente ou incompleta.');
      if (jobs.some(job => job.status !== 'completed')) return result('pending', 'Jobs do workflow oficial ainda em andamento.');
      if (jobs.some(job => job.conclusion !== 'success')) return result('failed', 'Existe job oficial reprovado, cancelado ou sem aprovação; um sucesso não o substitui.');
      if (!jobs.some(job => job.name === 'Build & Verify')) return result('failed', 'O job obrigatório Build & Verify não foi comprovado no workflow oficial.');
      return result('success', `CI oficial comprovado para o SHA: execução ${latest.id}; todos os jobs aprovados.`);
    } catch {
      return result('failed', 'Falha de comunicação ao conferir o workflow oficial de CI.');
    }
  }
}
