import type {
  PatchResult
} from './codeAgentService.js';
import {
  ImprovementCandidate
} from './selfEvolutionTypes.js';

import { EngineeringSandboxEvidenceService } from './engineeringSandboxEvidenceService.js';
import { GithubAppError, GithubAppService } from '../services/githubAppService.js';
import { formatGithubFailure, inspectGithubFailure, safeGithubText } from '../services/githubApiDiagnostics.js';

const GITHUB_API_URL =
  'https://api.github.com';
const GITHUB_REQUEST_TIMEOUT_MS = 30_000;
const EMPTY_GIT_BLOB_SHA = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';

export interface PullRequestResult {
  status:
    | 'configured'
    | 'not_configured'
    | 'failed'
    | 'success';
  success: boolean;
  branchName?: string;
  commitSha?: string;
  pullRequestUrl?: string;
  pullRequestId?: number;
  errorMessage?: string;
  requiresRegeneration?: boolean;
  noChanges?: boolean;
}

interface GitHubBlobResponse {
  sha?: string;
}

interface GitHubTreeResponse {
  sha?: string;
}

interface GitHubCommitResponse {
  sha?: string;
  tree?: {
    sha?: string;
  };
  parents?: Array<{ sha?: string }>;
}

interface GitHubReferenceResponse {
  object?: {
    sha?: string;
  };
}

interface GitHubPullRequestResponse {
  html_url?: string;
  number?: number;
  head?: {
    sha?: string;
  };
  state?: string;
  draft?: boolean;
  merged?: boolean;
  merge_commit_sha?: string;
}

export interface MergePullRequestResult {
  success: boolean;
  mergeCommitSha?: string;
  message: string;
}

interface MaintenanceCredential {
  token: string;
  source: 'token' | 'github_app';
  environment: 'GITHUB_TOKEN' | 'GITHUB_APP_TOKEN' | 'GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY';
  permissions?: Record<string, string>;
  installationId?: number;
  appId?: number;
  appSlug?: string;
}

export interface MaintenanceDispatchResult {
  success: boolean;
  message: string;
  diagnostic?: Record<string, unknown>;
}

export interface RepositoryChangesReceipt {
  status: 'checked' | 'unavailable'; repository: string; branch: string; fetchedAt: string;
  period: string; since?: string; until: string; complete: boolean; message?: string;
  commits: Array<{ sha: string; title: string; url: string; committedAt: string }>;
}

