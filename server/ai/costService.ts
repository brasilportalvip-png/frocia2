import { ModelRegistry } from './modelRegistry.js';
import type { AIMode } from './types/ai.js';

interface CreditRange {
  minimum: number;
  maximum: number;
}

export class CostService {
  private static readonly MODE_CREDIT_RANGES: Partial<
    Record<AIMode, CreditRange>
  > = {
    fast: {
      minimum: 3,
      maximum: 5,
    },
    smart: {
      minimum: 5,
      maximum: 5,
    },
    deep: {
      minimum: 10,
      maximum: 18,
    },
    research: {
      minimum: 10,
      maximum: 18,
    },
    image: {
      minimum: 18,
      maximum: 18,
    },
    video: {
      minimum: 30,
      maximum: 30,
    },
    code: {
      minimum: 40,
      maximum: 60,
    },
    'site-builder': {
      minimum: 250,
      maximum: 300,
    },
    document: {
      minimum: 5,
      maximum: 18,
    },
  };

  /**
   * Estima a quantidade de tokens pela quantidade de caracteres.
   */
  static estimateTokenCount(text: string): number {
    if (!text) {
      return 0;
    }

    return Math.ceil(text.length / 3.8);
  }

  /**
   * Retorna a faixa oficial de créditos do modo informado.
   */
  static getModeCreditRange(mode?: AIMode): CreditRange | undefined {
    if (!mode) {
      return undefined;
    }

    return this.MODE_CREDIT_RANGES[mode];
  }

  /**
   * Mantém o consumo dentro da faixa oficial do modo.
   */
  private static applyModeCreditRange(
    calculatedCredits: number,
    mode?: AIMode
  ): number {
    const range = this.getModeCreditRange(mode);

    if (!range) {
      return Math.max(1, calculatedCredits);
    }

    return Math.min(
      range.maximum,
      Math.max(range.minimum, calculatedCredits)
    );
  }

  /**
   * Calcula o consumo real com base no modelo, tokens e recursos usados.
   */
  static calculateCreditCost(
    modelId: string,
    inputTokens: number,
    outputTokens = 0,
    hasTools = false,
    hasSearch = false,
    mode?: AIMode
  ): number {
    const model = ModelRegistry.getModel(modelId);
    const pricing = model.pricing;

    const inputCost = Math.ceil(
      inputTokens / pricing.inputTokensPerCredit
    );

    const outputCost = Math.ceil(
      outputTokens / pricing.outputTokensPerCredit
    );

    const toolCost = hasTools ? 5 : 0;
    const searchCost = hasSearch ? 5 : 0;

    const calculatedCredits =
      pricing.baseCreditCost +
      inputCost +
      outputCost +
      toolCost +
      searchCost;

    return this.applyModeCreditRange(
      calculatedCredits,
      mode
    );
  }

  /**
   * Calcula o teto reservado antes da execução.
   */
  static estimateReservationCeiling(
    modelId: string,
    prompt: string,
    hasImages = false,
    hasTools = false,
    hasSearch = false,
    mode?: AIMode
  ): number {
    const range = this.getModeCreditRange(mode);

    if (range) {
      return range.maximum;
    }

    const inputTokens =
      this.estimateTokenCount(prompt) +
      (hasImages ? 1000 : 0);

    const estimatedOutputTokens = 1500;

    const calculatedCredits = this.calculateCreditCost(
      modelId,
      inputTokens,
      estimatedOutputTokens,
      hasTools,
      hasSearch
    );

    return Math.ceil(calculatedCredits * 1.2);
  }
}