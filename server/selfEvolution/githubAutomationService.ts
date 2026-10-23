import type {
  PatchResult
} from './codeAgentService.js';
import {
  ImprovementCandidate
} from './selfEvolutionTypes.js';

import { EngineeringSandboxEvidenceService } from './engineeringSandboxEvidenceService.js';
import { GithubAppService } from '../services/githubAppService.js';
import { RedactionService } from './redactionService.js';

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

export class GithubAutomationService {
  /** Consulta sem criar commit nem disparar um ciclo pago. Os segredos do
   * Actions nao sao automaticamente credenciais do backend que atende o chat. */
  static async inspectMaintenanceConnection(): Promise<Record<string, unknown>> {
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    const checkedAt = new Date().toISOString();
    const workflowUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/self-evolution-runner.yml`;
    const base = { scope: 'chat_backend', repository: `${owner}/${repo}`, checkedAt, workflowUrl };
    if (!this.isConfigured()) return { ...base, status: 'not_configured', code: 'chat_github_credential_missing',
      message: 'O backend que atende este chat nao possui GITHUB_TOKEN/GITHUB_APP_TOKEN nem GitHub App configurado. Configure a integracao no ambiente do servidor da Vercel. As secrets do Actions sao de outro ambiente; isto nao significa que os agentes do executor tenham apenas leitura.' };
    try {
      const access = await this.resolveCredential(owner, repo);
      const response = await this.githubFetch(`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/self-evolution-runner.yml`, {
        headers: this.getHeaders(access.token),
      });
      if (!response.ok) return { ...base, credential: access.source, status: 'blocked', code: 'chat_workflow_access_denied', httpStatus: response.status,
        message: `A credencial do backend nao conseguiu consultar o workflow de manutencao: HTTP ${response.status}.` };
      const workflow = await response.json() as { state?: string };
      const actionsPermission = access.permissions?.actions;
      const blocked = (actionsPermission !== undefined && actionsPermission !== 'write') || workflow.state !== 'active';
      return { ...base, credential: access.source, status: blocked ? 'blocked' : 'available', workflowState: workflow.state,
        workflowRead: 'confirmed', actionsWrite: actionsPermission === 'write' ? 'granted' : actionsPermission ? 'denied' : 'not_verified',
        message: blocked ? 'Confira se o workflow esta ativo e se o GitHub App possui Actions:write.'
          : 'O chat possui credencial e consultou o workflow. Uma ordem autenticada pode solicitar manutencao; somente o recibo do dispatch confirma o inicio solicitado. A escrita de arquivos, testes, PR e publicacao sao executados pela esteira externa.' };
    } catch (error) {
      return { ...base, status: 'blocked', code: 'chat_workflow_check_failed',
        message: RedactionService.redactSensitiveData(error instanceof Error ? error.message : 'Falha na consulta da integracao do chat.') };
    }
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

  static async dispatchSelfMaintenance(): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured()) return { success: false, message: 'Pedido salvo na fila, mas o backend do chat esta sem credencial GitHub para solicitar Actions. Configure o GitHub App ou GITHUB_TOKEN/GITHUB_APP_TOKEN no servidor da Vercel; as secrets do Actions nao sao herdadas pelo chat.' };
    const owner = process.env.GITHUB_OWNER || 'brasilportalvip-png';
    const repo = process.env.GITHUB_REPO || 'frocia2';
    try {
      const token = await this.resolveAccessToken(owner, repo);
      const response = await this.githubFetch(`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/self-evolution-runner.yml/dispatches`, {
        method: 'POST', headers: this.getHeaders(token, true),
        body: JSON.stringify({ ref: process.env.GITHUB_BASE_BRANCH || 'main' }),
      });
      return { success: response.ok, message: response.ok
        ? 'Execucao de manutencao solicitada ao GitHub Actions; acompanhe o resultado na fila.'
        : `A solicitacao permanece na fila; GitHub recusou iniciar o workflow: HTTP ${response.status}.` };
    } catch (error) {
      return { success: false, message: `A solicitacao permanece na fila: ${error instanceof Error ? error.message : 'falha de comunicacao com GitHub'}` };
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

  private static async resolveCredential(owner: string, repo: string): Promise<{
    token: string; source: 'token' | 'github_app'; permissions?: Record<string, string>;
  }> {
    const staticToken =
      process.env.GITHUB_TOKEN ||
      process.env.GITHUB_APP_TOKEN;

    if (staticToken?.trim()) {
      return { token: staticToken.trim(), source: 'token' };
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

    return { token: access.token, source: 'github_app', permissions: access.permissions };
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
    options: RequestInit = {}
  ): Promise<Response> {
    return fetch(url, {
      ...options,
      signal: AbortSignal.timeout(
        GITHUB_REQUEST_TIMEOUT_MS
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

    const branchName =
      `froc-evolution/` +
      `${candidate.riskLevel.toLowerCase()}/` +
      `${safeCandidateId}-` +
      `${slug || 'improvement'}`;

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
          `Falha ao criar Pull Request no GitHub: HTTP ${pullRequestResponse.status}.`
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