export class GithubAutomationService {
  /** Leitura autenticada do repositorio configurado; nao dispara agentes ou modifica arquivos. */
  static async readRecentRepositoryChanges(prompt: string, now = new Date()): Promise<RepositoryChangesReceipt> {
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    const branch = process.env.GITHUB_BASE_BRANCH || 'main';
    const normalized = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const day = new Date(now.getTime() - (/\bontem\b/.test(normalized) ? 86_400_000 : 0));
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(day);
    const offset = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', timeZoneName: 'longOffset' }).formatToParts(day)
      .find(part => part.type === 'timeZoneName')!.value.replace('GMT', '') || '+00:00';
    const dated = /\b(?:hoje|ontem)\b/.test(normalized);
    const since = dated ? new Date(`${dayKey}T00:00:00${offset}`).toISOString() : undefined;
    const until = /\bontem\b/.test(normalized)
      ? new Date(Date.parse(since!) + 86_400_000 - 1).toISOString() : now.toISOString();
    const base = { repository: `${owner}/${repo}`, branch, fetchedAt: now.toISOString(), period: dated ? `${dayKey} (America/Sao_Paulo)` : 'commits recentes',
      ...(since ? { since } : {}), until };
    const commits: RepositoryChangesReceipt['commits'] = [];
    try {
      const access = await this.resolveCredential(owner, repo);
      let complete = true;
      for (let page = 1; page <= (dated ? 2 : 1); page++) {
        const query = new URLSearchParams({ sha: branch, per_page: dated ? '100' : '20', page: String(page), until,
          ...(since ? { since } : {}) });
        const response = await this.githubFetch(`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${query}`, {
          headers: this.getHeaders(access.token),
        }, 10_000);
        if (!response.ok) throw new Error(formatGithubFailure('GitHub recusou consultar os commits', await inspectGithubFailure(response, [access.token])));
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error('GitHub retornou uma lista de commits invalida.');
        for (const row of rows) {
          const sha = typeof row?.sha === 'string' ? row.sha : '';
          const date = row?.commit?.committer?.date || row?.commit?.author?.date;
          const time = typeof date === 'string' ? Date.parse(date) : NaN;
          if (!/^[a-f0-9]{40}$/i.test(sha) || !Number.isFinite(time) || time > Date.parse(until) || (since && time < Date.parse(since))) continue;
          if (!commits.some(commit => commit.sha === sha)) commits.push({ sha, title: safeGithubText(String(row?.commit?.message || '').split('\n')[0], [access.token]).slice(0, 220),
            url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${sha}`, committedAt: new Date(time).toISOString() });
        }
        const more = /rel="next"/.test(response.headers.get('link') || '');
        complete = dated && !more;
        if (!more) break;
      }
      return { ...base, status: 'checked', complete, commits };
    } catch (error) {
      return { ...base, status: 'unavailable', complete: false, commits,
        message: safeGithubText(error instanceof Error ? error.message : 'Falha ao consultar os commits do repositorio.') };
    }
  }
  /** Consulta sem criar commit nem disparar um ciclo pago. Os segredos do
   * Actions nao sao automaticamente credenciais do backend que atende o chat. */
  static async inspectMaintenanceConnection(): Promise<Record<string, unknown>> {
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    const checkedAt = new Date().toISOString();
    const workflowUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/self-evolution-runner.yml`;
    const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA;
    const base = { scope: 'chat_backend', repository: `${owner}/${repo}`, checkedAt, workflowUrl,
      ...(/^[a-f0-9]{40}$/i.test(deploymentSha || '') ? { deploymentCommitSha: deploymentSha } : {}) };
    if (!this.isConfigured()) return { ...base, status: 'not_configured', code: 'chat_github_credential_missing',
      message: 'O backend que atende este chat nao possui GITHUB_TOKEN/GITHUB_APP_TOKEN nem GitHub App configurado. Configure a integracao no ambiente do servidor da Vercel. As secrets do Actions sao de outro ambiente; isto nao significa que os agentes do executor tenham apenas leitura.' };
    try {
      const access = await this.resolveCredential(owner, repo);
      const identity = this.credentialDiagnostic(access);
      const response = await this.githubFetch(`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/self-evolution-runner.yml`, {
        headers: this.getHeaders(access.token),
      });
      if (!response.ok) {
        const diagnostic = await inspectGithubFailure(response, [access.token]);
        return { ...base, ...identity, ...diagnostic, status: 'blocked', code: 'chat_workflow_access_denied',
          message: formatGithubFailure('A credencial do backend nao conseguiu consultar o workflow de manutencao', diagnostic) };
      }
      const workflow = await response.json() as { state?: string };
      const actionsPermission = access.permissions?.actions;
      const denied = access.source === 'github_app' && actionsPermission !== 'write';
      const blocked = denied || workflow.state !== 'active';
      return { ...base, ...identity, status: blocked ? 'blocked' : 'available', workflowState: workflow.state || 'unknown',
        workflowRead: 'confirmed', actionsWrite: actionsPermission === 'write' ? 'granted' : denied ? 'denied' : 'not_verified',
        code: denied ? 'chat_actions_write_missing' : blocked ? 'chat_workflow_inactive' : 'chat_workflow_read_confirmed',
        message: denied ? `A instalacao usada pela Vercel concede Actions:${actionsPermission || 'sem acesso'}; iniciar a manutencao exige Actions:write. Atualize e aprove as permissoes desta instalacao.`
          : blocked ? `O workflow consultado esta ${workflow.state || 'com estado desconhecido'}; e necessario estar active para iniciar a manutencao.`
          : 'O chat possui credencial e consultou o workflow. Uma ordem autenticada pode solicitar manutencao; somente o recibo do dispatch confirma o inicio solicitado. A escrita de arquivos, testes, PR e publicacao sao executados pela esteira externa.' };
    } catch (error) {
      return { ...base, status: 'blocked', code: error instanceof GithubAppError ? error.code : 'chat_workflow_check_failed',
        ...(error instanceof GithubAppError ? error.diagnostic : {}),
        message: safeGithubText(error instanceof Error ? error.message : 'Falha na consulta da integracao do chat.') };
    }
  }

  static async inspectEffectivePullRequest(url: string, expectedSha: string): Promise<{ status: 'changed' | 'empty' | 'unavailable'; message: string }> {
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png', repo = process.env.GITHUB_REPO || 'frocia2';
    const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
    if (!match || match[1] !== owner || match[2] !== repo || !/^[a-f0-9]{40}$/i.test(expectedSha))
      return { status: 'unavailable', message: 'PR ou SHA inválido para conferir alterações.' };
    try {
      const token = await this.resolveAccessToken(owner, repo);
      const response = await this.githubFetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/pulls/${match[3]}`, { headers: this.getHeaders(token) });
      if (!response.ok) return { status: 'unavailable', message: `Não foi possível conferir alterações do PR: HTTP ${response.status}.` };
      const pull = await response.json();
      if (pull.head?.sha !== expectedSha || !Number.isSafeInteger(pull.changed_files) || pull.changed_files < 0)
        return { status: 'unavailable', message: 'O SHA ou o conjunto de arquivos do PR não foi comprovado.' };
      return pull.changed_files === 0 ? { status: 'empty', message: 'O PR não contém alterações efetivas. Não foi mesclado ou publicado.' }
        : { status: 'changed', message: 'O PR contém alterações no SHA esperado.' };
    } catch { return { status: 'unavailable', message: 'Consulta de alterações do PR indisponível.' }; }
  }

  static async dispatchOfficialCI(branchName: string): Promise<{ success: boolean; message: string }> {
    if (!/^froc-evolution\/[A-Za-z0-9._/-]+$/.test(branchName) || branchName.includes('..')) {
      return { success: false, message: 'Branch de manutencao invalida para solicitar o CI.' };
    }
    if (!this.isConfigured()) return { success: false, message: 'GitHub sem credencial para iniciar o CI.' };
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    try {
      const token = await this.resolveAccessToken(owner, repo);
      for (const workflow of ['ci.yml', 'capability-checks.yml']) {
        const response = await this.githubFetch(`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${workflow}/dispatches`, {
          method: 'POST', headers: this.getHeaders(token, true), body: JSON.stringify({ ref: branchName }),
        });
        if (!response.ok) return { success: false,
          message: `GitHub recusou solicitar ${workflow}: HTTP ${response.status}. Confira Actions com escrita e workflow_dispatch.` };
      }
      return { success: true, message: 'CI oficial e nove suites de capacidade solicitados para a branch da correcao.' };
    } catch (error) { return { success: false, message: error instanceof Error ? error.message : 'Falha ao solicitar CI.' }; }
  }

  /** Fixed validation workflow: no code changes, model calls or production deploy. */
  static async agentValidationRun(requestId: string, dispatch = false): Promise<Record<string, unknown>> {
    if (!/^validation-[a-f0-9]{32}$/.test(requestId)) return { status: 'blocked', message: 'Identificador de validação inválido.' };
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    const base = `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    try {
      const access = await this.resolveCredential(owner, repo);
      if (dispatch) {
        if (access.source === 'github_app' && access.permissions?.actions !== 'write')
          return { status: 'blocked', message: 'A instalação do GitHub App não concede Actions:write.' };
        const response = await this.githubFetch(`${base}/actions/workflows/agent-validation.yml/dispatches`, {
          method: 'POST', headers: this.getHeaders(access.token, true),
          body: JSON.stringify({ ref: process.env.GITHUB_BASE_BRANCH || 'main', inputs: { request_id: requestId } }),
        });
        if (response.status !== 204) return { status: 'blocked', message: formatGithubFailure('GitHub recusou a validação', await inspectGithubFailure(response, [access.token])) };
        return { status: 'dispatch_accepted', httpStatus: 204, message: 'GitHub aceitou a solicitação. O início e o resultado ainda precisam ser confirmados.' };
      }
      const response = await this.githubFetch(`${base}/actions/workflows/agent-validation.yml/runs?event=workflow_dispatch&per_page=50`, { headers: this.getHeaders(access.token) });
      if (!response.ok) return { status: 'unavailable', message: formatGithubFailure('Não consegui consultar a validação', await inspectGithubFailure(response, [access.token])) };
      const data = await response.json() as { workflow_runs?: Array<{ id: number; display_title: string; html_url: string; head_sha: string; status: string; conclusion: string | null }> };
      const run = data.workflow_runs?.find(run => run.display_title === requestId);
      return run ? { status: run.status, conclusion: run.conclusion, runId: run.id, url: run.html_url, commitSha: run.head_sha }
        : { status: 'not_found_in_window', message: 'Nenhuma execução correspondente encontrada nas últimas 50 rodadas deste workflow. Isso não comprova que nunca executou.' };
    } catch (error) { return { status: 'unavailable', message: safeGithubText(error instanceof Error ? error.message : 'Falha ao consultar GitHub') }; }
  }

  static async dispatchProfessionalFactory(): Promise<MaintenanceDispatchResult> {
    if (!this.isConfigured()) return { success: false, message: 'Pedido salvo na fila, mas o backend do chat esta sem credencial GitHub para solicitar Actions. Configure o GitHub App ou GITHUB_TOKEN/GITHUB_APP_TOKEN no servidor da Vercel; as secrets do Actions nao sao herdadas pelo chat.' };
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    try {
      const access = await this.resolveCredential(owner, repo);
      const identity = { repository: `${owner}/${repo}`, ...this.credentialDiagnostic(access) };
      if (access.source === 'github_app' && access.permissions?.actions !== 'write') {
        return { success: false, diagnostic: { ...identity, code: 'chat_actions_write_missing' },
          message: `A solicitacao permanece na fila: a instalacao ${access.installationId} do App ${access.appSlug || access.appId || 'configurado'} concede Actions:${access.permissions?.actions || 'sem acesso'}. Iniciar o workflow exige Actions:write nesta instalacao.` };
      }
      const response = await this.githubFetch(`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/professional-factory.yml/dispatches`, {
        method: 'POST', headers: this.getHeaders(access.token, true),
        body: JSON.stringify({ ref: process.env.GITHUB_BASE_BRANCH || 'main' }),
      });
      if (response.ok) return { success: true, diagnostic: { ...identity, httpStatus: response.status },
        message: 'Execucao de fabrica profissional solicitada ao GitHub Actions; acompanhe o resultado na fila.' };
      const diagnostic = await inspectGithubFailure(response, [access.token]);
      return { success: false, diagnostic: { ...identity, ...diagnostic },
        message: formatGithubFailure('A solicitacao permanece na fila; GitHub recusou iniciar o workflow', diagnostic) };
    } catch (error) {
      return { success: false, ...(error instanceof GithubAppError ? { diagnostic: { code: error.code, ...error.diagnostic } } : {}),
        message: `A solicitacao permanece na fila: ${safeGithubText(error instanceof Error ? error.message : 'falha de comunicacao com GitHub')}` };
    }
  }

  static async dispatchSelfMaintenance(candidateId?: string, dispatchId?: string): Promise<MaintenanceDispatchResult> {
    if (dispatchId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(dispatchId)) return { success: false, message: 'Identificador de disparo inválido.' };
    if (candidateId && !/^owner-[a-f0-9]{32}$/.test(candidateId)) return { success: false, message: 'Identificador de tarefa inválido.' };
    if (!this.isConfigured()) return { success: false, message: 'Pedido salvo na fila, mas o backend do chat esta sem credencial GitHub para solicitar Actions. Configure o GitHub App ou GITHUB_TOKEN/GITHUB_APP_TOKEN no servidor da Vercel; as secrets do Actions nao sao herdadas pelo chat.' };
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    try {
      const access = await this.resolveCredential(owner, repo);
      const identity = { repository: `${owner}/${repo}`, ...this.credentialDiagnostic(access) };
      if (access.source === 'github_app' && access.permissions?.actions !== 'write') {
        return { success: false, diagnostic: { ...identity, code: 'chat_actions_write_missing' },
          message: `A solicitacao permanece na fila: a instalacao ${access.installationId} do App ${access.appSlug || access.appId || 'configurado'} concede Actions:${access.permissions?.actions || 'sem acesso'}. Iniciar o workflow exige Actions:write nesta instalacao.` };
      }
      const response = await this.githubFetch(`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/self-evolution-runner.yml/dispatches`, {
        method: 'POST', headers: this.getHeaders(access.token, true),
        body: JSON.stringify({ ref: process.env.GITHUB_BASE_BRANCH || 'main', ...(candidateId ? { inputs: { candidate_id: candidateId, ...(dispatchId ? { dispatch_id: dispatchId } : {}) } } : {}) }),
      });
      if (response.ok) return { success: true, diagnostic: { ...identity, httpStatus: response.status },
        message: 'Execucao de manutencao solicitada ao GitHub Actions; acompanhe o resultado na fila.' };
      const diagnostic = await inspectGithubFailure(response, [access.token]);
      return { success: false, diagnostic: { ...identity, ...diagnostic },
        message: formatGithubFailure('A solicitacao permanece na fila; GitHub recusou iniciar o workflow', diagnostic) };
    } catch (error) {
      return { success: false, ...(error instanceof GithubAppError ? { diagnostic: { code: error.code, ...error.diagnostic } } : {}),
        message: `A solicitacao permanece na fila: ${safeGithubText(error instanceof Error ? error.message : 'falha de comunicacao com GitHub')}` };
    }
  }

  /** Prova Contents:write com um blob vazio, sem alterar arquivos, branches ou PRs. */
  static async verifyRepositoryAccess(): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured()) return { success: false, message: 'GitHub sem credencial de automacao no executor externo.' };
    const owner = (process.env.GITHUB_OWNER || 'brasilportalvip-png').trim();
    const repo = (process.env.GITHUB_REPO || 'frocia2').trim();
    try {
      const token = await this.resolveAccessToken(owner, repo);
      const response = await this.githubFetch(
        `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { headers: this.getHeaders(token) }
      );
      if (!response.ok) return { success: false, message: `GitHub recusou o acesso do executor ao repositorio: HTTP ${response.status}.` };
      await response.json();
      // permissions.push descreve metadados do repositorio e pode ser false para
      // GITHUB_TOKEN mesmo com Contents:write. A prova e uma operacao real de escrita.
      const writeResponse = await this.githubFetch(
        `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
        {
          method: 'POST', headers: this.getHeaders(token, true),
          body: JSON.stringify({ content: '', encoding: 'utf-8' }),
        }
      );
      if (writeResponse.status !== 201) {
        return { success: false, message: `GitHub recusou a prova de escrita do executor: HTTP ${writeResponse.status}. Confira Contents:write da credencial usada nesta rodada.` };
      }
      const blob = await writeResponse.json() as GitHubBlobResponse;
      if (blob.sha !== EMPTY_GIT_BLOB_SHA) {
        return { success: false, message: 'GitHub nao devolveu o blob vazio esperado; a escrita nao foi comprovada.' };
      }
      return { success: true, message: 'Leitura e escrita de objetos Git confirmadas. Branch, PR e merge ainda dependem das operacoes reais.' };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Falha ao verificar acesso ao GitHub.' };
    }
  }

  private static isConfigured(): boolean {
    const token = process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_APP_TOKEN?.trim();

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
      owner.trim().length > 0 &&
      repo.trim().length > 0
    );
  }

  private static async resolveAccessToken(
    owner: string,
    repo: string
  ): Promise<string> {
    return (await this.resolveCredential(owner, repo)).token;
  }

  private static async resolveCredential(owner: string, repo: string): Promise<MaintenanceCredential> {
    for (const environment of ['GITHUB_TOKEN', 'GITHUB_APP_TOKEN'] as const) {
      const token = process.env[environment]?.trim();
      if (token) return { token, source: 'token', environment };
    }

    const installation = await GithubAppService.inspectRepositoryInstallation(owner, repo);

    const access =
      await GithubAppService.installationToken(
        installation.installationId
      );

    return { token: access.token, source: 'github_app', environment: 'GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY',
      permissions: access.permissions, ...installation };
  }

  private static credentialDiagnostic(access: MaintenanceCredential): Record<string, unknown> {
    const permissions = Object.fromEntries(['actions', 'contents', 'pull_requests', 'checks', 'workflows'].map(name =>
      [name, ['read', 'write'].includes(access.permissions?.[name] || '') ? access.permissions![name] : 'none']));
    return { credential: access.source, credentialEnvironment: access.environment,
      ...(access.source === 'github_app' ? { appId: access.appId || null, appSlug: access.appSlug || null,
        installationId: access.installationId, permissions } : {
        selectionNotice: GithubAppService.isConfigured()
          ? `O servidor selecionou ${access.environment} antes do GitHub App. Alterar as permissoes do App nao modifica esse token.`
          : `O servidor usa ${access.environment}; suas permissoes de escrita dependem desta credencial.`,
      }) };
  }

  private static getHeaders(
    token: string,
    includeJson = false
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept:
        'application/vnd.github+json',
      'User-Agent':
        'FrocIA-SelfEvolution',
      'X-GitHub-Api-Version':
        '2022-11-28'
    };

    if (includeJson) {
      headers['Content-Type'] =
        'application/json';
    }

    return headers;
  }

  private static githubFetch(
    url: string,
    options: RequestInit = {},
    timeoutMs = GITHUB_REQUEST_TIMEOUT_MS
  ): Promise<Response> {
    return fetch(url, {
      ...options,
      signal: AbortSignal.timeout(
        timeoutMs
      )
    });
  }

  private static createFailure(
    errorMessage: string,
    status:
      | 'not_configured'
      | 'failed' = 'failed'
  ): PullRequestResult {
    return {
      status,
      success: false,
      errorMessage
    };
  }

  static async createBranchAndPR(
    candidate: ImprovementCandidate,
    patch?: PatchResult
  ): Promise<PullRequestResult> {
   

    const owner = (
      process.env.GITHUB_OWNER ||
      'brasilportalvip-png'
    ).trim();

    const repo = (
      process.env.GITHUB_REPO ||
      'frocia2'
    ).trim();

    const targetBaseBranch = (
      process.env.GITHUB_BASE_BRANCH ||
      'main'
    ).trim();

        if (!this.isConfigured()) {
      return this.createFailure(
        'Integração GitHub não configurada. Configure o GitHub App ou um token compatível.',
        'not_configured'
      );
    }

    if (
      !/^[a-zA-Z0-9._/-]+$/.test(
        targetBaseBranch
      ) ||
      targetBaseBranch.includes('..')
    ) {
      return this.createFailure(
        'Nome da branch base do GitHub é inválido.'
      );
    }

    if (
      !patch ||
      !patch.success ||
      patch.status !== 'success'
    ) {
      return this.createFailure(
        'Nenhum patch válido foi fornecido para criação do Pull Request.'
      );
    }

    if (
      !Array.isArray(patch.files) ||
      patch.files.length === 0
    ) {
      return this.createFailure(
        'O patch não contém arquivos para gerar um commit.'
      );
    }

    if (!EngineeringSandboxEvidenceService.isCompleteEvidence(
      patch.executionEvidence,
      candidate.id,
      patch.baseSha
    )) {
      return this.createFailure(
        'O patch não possui atestado completo e verificável da sandbox de engenharia.'
      );
    }

    let token: string;

    try {
      token = await this.resolveAccessToken(
        owner,
        repo
      );
    } catch (error) {
      return this.createFailure(
        error instanceof Error
          ? error.message
          : 'Não foi possível obter autenticação temporária do GitHub App.'
      );
    }

    const safeCandidateId = candidate.id
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/(^-+|-+$)/g, '')
      .slice(0, 60);

    const slug = candidate.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '')
      .slice(0, 60);

    if (!safeCandidateId) {
      return this.createFailure(
        'O identificador do candidato não permite criar uma branch segura.'
      );
    }

    const legacyBranchName =
      `froc-evolution/` +
      `${candidate.riskLevel.toLowerCase()}/` +
      `${safeCandidateId}-` +
      `${slug || 'improvement'}`;
    const scopedBranchName = `${legacyBranchName}-${patch.baseSha?.slice(0, 12) || 'base-missing'}`;
    const branchName = candidate.pullRequestUrl && [legacyBranchName, scopedBranchName].includes(candidate.branchName || '')
      ? candidate.branchName! : scopedBranchName;

    if (
      branchName === targetBaseBranch ||
      branchName === 'main' ||
      branchName === 'master'
    ) {
      return this.createFailure(
        'Operação direta na branch principal é proibida.'
      );
    }

    const repositoryUrl =
      `${GITHUB_API_URL}/repos/` +
      `${encodeURIComponent(owner)}/` +
      `${encodeURIComponent(repo)}`;

    try {
      /*
       * 1. Idempotência:
       * se o candidato já possui PR aberto,
       * retorna o mesmo PR sem criar duplicata.
       */
      const existingPrQuery =
        new URLSearchParams({
          state: 'open',
          head: `${owner}:${branchName}`
        });

      const existingPrResponse =
        await this.githubFetch(
          `${repositoryUrl}/pulls?${existingPrQuery.toString()}`,
          {
            headers:
              this.getHeaders(token)
          }
        );

      if (existingPrResponse.ok) {
        const existingPullRequests =
          await existingPrResponse.json() as
            GitHubPullRequestResponse[];

        if (
          Array.isArray(
            existingPullRequests
          ) &&
          existingPullRequests.length > 0
        ) {
          const existing =
            existingPullRequests[0];

          return {
            status: 'success',
            success: true,
            branchName,
            commitSha:
              existing.head?.sha,
            pullRequestUrl:
              existing.html_url,
            pullRequestId:
              existing.number
          };
        }
      }

      /*
       * 2. Obtém o SHA atual da branch base.
       */
      const baseReferenceResponse =
        await this.githubFetch(
          `${repositoryUrl}/git/ref/heads/${targetBaseBranch}`,
          {
            headers:
              this.getHeaders(token)
          }
        );

      if (!baseReferenceResponse.ok) {
        return this.createFailure(
          `Erro ao obter a branch ${targetBaseBranch}: HTTP ${baseReferenceResponse.status}.`
        );
      }

      const baseReference =
        await baseReferenceResponse.json() as
          GitHubReferenceResponse;

      const currentBaseSha =
        baseReference.object?.sha;

      if (
        !currentBaseSha ||
        !/^[a-f0-9]{40}$/i.test(
          currentBaseSha
        )
      ) {
        return this.createFailure(
          'GitHub não retornou um SHA válido para a branch base.'
        );
      }

      /*
       * Se o worker informou o SHA utilizado,
       * impede aplicar código produzido sobre uma
       * versão antiga do repositório.
       */
      if (
        patch.baseSha &&
        patch.baseSha !== currentBaseSha
      ) {
        return { ...this.createFailure(
          'A branch principal mudou depois da geração do patch. Gere novamente para evitar conflito ou perda de código.'
        ), requiresRegeneration: true };
      }

      /*
       * 3. Obtém a árvore do commit base.
       */
      const baseCommitResponse =
        await this.githubFetch(
          `${repositoryUrl}/git/commits/${currentBaseSha}`,
          {
            headers:
              this.getHeaders(token)
          }
        );

      if (!baseCommitResponse.ok) {
        return this.createFailure(
          `Erro ao consultar o commit base: HTTP ${baseCommitResponse.status}.`
        );
      }

      const baseCommit =
        await baseCommitResponse.json() as
          GitHubCommitResponse;

      const baseTreeSha =
        baseCommit.tree?.sha;

      if (
        !baseTreeSha ||
        !/^[a-f0-9]{40}$/i.test(
          baseTreeSha
        )
      ) {
        return this.createFailure(
          'GitHub não retornou a árvore do commit base.'
        );
      }

      /*
       * 4. Cria um blob no GitHub para cada
       * arquivo produzido pelo worker.
       */
      const blobEntries =
        await Promise.all(
          patch.files.map(
            async (file) => {
              const blobResponse =
                await this.githubFetch(
                  `${repositoryUrl}/git/blobs`,
                  {
                    method: 'POST',
                    headers:
                      this.getHeaders(
                        token,
                        true
                      ),
                    body: JSON.stringify({
                      content: file.content,
                      encoding: 'utf-8'
                    })
                  }
                );

              if (!blobResponse.ok) {
                throw new Error(
                  `Falha ao criar blob para ${file.path}: HTTP ${blobResponse.status}.`
                );
              }

              const blob =
                await blobResponse.json() as
                  GitHubBlobResponse;

              if (
                !blob.sha ||
                !/^[a-f0-9]{40}$/i.test(
                  blob.sha
                )
              ) {
                throw new Error(
                  `GitHub não retornou SHA válido para ${file.path}.`
                );
              }

              return {
                path: file.path,
                mode: '100644',
                type: 'blob',
                sha: blob.sha
              };
            }
          )
        );

      /*
       * 5. Cria uma nova árvore baseada na
       * árvore atual da branch principal.
       */
      const treeResponse =
        await this.githubFetch(
          `${repositoryUrl}/git/trees`,
          {
            method: 'POST',
            headers:
              this.getHeaders(token, true),
            body: JSON.stringify({
              base_tree: baseTreeSha,
              tree: blobEntries
            })
          }
        );

      if (!treeResponse.ok) {
        return this.createFailure(
          `Falha ao criar árvore do commit: HTTP ${treeResponse.status}.`
        );
      }

      const createdTree =
        await treeResponse.json() as
          GitHubTreeResponse;

      if (
        !createdTree.sha ||
        !/^[a-f0-9]{40}$/i.test(
          createdTree.sha
        )
      ) {
        return this.createFailure(
          'GitHub não retornou SHA válido para a nova árvore.'
        );
      }

      if (createdTree.sha === baseTreeSha) return { ...this.createFailure('A árvore gerada é igual à base. Nenhum commit ou PR foi criado.'), noChanges: true };

      /*
       * 6. Cria o commit verdadeiro.
       */
      const commitResponse =
        await this.githubFetch(
          `${repositoryUrl}/git/commits`,
          {
            method: 'POST',
            headers:
              this.getHeaders(token, true),
            body: JSON.stringify({
              message:
                patch.commitMessage ||
                `fix(self-evolution): ${candidate.title}`,
              tree: createdTree.sha,
              parents: [currentBaseSha]
            })
          }
        );

      if (!commitResponse.ok) {
        return this.createFailure(
          `Falha ao criar commit no GitHub: HTTP ${commitResponse.status}.`
        );
      }

      const createdCommit =
        await commitResponse.json() as
          GitHubCommitResponse;

      let createdCommitSha =
        createdCommit.sha;

      if (
        !createdCommitSha ||
        !/^[a-f0-9]{40}$/i.test(
          createdCommitSha
        ) ||
        createdCommitSha === currentBaseSha
      ) {
        return this.createFailure(
          'GitHub não criou um commit novo para o patch.'
        );
      }

      /*
       * 7. Cria a branch apontando para o
       * novo commit, nunca para o SHA da main.
       */
      const createReferenceResponse =
        await this.githubFetch(
          `${repositoryUrl}/git/refs`,
          {
            method: 'POST',
            headers:
              this.getHeaders(token, true),
            body: JSON.stringify({
              ref:
                `refs/heads/${branchName}`,
              sha: createdCommitSha
            })
          }
        );

      if (!createReferenceResponse.ok) {
        if (
          createReferenceResponse.status ===
          422
        ) {
          const existingReferenceResponse =
            await this.githubFetch(
              `${repositoryUrl}/git/ref/heads/${branchName}`,
              {
                headers:
                  this.getHeaders(token)
              }
            );

          if (
            !existingReferenceResponse.ok
          ) {
            return this.createFailure(
              'A branch já existe, mas não foi possível verificar seu commit.'
            );
          }

          const existingReference =
            await existingReferenceResponse.json() as
              GitHubReferenceResponse;

          if (
            existingReference.object?.sha !==
            createdCommitSha
          ) {
            const existingSha = existingReference.object?.sha;
            if (!existingSha || !/^[a-f0-9]{40}$/i.test(existingSha)) return this.createFailure('SHA da branch existente invalido.');
            const previousResponse = await this.githubFetch(`${repositoryUrl}/git/commits/${existingSha}`, { headers: this.getHeaders(token) });
            const previous = previousResponse.ok ? await previousResponse.json() as GitHubCommitResponse : null;
            if (previous?.tree?.sha !== createdTree.sha || previous.parents?.length !== 1 || previous.parents[0].sha !== currentBaseSha) {
              return this.createFailure('Ja existe uma branch desse candidato com conteudo/base diferente. A operacao foi interrompida para evitar sobrescrita.');
            }
            // Um POST de PR pode falhar depois de a branch ter sido criada.
            // Reutilizar o commit certificado evita cobrar outro patch.
            createdCommitSha = existingSha;
          }
        } else {
          return this.createFailure(
            `Falha ao criar branch no GitHub: HTTP ${createReferenceResponse.status}.`
          );
        }
      }

      /*
       * 8. Abre o Pull Request após confirmar
       * que existe commit diferente da main.
       */
      const pullRequestResponse =
        await this.githubFetch(
          `${repositoryUrl}/pulls`,
          {
            method: 'POST',
            headers:
              this.getHeaders(token, true),
            body: JSON.stringify({
              title:
                `[Autoevolução ${candidate.riskLevel}] ${candidate.title}`,
              head: branchName,
              base: targetBaseBranch,
              body:
                `## Candidato de Autoevolução: ${candidate.title}\n\n` +
                `**ID:** \`${candidate.id}\`\n` +
                `**Nível de risco:** \`${candidate.riskLevel}\`\n` +
                `**Resumo:** ${candidate.summary}\n\n` +
                `### Alterações geradas\n` +
                patch.files
                  .map(
                    (file) =>
                      `- \`${file.path}\``
                  )
                  .join('\n') +
                `\n\n**Linhas adicionadas:** ${patch.linesAdded}\n` +
                `**Linhas removidas:** ${patch.linesRemoved}\n\n` +
                `Este PR foi criado pela manutencao autonoma da Froc.IA. O merge automatico depende de CI, preview, comparacao de capacidades e revisao independente aprovados.`
            })
          }
        );

      if (!pullRequestResponse.ok) {
        return this.createFailure(
          formatGithubFailure('Falha ao criar Pull Request no GitHub', await inspectGithubFailure(pullRequestResponse, [token]))
        );
      }

      const pullRequest =
        await pullRequestResponse.json() as
          GitHubPullRequestResponse;

      if (
        !pullRequest.html_url ||
        !pullRequest.number
      ) {
        return this.createFailure(
          'GitHub criou uma resposta de PR incompleta.'
        );
      }

      return {
        status: 'success',
        success: true,
        branchName,
        commitSha: createdCommitSha,
        pullRequestUrl:
          pullRequest.html_url,
        pullRequestId:
          pullRequest.number
      };
    } catch (error: any) {
      const timedOut =
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError';

      return this.createFailure(
        timedOut
          ? 'A automação do GitHub excedeu o limite de tempo.'
          : `Erro na automação do GitHub: ${error?.message || error}`
      );
    }
  }

