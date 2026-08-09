import crypto from 'crypto';
import { KnowledgeDocument } from './selfEvolutionTypes.js';
import { RedactionService } from './redactionService.js';
import { PromptInjectionDefense } from './promptInjectionDefense.js';

export class KnowledgeIngestionService {
  private static documents: KnowledgeDocument[] = [];

  static ingestDocument(params: {
    ownerId: string;
    title: string;
    url?: string;
    content: string;
    author: string;
    permissions?: string[];
  }): KnowledgeDocument {
    const rawRedacted = RedactionService.redactSensitiveData(params.content);
    const sanitized = PromptInjectionDefense.sanitizeUntrustedText(rawRedacted);
    const contentHash = crypto.createHash('sha256').update(sanitized).digest('hex');

    const doc: KnowledgeDocument = {
      id: `know-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      ownerId: params.ownerId,
      title: params.title,
      url: params.url,
      contentHash,
      version: 1,
      author: params.author,
      confidence: 0.95,
      approved: true,
      permissions: params.permissions || ['public'],
      embeddingModel: 'text-embedding-004',
      embeddingDimension: 768,
      indexingState: 'indexed',
      updatedAt: new Date().toISOString(),
    };

    this.documents.unshift(doc);
    return doc;
  }

  static getDocuments(ownerId: string): KnowledgeDocument[] {
    return this.documents.filter((d) => d.ownerId === ownerId || d.permissions.includes('public'));
  }
}
