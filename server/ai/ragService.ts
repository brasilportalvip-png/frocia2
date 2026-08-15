import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';
import { env } from '../config/env.js';
import { EmbeddingService } from './embeddingService.js';
import { KnowledgeChunk } from './types/ai.js';

const DEFAULT_TOP_K = 3;
const MAX_TOP_K = 10;
const CHUNK_SIZE_WORDS = 500;
const CHUNK_OVERLAP_WORDS = 50;
const MAX_DOCUMENT_CHUNKS = 200;
const DELETE_BATCH_SIZE = 400;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function timestampToIso(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return new Date().toISOString();
}

function splitIntoChunks(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  const step = CHUNK_SIZE_WORDS - CHUNK_OVERLAP_WORDS;

  for (let offset = 0; offset < words.length; offset += step) {
    const chunk = words.slice(offset, offset + CHUNK_SIZE_WORDS).join(' ').trim();
    if (chunk) chunks.push(chunk);

    if (chunks.length > MAX_DOCUMENT_CHUNKS) {
      throw new Error(
        `O documento excede o limite de ${MAX_DOCUMENT_CHUNKS} partes para indexação.`
      );
    }
  }

  return chunks;
}

export class RAGService {
  /**
   * Busca partes pertencentes ao próprio usuário e, quando informado,
   * restringe o resultado às bases selecionadas.
   */
  static async retrieveRelevantChunks(
    userId: string,
    query: string,
    knowledgeBaseIds?: string[],
    topK = DEFAULT_TOP_K,
    minSimilarityThreshold = 0.2
  ): Promise<Array<{ chunk: KnowledgeChunk; similarity: number }>> {
    if (!query.trim()) return [];

    const safeTopK = Math.min(Math.max(Math.trunc(topK), 1), MAX_TOP_K);
    const selectedBases = new Set(
      (knowledgeBaseIds || []).filter((id) => typeof id === 'string' && id.length > 0)
    );

    try {
      const queryEmbedding = await EmbeddingService.generateEmbedding(query);
      const snapshot = await adminDb
        .collection('knowledge_chunks')
        .where('userId', '==', userId)
        .get();

      const results: Array<{ chunk: KnowledgeChunk; similarity: number }> = [];

      for (const document of snapshot.docs) {
        const data = document.data();

        if (
          selectedBases.size > 0 &&
          !selectedBases.has(String(data.knowledgeBaseId || ''))
        ) {
          continue;
        }

        const embedding = Array.isArray(data.embedding)
          ? data.embedding.map(Number).filter(Number.isFinite)
          : [];
        let similarity = 0;

        if (embedding.length > 0 && embedding.length === queryEmbedding.length) {
          similarity = EmbeddingService.cosineSimilarity(queryEmbedding, embedding);
        } else {
          const normalizedText = String(data.text || '').toLowerCase();
          const words = query
            .toLowerCase()
            .split(/\s+/)
            .filter((word) => word.length > 2);
          const uniqueWords = [...new Set(words)];
          const matches = uniqueWords.filter((word) => normalizedText.includes(word)).length;
          similarity = uniqueWords.length > 0 ? matches / uniqueWords.length : 0;
        }

        if (similarity < minSimilarityThreshold) continue;

        results.push({
          chunk: {
            id: document.id,
            documentId: String(data.documentId || ''),
            knowledgeBaseId: String(data.knowledgeBaseId || ''),
            userId: String(data.userId || ''),
            text: String(data.text || ''),
            page: data.page,
            section: data.section,
            chunkIndex: Number(data.chunkIndex || 0),
            contentHash: String(data.contentHash || ''),
            embeddingModel: String(
              data.embeddingModel || env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2'
            ),
            embeddingVersion: String(data.embeddingVersion || 'v1'),
            createdAt: timestampToIso(data.createdAt)
          },
          similarity
        });
      }

      results.sort((first, second) => second.similarity - first.similarity);
      return results.slice(0, safeTopK);
    } catch (error) {
      console.error('Falha na busca RAG:', error);
      throw new Error('Não foi possível consultar a base de conhecimento.');
    }
  }

  /**
   * Indexa texto em partes determinísticas. Uma repetição segura sobrescreve
   * as mesmas partes em vez de criar duplicatas.
   */
  static async indexDocument(
    userId: string,
    knowledgeBaseId: string,
    documentId: string,
    filename: string,
    text: string
  ): Promise<number> {
    const normalizedText = text.trim();
    if (!normalizedText) return 0;

    const chunks = splitIntoChunks(normalizedText);
    if (chunks.length === 0) return 0;

    for (let index = 0; index < chunks.length; index += 1) {
      const chunkText = chunks[index];
      const contentHash = sha256(chunkText);
      const chunkId = sha256(`${userId}:${knowledgeBaseId}:${documentId}:${index}`);
      const embedding = await EmbeddingService.generateEmbedding(chunkText);

      await adminDb.collection('knowledge_chunks').doc(chunkId).set({
        documentId,
        knowledgeBaseId,
        userId,
        filename,
        text: chunkText,
        chunkIndex: index,
        contentHash,
        embeddingModel: env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
        embeddingVersion: 'v2',
        embedding,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    return chunks.length;
  }

  static async deleteDocumentChunks(
    userId: string,
    documentId: string
  ): Promise<number> {
    let deleted = 0;

    while (true) {
      const snapshot = await adminDb
        .collection('knowledge_chunks')
        .where('userId', '==', userId)
        .where('documentId', '==', documentId)
        .limit(DELETE_BATCH_SIZE)
        .get();

      if (snapshot.empty) break;

      const batch = adminDb.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
      deleted += snapshot.size;

      if (snapshot.size < DELETE_BATCH_SIZE) break;
    }

    return deleted;
  }
}