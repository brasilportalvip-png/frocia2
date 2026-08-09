import { MessageCitation, KnowledgeChunk } from './types/ai.js';

export class CitationService {
  static buildRAGCitationPill(chunk: KnowledgeChunk, filename?: string): MessageCitation {
    return {
      title: filename || `Documento RAG #${chunk.documentId.substring(0, 6)}`,
      uri: `#knowledge-chunk-${chunk.id}`,
      snippet: chunk.text.substring(0, 150) + '...',
      sourceType: 'knowledge_base',
      docId: chunk.documentId,
    };
  }

  static extractSearchGroundingCitations(groundingMetadata: any): MessageCitation[] {
    if (!groundingMetadata || !groundingMetadata.groundingChunks) return [];

    const citations: MessageCitation[] = [];
    for (const chunk of groundingMetadata.groundingChunks) {
      if (chunk.web?.uri) {
        citations.push({
          title: chunk.web.title || chunk.web.uri,
          uri: chunk.web.uri,
          snippet: chunk.web.snippet || '',
          sourceType: 'web',
        });
      }
    }
    return citations;
  }
}
