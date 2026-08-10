import { adminDb } from '../lib/firebaseAdmin.js';
import { SelfEvolutionBudget } from './selfEvolutionTypes.js';

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

  static async getBudgetStatus(): Promise<SelfEvolutionBudget> {
    const today = new Date().toISOString().split('T')[0];

    if (adminDb) {
      try {
        const docRef = adminDb.collection('self_evolution_budgets').doc('global');
        const doc = await docRef.get();

        if (doc.exists) {
          const data = doc.data() as SelfEvolutionBudget;
          if (data.lastResetDate !== today) {
            data.dailyCreditsUsed = 0;
            data.dailyAgentRunsCount = 0;
            data.lastResetDate = today;
            await docRef.set(data, { merge: true });
          }
          this.defaultBudget = { ...data };
          return data;
        } else {
          await docRef.set(this.defaultBudget);
          return { ...this.defaultBudget };
        }
      } catch (err) {
        console.warn('⚠️ Erro ao buscar orçamento no Firestore, utilizando fallback em memória:', (err as any)?.message || err);
      }
    }

    if (this.defaultBudget.lastResetDate !== today) {
      this.defaultBudget.dailyCreditsUsed = 0;
      this.defaultBudget.dailyAgentRunsCount = 0;
      this.defaultBudget.lastResetDate = today;
    }
    return { ...this.defaultBudget };
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

    if (adminDb) {
      try {
        const docRef = adminDb.collection('self_evolution_budgets').doc('global');
        return await adminDb.runTransaction(async (transaction) => {
          const doc = await transaction.get(docRef);
          let current: SelfEvolutionBudget = doc.exists ? (doc.data() as SelfEvolutionBudget) : { ...this.defaultBudget };

          if (current.lastResetDate !== today) {
            current.dailyCreditsUsed = 0;
            current.dailyAgentRunsCount = 0;
            current.lastResetDate = today;
          }

          if (current.dailyAgentRunsCount >= current.dailyMaxAgentRuns) return false;
          if (current.dailyCreditsUsed + credits > current.dailyCreditLimit) return false;
          if (current.monthlyCreditsUsed + credits > current.monthlyCreditLimit) return false;

          current.dailyCreditsUsed += credits;
          current.monthlyCreditsUsed += credits;
          current.dailyAgentRunsCount += 1;

          transaction.set(docRef, current);
          this.defaultBudget = { ...current };
          return true;
        });
      } catch (err) {
        console.warn('⚠️ Erro de transação ao consumir orçamento no Firestore, aplicando fallback em memória:', (err as any)?.message || err);
      }
    }

    if (this.defaultBudget.lastResetDate !== today) {
      this.defaultBudget.dailyCreditsUsed = 0;
      this.defaultBudget.dailyAgentRunsCount = 0;
      this.defaultBudget.lastResetDate = today;
    }

    if (this.defaultBudget.dailyAgentRunsCount >= this.defaultBudget.dailyMaxAgentRuns) return false;
    if (this.defaultBudget.dailyCreditsUsed + credits > this.defaultBudget.dailyCreditLimit) return false;
    if (this.defaultBudget.monthlyCreditsUsed + credits > this.defaultBudget.monthlyCreditLimit) return false;

    this.defaultBudget.dailyCreditsUsed += credits;
    this.defaultBudget.monthlyCreditsUsed += credits;
    this.defaultBudget.dailyAgentRunsCount += 1;
    return true;
  }
}

