import { GithubAppService } from '../services/githubAppService.js';
import {
  CAPABILITY_CATEGORIES,
  CapabilityCategory,
  CapabilityEvaluationRun,
  ContinuousCapabilityEvaluationService,
} from './continuousCapabilityEvaluationService.js';
import type { ImprovementCandidate } from '../selfEvolution/selfEvolutionTypes.js';

// Cada check corresponde a uma suíte executada no GitHub Actions, não a uma nota
// subjetiva de qualidade do modelo. Falta de check nunca equivale a aprovação.
export const CAPABILITY_CI_VERSION = 'github-ci-regression-v1';
const CHECK_PREFIX = 'Capability: ';
const SHA_RE = /^[a-f0-9]{40}$/i;

export interface GitHubCapabilityCheck {
  id: number;
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  app?: { slug?: string };
}

export type AutomaticEvaluationOutcome = {
  status: 'passed' | 'failed' | 'pending';
  message: string;
};

export function createCapabilityRunFromGitHubChecks(
  sha: string,
  checks: readonly GitHubCapabilityCheck[],
  version: string = CAPABILITY_CI_VERSION
): CapabilityEvaluationRun | null {
  if (!SHA_RE.test(sha)) return null;
  const scores: CapabilityEvaluationRun['scores'] = [];
  for (const category of CAPABILITY_CATEGORIES) {
    const expectedName = CHECK_PREFIX + category;
    const matching = checks.filter((check) =>
      check?.name === expectedName &&
      check.head_sha === sha &&
      check.app?.slug === 'github-actions' &&
      Number.isSafeInteger(check.id) && check.id > 0
    );
    // Não permitir ambiguidade entre execuções concorrentes ou duplicatas.
    if (matching.length !== 1) return null;
    const check = matching[0];
    if (check.status !== 'completed' || !['success', 'failure'].includes(check.conclusion || '')) return null;
    const passed = check.conclusion === 'success' ? 1 : 0;
    scores.push({
      category: category as CapabilityCategory,
      passed,
      total: 1,
      score: passed,
      evidenceRefs: [
        `github-actions-check-run:${sha}:${check.id}:${category}`,
      ],
    });
  }
  return { version, commitSha: sha, createdAt: new Date().toISOString(), scores };
}

async function githubToken(owner: string, repo: string): Promise<string> {
  const token = (process.env.GITHUB_TOKEN || process.env.GITHUB_APP_TOKEN || '').trim();
  if (token) return token;
  if (!GithubAppService.isConfigured()) throw new Error('GitHub App não configurado');
  const installationId = await GithubAppService.findRepositoryInstallation(owner, repo);
  return (await GithubAppService.installationToken(installationId)).token;
}

async function githubJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'FrocIA-CapabilityEvaluation',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export class GithubCapabilityEvaluationService {
  static async evaluateCandidate(candidate: ImprovementCandidate): Promise<AutomaticEvaluationOutcome> {
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      return { status: 'pending', message: 'Repositório GitHub inválido' };
    }
    const sha = candidate.headCommitSha;
    if (!sha || !SHA_RE.test(sha)) return { status: 'pending', message: 'Commit não validado' };

    // Não aceitar URLs de terceiros nem commits que já tenham mudado após a revisão.
    const expectedPrefix = `https://github.com/${owner}/${repo}/pull/`;
    const pullUrl = candidate.pullRequestUrl || '';
    if (!pullUrl.startsWith(expectedPrefix) || !/^\d+$/.test(pullUrl.slice(expectedPrefix.length))) {
      return { status: 'pending', message: 'Pull Request do repositório não confirmado' };
    }
    try {
      const token = await githubToken(owner, repo);
      const api = `https://api.github.com/repos/${owner}/${repo}`;
      const number = pullUrl.slice(expectedPrefix.length);
      const pr = await githubJson<{
        state?: string;
        head?: { sha?: string };
        base?: { sha?: string };
      }>(`${api}/pulls/${number}`, token);
      const baselineSha = pr.base?.sha;
      if (pr.state !== 'open' || pr.head?.sha !== sha || !baselineSha || !SHA_RE.test(baselineSha) || baselineSha === sha) {
        return { status: 'pending', message: 'Pull Request mudou ou a base não foi comprovada' };
      }

      const readChecks = async (commitSha: string): Promise<GitHubCapabilityCheck[]> => {
        const result = await githubJson<{ total_count?: number; check_runs?: GitHubCapabilityCheck[] }>(
          `${api}/commits/${commitSha}/check-runs?per_page=100&filter=latest`, token
        );
        if (!Array.isArray(result.check_runs) || (result.total_count || 0) > 100) return [];
        return result.check_runs;
      };
      const [baselineChecks, candidateChecks] = await Promise.all([
        readChecks(baselineSha), readChecks(sha),
      ]);
      const baselineRun = createCapabilityRunFromGitHubChecks(baselineSha, baselineChecks);
      const candidateRun = createCapabilityRunFromGitHubChecks(sha, candidateChecks);
      if (!baselineRun || !candidateRun) {
        return { status: 'pending', message: 'Aguardando as nove suítes reais do GitHub Actions nos dois commits' };
      }
      const comparison = await ContinuousCapabilityEvaluationService.compareVerifiedGithubAndPersist(
        baselineRun, candidateRun
      );
      return {
        status: comparison.passed ? 'passed' : 'failed',
        message: comparison.passed
          ? 'Comparação automática de regressão aprovada com checks do GitHub Actions'
          : 'Comparação automática encontrou falha ou regressão; release bloqueado',
      };
    } catch (error) {
      return {
        status: 'pending',
        message: `Não foi possível obter evidências verificáveis do GitHub: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
