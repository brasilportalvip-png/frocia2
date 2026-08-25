import type {
  PatchResult
} from './codeAgentService.js';
import {
  ImprovementCandidate
} from './selfEvolutionTypes.js';

const GITHUB_API_URL =
  'https://api.github.com';
const GITHUB_REQUEST_TIMEOUT_MS = 30_000;

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
}

export class GithubAutomationService {
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
      token &&
      token.trim().length > 0 &&
      owner.trim().length > 0 &&
      repo.trim().length > 0
    );
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
    const configuredToken =
      process.env.GITHUB_TOKEN ||
      process.env.GITHUB_APP_TOKEN;

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

    if (
      !this.isConfigured() ||
      !configuredToken
    ) {
      return this.createFailure(
        'Integração GitHub não configurada. Configure GITHUB_TOKEN ou GITHUB_APP_TOKEN.',
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

    const token =
      configuredToken.trim();

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
        return this.createFailure(
          'A branch principal mudou depois da geração do patch. Gere novamente para evitar conflito ou perda de código.'
        );
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

      const createdCommitSha =
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
            return this.createFailure(
              'Já existe uma branch desse candidato apontando para outro commit. A operação foi interrompida para evitar sobrescrita.'
            );
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
                `Este PR foi criado pela autoevolução supervisionada da Froc.IA e exige revisão humana antes do merge.`
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
}
