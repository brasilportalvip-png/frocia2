import { ImprovementCandidate } from './selfEvolutionTypes.js';

export interface PullRequestResult {
  branchName: string;
  pullRequestUrl: string;
  pullRequestId: number;
}

export class GithubAutomationService {
  static createBranchAndPR(candidate: ImprovementCandidate): PullRequestResult {
    const slug = candidate.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const branchName = `froc-evolution/${candidate.riskLevel.toLowerCase()}/${candidate.id}-${slug}`;

    return {
      branchName,
      pullRequestUrl: `https://github.com/brasilportalvip-png/frocia2/pull/mock-${candidate.id}`,
      pullRequestId: Math.floor(Math.random() * 1000) + 1,
    };
  }
}
