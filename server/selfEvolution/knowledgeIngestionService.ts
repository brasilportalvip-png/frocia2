import crypto from 'crypto';
import { adminDb } from '../lib/firebaseAdmin.js';
import { KnowledgeDocument } from './selfEvolutionTypes.js';
import { RedactionService } from './redactionService.js';
import { PromptInjectionDefense } from './promptInjectionDefense.js';

export class KnowledgeIngestionService {
  private static inMemoryDocs: KnowledgeDocument[] = [];

  static async ingestDocument(params: {
    ownerId: string;
    title: string;
    url?: string;
    content: string;
    author: string;
    permissions?: string[];
  }): Promise<KnowledgeDocument> {
    const rawRedacted = RedactionService.redactSensitiveData(params.content);
    const sanitized = PromptInjectionDefense.sanitizeUntrustedText(rawRedacted);
    const contentHash = crypto.createHash('sha256').update(sanitized).digest('hex');

    const apiKey = process.env.GEMINI_API_KEY;
    const isModelConfigured = Boolean(apiKey && apiKey.trim().length > 0);

    const doc: KnowledgeDocument = {
      id: `know-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      ownerId: params.ownerId,
      title: params.title,
      url: params.url ?? null,
      contentHash,
      version: 1,
      author: params.author,
      confidence: 0.95,
      approved: false, // Default requires approval
      permissions: params.permissions || ['public'],
      embeddingModel: 'text-embedding-004',
      embeddingDimension: 768,
      indexingState: isModelConfigured ? 'indexed' : 'pending_configuration',
      updatedAt: new Date().toISOString(),
    };

    if (adminDb) {
      try {
        await adminDb.collection('self_evolution_knowledge_sources').doc(doc.id).set(doc);
      } catch (err) {
        console.error('Erro ao salvar documento de conhecimento no Firestore:', err);
      }
    }

    this.inMemoryDocs.unshift(doc);
    return doc;
  }

  static async getDocuments(ownerId: string): Promise<KnowledgeDocument[]> {
    if (adminDb) {
      try {
        const snapshot = await adminDb
          .collection('self_evolution_knowledge_sources')
          .where('ownerId', '==', ownerId)
          .get();

        if (!snapshot.empty) {
          return snapshot.docs.map((d) => d.data() as KnowledgeDocument);
        }
      } catch (err) {
        console.error('Erro ao buscar documentos no Firestore:', err);
      }
    }

    return this.inMemoryDocs.filter((d) => d.ownerId === ownerId || d.permissions.includes('public'));
  }
}

