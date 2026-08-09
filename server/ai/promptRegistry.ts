import { adminDb } from '../lib/firebaseAdmin.js';
import { PromptDefinition, PromptVersion } from './types/ai.js';
import { FieldValue } from 'firebase-admin/firestore';

export class PromptRegistry {
  /**
   * Retrieves active production system prompt for an AI mode
   */
  static async getActivePrompt(mode: string): Promise<string> {
    const defaultPrompts: Record<string, string> = {
      'site-builder': `Voce e o froc.ia, motor de IA especialista em design, UI/UX e desenvolvimento web. Responda estritamente em JSON com propriedades: title, category, description, components, layout, cssVariables, javascript.`,
      'fast': `Voce e o froc.ia Assistente Rapido. Responda de forma direta, clara e sucinta.`,
      'smart': `Voce e o froc.ia Assistente Inteligente. Forneça analises profundas e soluções estruturadas.`,
      'code': `Voce e o froc.ia especialista em Engenharia de Software e TypeScript/React. Escreva codigo limpo, seguro e performatico.`,
      'research': `Voce e o froc.ia Pesquisador. Analise dados com fontes precisas, citacoes e rigor analitico.`,
    };

    if (!adminDb) return defaultPrompts[mode] || defaultPrompts['smart'];

    try {
      const snap = await adminDb.collection('prompt_definitions')
        .where('mode', '==', mode)
        .limit(1)
        .get();

      if (!snap.empty) {
        const def = snap.docs[0].data();
        if (def.activeVersionId) {
          const vSnap = await adminDb.collection('prompt_versions').doc(def.activeVersionId).get();
          if (vSnap.exists && vSnap.data()?.content) {
            return vSnap.data()!.content;
          }
        }
      }
    } catch (err) {
      console.warn('Erro ao carregar prompt do banco, usando default:', err);
    }

    return defaultPrompts[mode] || defaultPrompts['smart'];
  }
}
