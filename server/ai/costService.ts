import { ModelRegistry } from './modelRegistry.js';

export class CostService {
  /**
   * Estimates tokens based on character count (approx ~4 chars per token for pt-BR / en)
   */
  static estimateTokenCount(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.8);
  }

  /**
   * Calculates required credits based on model pricing profile and token counts
   */
  static calculateCreditCost(
    modelId: string,
    inputTokens: number,
    outputTokens = 0,
    hasTools = false,
    hasSearch = false
  ): number {
    const model = ModelRegistry.getModel(modelId);
    const pricing = model.pricing;

    const inputCost = Math.ceil(inputTokens / pricing.inputTokensPerCredit);
    const outputCost = Math.ceil(outputTokens / pricing.outputTokensPerCredit);
    const toolBonus = hasTools ? 5 : 0;
    const searchBonus = hasSearch ? 5 : 0;

    const total = pricing.baseCreditCost + inputCost + outputCost + toolBonus + searchBonus;
    return Math.max(1, total);
  }

  /**
   * Estimates initial credit reserve ceiling before execution
   */
  static estimateReservationCeiling(
    modelId: string,
    prompt: string,
    hasImages = false,
    hasTools = false,
    hasSearch = false
  ): number {
    const inputTokens = this.estimateTokenCount(prompt) + (hasImages ? 1000 : 0);
    const estimatedOutputTokens = 1500; // conservative output allowance

    const calculated = this.calculateCreditCost(modelId, inputTokens, estimatedOutputTokens, hasTools, hasSearch);
    // Add 20% safety margin for ceiling
    return Math.ceil(calculated * 1.2);
  }
}
