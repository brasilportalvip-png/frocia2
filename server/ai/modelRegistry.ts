import { DEFAULT_MODELS_CONFIG, getModelDefinition } from '../config/aiModels.js';
import { AIModelDefinition } from './types/ai.js';

export class ModelRegistry {
  private static models: Map<string, AIModelDefinition> = new Map(
    Object.entries(DEFAULT_MODELS_CONFIG)
  );

  static getModel(id: string): AIModelDefinition {
    const found = this.models.get(id);
    if (found) return found;
    return getModelDefinition(id);
  }

  static listEnabledModels(): AIModelDefinition[] {
    return Array.from(this.models.values()).filter((m) => m.enabled);
  }

  static registerModel(model: AIModelDefinition): void {
    this.models.set(model.id, model);
  }
}
