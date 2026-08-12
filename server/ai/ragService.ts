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
const WRITE_BATCH_SIZE = 350;
const MAX_RETRIEVAL_CANDIDATES = 1_000;
const FIRESTORE_IN_LIMIT = 10;
const EMBEDDING_CONCURRENCY = 5;

function sha256(value: string): string {
  return createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

function timestampToIso(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date })
      .toDate()
      .toISOString();
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    value instanceof Date
  ) {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function splitIntoChunks(text: string): string[] {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const chunks: string[] = [];
  const step = CHUNK_SIZE_WORDS - CHUNK_OVERLAP_WORDS;

  for (let offset = 0; offset < words.length; offset += step) {
    const chunk = words
      .slice(offset, offset + CHUNK_SIZE_WORDS)
      .join(' ')
      .trim();

    if (!chunk) {
      continue;
    }

    if (chunks.length >= MAX_DOCUMENT_CHUNKS) {
      throw new Error(
        `O documento excede o limite de ${MAX_DOCUMENT_CHUNKS} partes para indexação.`
      );
    }

    chunks.push(chunk);
  }

  return chunks;
}

function divideIntoGroups<T>(
  values: T[],
  groupSize: number
): T[][] {
  const groups: T[][] = [];

  for (
    let offset = 0;
    offset < values.length;
    offset += groupSize
  ) {
    groups.push(values.slice(offset, offset + groupSize));
  }

  return groups;
}

export class RAGService {
  /**
   * Busca partes pertencentes ao próprio usuário e, quando informado,
   * restringe a consulta diretamente às bases selecionadas.
   *
   * A quantidade de candidatos é limitada para impedir a leitura completa
   * da coleção em cada pergunta.
   */
  static async retrieveRelevantChunks(
    userId: string,
    query: string,
    knowledgeBaseIds?: string[],
    topK = DEFAULT_TOP_K,
    minSimilarityThreshold = 0.2
  ): Promise<
    Array<{ chunk: KnowledgeChunk; similarity: number }>
  > {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      return [];
    }

    const safeTopK = Math.min(
      Math.max(Math.trunc(topK), 1),
      MAX_TOP_K
    );

    const selectedBaseIds = [
      ...new Set(
        (knowledgeBaseIds || [])
          .filter(
            (id): id is string =>
              typeof id === 'string' &&
              id.trim().length > 0
          )
          .map((id) => id.trim())
      )
    ];

    try {
      const queryEmbedding =
        await EmbeddingService.generateEmbedding(
          normalizedQuery
        );

      const documentsById = new Map<
        string,
        FirebaseFirestore.QueryDocumentSnapshot
      >();

      if (selectedBaseIds.length > 0) {
        const baseGroups = divideIntoGroups(
          selectedBaseIds,
          FIRESTORE_IN_LIMIT
        );

        const limitPerGroup = Math.max(
          safeTopK,
          Math.floor(
            MAX_RETRIEVAL_CANDIDATES /
              baseGroups.length
          )
        );

        const snapshots = await Promise.all(
          baseGroups.map((baseGroup) =>
            adminDb
              .collection('knowledge_chunks')
              .where('userId', '==', userId)
              .where(
                'knowledgeBaseId',
                'in',
                baseGroup
              )
              .limit(limitPerGroup)
              .get()
          )
        );

        for (const snapshot of snapshots) {
          for (const document of snapshot.docs) {
            if (
              documentsById.size >=
              MAX_RETRIEVAL_CANDIDATES
            ) {
              break;
            }

            documentsById.set(
              document.id,
              document
            );
          }
        }
      } else {
        const snapshot = await adminDb
          .collection('knowledge_chunks')
          .where('userId', '==', userId)
          .limit(MAX_RETRIEVAL_CANDIDATES)
          .get();

        for (const document of snapshot.docs) {
          documentsById.set(
            document.id,
            document
          );
        }
      }

      const results: Array<{
        chunk: KnowledgeChunk;
        similarity: number;
      }> = [];

      const queryWords = [
        ...new Set(
          normalizedQuery
            .toLowerCase()
            .split(/\s+/)
            .filter((word) => word.length > 2)
        )
      ];

      for (const document of documentsById.values()) {
        const data = document.data();

        const embedding = Array.isArray(data.embedding)
          ? data.embedding
              .map(Number)
              .filter(Number.isFinite)
          : [];

        let similarity = 0;

        if (
          embedding.length > 0 &&
          embedding.length === queryEmbedding.length
        ) {
          similarity =
            EmbeddingService.cosineSimilarity(
              queryEmbedding,
              embedding
            );
        } else {
          const normalizedText = String(
            data.text || ''
          ).toLowerCase();

          const matches = queryWords.filter(
            (word) => normalizedText.includes(word)
          ).length;

          similarity =
            queryWords.length > 0
              ? matches / queryWords.length
              : 0;
        }

        if (similarity < minSimilarityThreshold) {
          continue;
        }

        results.push({
          chunk: {
            id: document.id,
            documentId: String(
              data.documentId || ''
            ),
            knowledgeBaseId: String(
              data.knowledgeBaseId || ''
            ),
            userId: String(data.userId || ''),
            text: String(data.text || ''),
            page: data.page,
            section: data.section,
            chunkIndex: Number(
              data.chunkIndex || 0
            ),
            contentHash: String(
              data.contentHash || ''
            ),
            embeddingModel: String(
              data.embeddingModel ||
                env.GEMINI_EMBEDDING_MODEL ||
                'gemini-embedding-2'
            ),
            embeddingVersion: String(
              data.embeddingVersion || 'v1'
            ),
            createdAt: timestampToIso(
              data.createdAt
            )
          },
          similarity
        });
      }

      results.sort(
        (first, second) =>
          second.similarity - first.similarity
      );

      return results.slice(0, safeTopK);
    } catch (error) {
      console.error('Falha na busca RAG:', error);

      throw new Error(
        'Não foi possível consultar a base de conhecimento.'
      );
    }
  }

  /**
   * Indexa texto em partes determinísticas.
   *
   * Os embeddings são gerados com concorrência controlada e as gravações
   * são realizadas em lotes para reduzir latência e operações isoladas.
   */
  static async indexDocument(
    userId: string,
    knowledgeBaseId: string,
    documentId: string,
    filename: string,
    text: string
  ): Promise<number> {
    const normalizedText = text.trim();

    if (!normalizedText) {
      return 0;
    }

    const chunks = splitIntoChunks(normalizedText);

    if (chunks.length === 0) {
      return 0;
    }

    const preparedChunks: Array<{
      id: string;
      data: Record<string, unknown>;
    }> = [];

    for (
      let offset = 0;
      offset < chunks.length;
      offset += EMBEDDING_CONCURRENCY
    ) {
      const chunkPage = chunks.slice(
        offset,
        offset + EMBEDDING_CONCURRENCY
      );

      const embeddings = await Promise.all(
        chunkPage.map((chunkText) =>
          EmbeddingService.generateEmbedding(
            chunkText
          )
        )
      );

      for (
        let pageIndex = 0;
        pageIndex < chunkPage.length;
        pageIndex += 1
      ) {
        const chunkIndex = offset + pageIndex;
        const chunkText = chunkPage[pageIndex];
        const embedding = embeddings[pageIndex];

        preparedChunks.push({
          id: sha256(
            `${userId}:${knowledgeBaseId}:${documentId}:${chunkIndex}`
          ),
          data: {
            documentId,
            knowledgeBaseId,
            userId,
            filename,
            text: chunkText,
            chunkIndex,
            contentHash: sha256(chunkText),
            embeddingModel:
              env.GEMINI_EMBEDDING_MODEL ||
              'gemini-embedding-2',
            embeddingVersion: 'v2',
            embedding,
            createdAt:
              FieldValue.serverTimestamp(),
            updatedAt:
              FieldValue.serverTimestamp()
          }
        });
      }
    }

    for (
      let offset = 0;
      offset < preparedChunks.length;
      offset += WRITE_BATCH_SIZE
    ) {
      const writeBatch = adminDb.batch();
      const page = preparedChunks.slice(
        offset,
        offset + WRITE_BATCH_SIZE
      );

      for (const preparedChunk of page) {
        const reference = adminDb
          .collection('knowledge_chunks')
          .doc(preparedChunk.id);

        writeBatch.set(
          reference,
          preparedChunk.data
        );
      }

      await writeBatch.commit();
    }

    return preparedChunks.length;
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

      if (snapshot.empty) {
        break;
      }

      const batch = adminDb.batch();

      snapshot.docs.forEach((document) =>
        batch.delete(document.ref)
      );

      await batch.commit();
      deleted += snapshot.size;

      if (snapshot.size < DELETE_BATCH_SIZE) {
        break;
      }
    }

    return deleted;
  }
}