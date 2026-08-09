import { SelfEvolutionBudget } from './selfEvolutionTypes.js';

export class BudgetService {
  private static budget: SelfEvolutionBudget = {
    dailyCreditLimit: 500,
    dailyCreditsUsed: 0,
    monthlyCreditLimit: 10000,
    monthlyCreditsUsed: 0,
    dailyMaxAgentRuns: 20,
    dailyAgentRunsCount: 0,
    lastResetDate: new Date().toISOString().split('T')[0],
  };

  static checkAndResetDailyBudget(): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.budget.lastResetDate !== today) {
      this.budget.dailyCreditsUsed = 0;
      this.budget.dailyAgentRunsCount = 0;
      this.budget.lastResetDate = today;
    }
  }

  static getBudgetStatus(): SelfEvolutionBudget {
    this.checkAndResetDailyBudget();
    return { ...this.budget };
  }

  static canExecuteAgentRun(estimatedCredits: number = 10): boolean {
    this.checkAndResetDailyBudget();
    if (this.budget.dailyAgentRunsCount >= this.budget.dailyMaxAgentRuns) {
      return false;
    }
    if (this.budget.dailyCreditsUsed + estimatedCredits > this.budget.dailyCreditLimit) {
      return false;
    }
    if (this.budget.monthlyCreditsUsed + estimatedCredits > this.budget.monthlyCreditLimit) {
      return false;
    }
    return true;
  }

  static consumeBudget(credits: number): void {
    this.checkAndResetDailyBudget();
    this.budget.dailyCreditsUsed += credits;
    this.budget.monthlyCreditsUsed += credits;
    this.budget.dailyAgentRunsCount += 1;
  }
}
