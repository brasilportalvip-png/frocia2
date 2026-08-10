import { isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { SelfEvolutionBudget } from './selfEvolutionTypes.js';
import { IBudgetRepository, FirestoreBudgetRepository, InMemoryBudgetRepository } from './repositories.js';

export class BudgetService {
  private static defaultBudget: SelfEvolutionBudget = {
    dailyCreditLimit: 500,
    dailyCreditsUsed: 0,
    monthlyCreditLimit: 10000,
    monthlyCreditsUsed: 0,
    dailyMaxAgentRuns: 20,
    dailyAgentRunsCount: 0,
    lastResetDate: new Date().toISOString().split('T')[0],
  };

  private static repository: IBudgetRepository | null = null;

  private static getRepo(): IBudgetRepository {
    if (!this.repository) {
      if (isFirebaseAdminConfigured() || Boolean(process.env.FIRESTORE_EMULATOR_HOST)) {
        this.repository = new FirestoreBudgetRepository(this.defaultBudget);
      } else {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('Firestore adminDb não configurado em ambiente de produção para BudgetService.');
        }
        this.repository = new InMemoryBudgetRepository(this.defaultBudget);
      }
    }
    return this.repository;
  }

  static setRepository(repo: IBudgetRepository): void {
    this.repository = repo;
  }

  static async getBudgetStatus(): Promise<SelfEvolutionBudget> {
    return await this.getRepo().getBudget();
  }

  static async canExecuteAgentRun(estimatedCredits: number = 10): Promise<boolean> {
    const budget = await this.getBudgetStatus();
    if (budget.dailyAgentRunsCount >= budget.dailyMaxAgentRuns) return false;
    if (budget.dailyCreditsUsed + estimatedCredits > budget.dailyCreditLimit) return false;
    if (budget.monthlyCreditsUsed + estimatedCredits > budget.monthlyCreditLimit) return false;
    return true;
  }

  static async consumeBudget(credits: number): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0];
    return await this.getRepo().consumeBudget(credits, today, this.defaultBudget);
  }
}