  static async mergeApprovedPullRequest(
    pullRequestUrl: string | undefined,
    expectedHeadSha: string | undefined
  ): Promise<MergePullRequestResult> {
    
    const owner = (process.env.GITHUB_OWNER || 'brasilportalvip-png').trim();
    const repo = (process.env.GITHUB_REPO || 'frocia2').trim();
    const match = pullRequestUrl?.match(
      /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/
    );

    if (!this.isConfigured()) {
      return { success: false, message: 'Integração GitHub não configurada para merge.' };
    }
    if (!match || match[1] !== owner || match[2] !== repo) {
      return { success: false, message: 'URL do Pull Request não pertence ao repositório configurado.' };
    }
    if (!expectedHeadSha || !/^[a-f0-9]{40}$/i.test(expectedHeadSha)) {
      return { success: false, message: 'SHA esperado do Pull Request é inválido ou ausente.' };
    }

    const pullNumber = Number(match[3]);
    const repositoryUrl = `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    try {
    
  const token = await this.resolveAccessToken(owner, repo);

  const inspectResponse = await this.githubFetch(
        `${repositoryUrl}/pulls/${pullNumber}`,
        { headers: this.getHeaders(token) }
      );
      if (!inspectResponse.ok) {
        return { success: false, message: `Falha ao conferir PR #${pullNumber}: HTTP ${inspectResponse.status}.` };
      }
      const pull = (await inspectResponse.json()) as GitHubPullRequestResponse;
      if (pull.merged === true && pull.head?.sha === expectedHeadSha && /^[a-f0-9]{40}$/i.test(pull.merge_commit_sha || '')) {
        return { success: true, mergeCommitSha: pull.merge_commit_sha, message: `PR #${pullNumber} ja mergeado; retomando a verificacao da publicacao.` };
      }
      if (pull.state !== 'open' || pull.draft === true) {
        return { success: false, message: `PR #${pullNumber} não está aberto e pronto para merge.` };
      }
      if (pull.head?.sha !== expectedHeadSha) {
        return {
          success: false,
          message: 'O commit do PR mudou depois da aprovação. O comitê deve revisar novamente.',
        };
      }

      const mergeResponse = await this.githubFetch(
        `${repositoryUrl}/pulls/${pullNumber}/merge`,
        {
          method: 'PUT',
          headers: this.getHeaders(token, true),
          body: JSON.stringify({
            sha: expectedHeadSha,
            merge_method: 'merge',
            commit_title: `Merge supervisionado do PR #${pullNumber}`,
          }),
        }
      );
      const merge = (await mergeResponse.json()) as {
        merged?: boolean;
        sha?: string;
        message?: string;
      };
      if (!mergeResponse.ok || merge.merged !== true) {
        return {
          success: false,
          message: merge.message || `GitHub recusou o merge (HTTP ${mergeResponse.status}).`,
        };
      }
      return {
        success: true,
        mergeCommitSha: merge.sha,
        message: `PR #${pullNumber} mergeado; deploy e smoke test ainda precisam ser comprovados.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Falha no merge supervisionado: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
