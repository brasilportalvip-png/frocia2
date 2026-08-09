import { env } from '../config/env.js';
import { GoogleGenAI } from '@google/genai';

export class EmbeddingService {
  private static getClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({ apiKey });
  }

  /**
   * Generates embedding vector for a given text snippet using Gemini Embedding API
   */
  static async generateEmbedding(text: string): Promise<number[]> {
    const client = this.getClient();
    if (!client) {
      // Fallback pseudo-vector for offline/mock test environments
      return this.generatePseudoVector(text);
    }

    try {
      const response = await client.models.embedContent({
        model: env.GEMINI_EMBEDDING_MODEL,
        contents: text,
      });

      const resAny = response as any;
      if (resAny.embedding?.values) {
        return resAny.embedding.values;
      }
      if (resAny.embeddings?.[0]?.values) {
        return resAny.embeddings[0].values;
      }
      return this.generatePseudoVector(text);
    } catch (err) {
      console.warn('Erro ao gerar embedding no Gemini API, usando fallback:', err);
      return this.generatePseudoVector(text);
    }
  }

  /**
   * Deterministic fallback vector generation based on character frequencies
   */
  private static generatePseudoVector(text: string): number[] {
    const vector = new Array(64).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      vector[i % 64] += (code % 31) / 31;
    }
    // Normalize vector
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
    return vector.map((v) => Number((v / norm).toFixed(4)));
  }

  /**
   * Cosine similarity between two vectors
   */
  static cosineSimilarity(v1: number[], v2: number[]): number {
    if (!v1 || !v2 || v1.length !== v2.length) return 0;
    let dot = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < v1.length; i++) {
      dot += v1[i] * v2[i];
      norm1 += v1[i] * v1[i];
      norm2 += v2[i] * v2[i];
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }
}
