import { env } from './env.js';
import { AIModelDefinition } from '../ai/types/ai.js';

const MODEL_DEFINITIONS: AIModelDefinition[] = [
  {
    id: env.GEMINI_DEFAULT_MODEL,
    provider: 'google',
    enabled: true,
    capabilities: {
      text: true,
      vision: true,
      audio: false,
      video: false,
      code: true,
      tools: true,
      structuredOutput: true,
      longContext: true,
      embeddings: false,
    },
    priority: 1,
    timeoutMs: 30000,
    maxRetries: 2,
    costProfile: 'Standard Flash',
    pricing: {
      inputTokensPerCredit: 5000,
      outputTokensPerCredit: 2000,
      baseCreditCost: 2,
    },
  },

  {
    id: env.GEMINI_FAST_MODEL,
    provider: 'google',
    enabled: true,
    capabilities: {
      text: true,
      vision: true,
      audio: false,
      video: false,
      code: true,
      tools: true,
      structuredOutput: true,
      longContext: true,
      embeddings: false,
    },
    priority: 2,
    timeoutMs: 15000,
    maxRetries: 2,
    costProfile: 'Fast Flash Lite',
    pricing: {
      inputTokensPerCredit: 10000,
      outputTokensPerCredit: 3000,
      baseCreditCost: 1,
    },
  },

  {
    id: env.GEMINI_REASONING_MODEL,
    provider: 'google',
    enabled: true,
    capabilities: {
      text: true,
      vision: true,
      audio: false,
      video: false,
      code: true,
      tools: true,
      structuredOutput: true,
      longContext: true,
      embeddings: false,
    },
    priority: 3,
    timeoutMs: 60000,
    maxRetries: 1,
    costProfile: 'Pro Reasoning',
    pricing: {
      inputTokensPerCredit: 1000,
      outputTokensPerCredit: 250,
      baseCreditCost: 8,
    },
  },

  {
    id: env.GEMINI_EMBEDDING_MODEL,
    provider: 'google',
    enabled: true,
    capabilities: {
      text: true,
      vision: false,
      audio: false,
      video: false,
      code: false,
      tools: false,
      structuredOutput: false,
      longContext: false,
      embeddings: true,
    },
    priority: 1,
    timeoutMs: 10000,
    maxRetries: 3,
    costProfile: 'Embedding Vector Model',
    pricing: {
      inputTokensPerCredit: 20000,
      outputTokensPerCredit: 20000,
      baseCreditCost: 1,
    },
  },
];

// Variáveis diferentes podem apontar para o mesmo modelo estável. Nesse caso,
// mantém a primeira definição em vez de sobrescrever silenciosamente cobrança,
// timeout e prioridade por causa de uma chave duplicada no objeto.
export const DEFAULT_MODELS_CONFIG: Record<string, AIModelDefinition> =
  MODEL_DEFINITIONS.reduce<Record<string, AIModelDefinition>>(
    (models, definition) => {
      if (!models[definition.id]) models[definition.id] = definition;
      return models;
    },
    {}
  );

export function getModelDefinition(modelId: string): AIModelDefinition {
  if (DEFAULT_MODELS_CONFIG[modelId]) {
    return DEFAULT_MODELS_CONFIG[modelId];
  }

  // Modelo desconhecido utiliza a mesma cobrança segura do modelo padrão.
  return {
    id: modelId,
    provider: 'google',
    enabled: true,
    capabilities: {
      text: true,
      vision: true,
      audio: false,
      video: false,
      code: true,
      tools: true,
      structuredOutput: true,
      longContext: true,
      embeddings: false,
    },
    priority: 10,
    timeoutMs: 30000,
    maxRetries: 1,
    costProfile: 'Custom Model',
    pricing: {
      inputTokensPerCredit: 5000,
      outputTokensPerCredit: 2000,
      baseCreditCost: 2,
    },
  };
}
