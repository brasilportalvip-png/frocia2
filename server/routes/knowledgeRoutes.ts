import { createHash } from 'node:crypto';
import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { RAGService } from '../ai/ragService.js';
import { normalizePublicHttpsUrl } from '../ai/citationService.js';
import { adminDb, isFirebaseAdminConfigured } from '../lib/firebaseAdmin.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { AuthenticatedRequest } from '../types.js';

export const knowledgeRouter = Router();

const MAX_BASES_PER_USER = 25;
const MAX_DOCUMENTS_PER_BASE = 100;
const MAX_DOCUMENT_BYTES = 750_000;
const DELETE_BATCH_SIZE = 400;

const knowledgeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'knowledge'
});

const CreateKnowledgeBaseSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).default('')
  })
  .strict();

const DocumentMetadataSchema = {
  version: z.string().trim().min(1).max(40).optional(),
  sourceUrl: z
    .string()
    .trim()
    .max(2_000)
    .refine(
      (value) => normalizePublicHttpsUrl(value) !== null,
      'A URL de origem deve ser HTTPS pública.'
    )
    .optional(),
  effectiveAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional()
};

const AddKnowledgeDocumentSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine(
        (name) =>
          !name.includes('..') &&
          !/[\\/:*?"<>|\0]/.test(name),
        'O nome do arquivo é inválido.'
      ),
    contentText: z.string().min(1).max(MAX_DOCUMENT_BYTES),
    mimeType: z
      .enum([
        'text/plain',
        'text/markdown',
        'text/csv',
        'text/html',
        'text/css',
        'text/javascript',
        'text/typescript',
        'text/typescript-jsx',
        'text/yaml',
        'text/x-sql',
        'text/x-python',
        'application/json',
        'application/xml'
      ])
      .default('text/plain'),
    ...DocumentMetadataSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.effectiveAt &&
      value.expiresAt &&
      new Date(value.expiresAt) <= new Date(value.effectiveAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message:
          'A expiração deve ser posterior ao início de vigência.'
      });
    }
  });

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

function configurationError(req: AuthenticatedRequest, res: any) {
  return res.status(503).json({
    error: {
      code: 'knowledge_storage_unavailable',
      message: 'O armazenamento da Base de Conhecimento não está configurado.',
      correlationId: req.correlationId
    }
  });
}

async function getOwnedBase(userId: string, knowledgeBaseId: string) {
  const reference = adminDb.collection('knowledge_bases').doc(knowledgeBaseId);
  const snapshot = await reference.get();

  if (!snapshot.exists || snapshot.data()?.userId !== userId) return null;
  return { reference, snapshot, data: snapshot.data() || {} };
}

knowledgeRouter.get(
  '/knowledge-bases',
  requireAuth,
  knowledgeLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) return configurationError(req, res);

    try {
      const snapshot = await adminDb
        .collection('knowledge_bases')
        .where('userId', '==', req.user!.uid)
        .limit(MAX_BASES_PER_USER)
        .get();

      const knowledgeBases = snapshot.docs
        .map((document) => {
          const data = document.data();
          return {
            id: document.id,
            name: String(data.name || 'Base sem nome'),
            description: String(data.description || ''),
            owner: req.user!.email || req.user!.uid,
            status: String(data.status || 'active'),
            documentCount: Number(data.documentCount || 0),
            chunksCount: Number(data.chunksCount || 0),
            lastIndexedAt: data.lastIndexedAt
              ? timestampToIso(data.lastIndexedAt)
              : null,
            createdAt: timestampToIso(data.createdAt),
            updatedAt: timestampToIso(data.updatedAt)
          };
        })
        .sort(
          (first, second) =>
            new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()
        );

      return res.json({ knowledgeBases });
    } catch (error) {
      console.error('Falha ao listar bases de conhecimento:', error);
      return res.status(500).json({
        error: {
          code: 'kb_fetch_failed',
          message: 'Erro ao buscar bases de conhecimento.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

knowledgeRouter.post(
  '/knowledge-bases',
  requireAuth,
  knowledgeLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) return configurationError(req, res);

    const parsed = CreateKnowledgeBaseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'invalid_knowledge_base',
          message: parsed.error.issues[0]?.message || 'Dados da base inválidos.',
          correlationId: req.correlationId
        }
      });
    }

    try {
      const uid = req.user!.uid;
      const existing = await adminDb
        .collection('knowledge_bases')
        .where('userId', '==', uid)
        .limit(MAX_BASES_PER_USER)
        .get();

      if (existing.size >= MAX_BASES_PER_USER) {
        return res.status(409).json({
          error: {
            code: 'knowledge_base_limit_reached',
            message: `O limite de ${MAX_BASES_PER_USER} bases por usuário foi atingido.`,
            correlationId: req.correlationId
          }
        });
      }

      const reference = adminDb.collection('knowledge_bases').doc();
      await reference.set({
        userId: uid,
        name: parsed.data.name,
        description: parsed.data.description,
        collaborators: [],
        status: 'active',
        documentCount: 0,
        chunksCount: 0,
        version: 'v1.0.0',
        lastIndexedAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });

      return res.status(201).json({
        knowledgeBase: {
          id: reference.id,
          name: parsed.data.name,
          description: parsed.data.description,
          owner: req.user!.email || uid,
          status: 'active',
          documentCount: 0,
          chunksCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Falha ao criar base de conhecimento:', error);
      return res.status(500).json({
        error: {
          code: 'kb_create_failed',
          message: 'Erro ao criar base de conhecimento.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

knowledgeRouter.get(
  '/knowledge-bases/:id',
  requireAuth,
  knowledgeLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) return configurationError(req, res);

    try {
      const ownedBase = await getOwnedBase(req.user!.uid, req.params.id);
      if (!ownedBase) {
        return res.status(404).json({
          error: {
            code: 'kb_not_found',
            message: 'Base de conhecimento não encontrada.',
            correlationId: req.correlationId
          }
        });
      }

      const documentsSnapshot = await adminDb
        .collection('knowledge_documents')
        .where('knowledgeBaseId', '==', req.params.id)
        .where('userId', '==', req.user!.uid)
        .limit(MAX_DOCUMENTS_PER_BASE)
        .get();

      const documents = documentsSnapshot.docs
        .map((document) => {
          const data = document.data();
          return {
            id: document.id,
            filename: String(data.filename || ''),
            mimeType: String(data.mimeType || 'text/plain'),
            sizeBytes: Number(data.sizeBytes || 0),
            status: String(data.status || 'unknown'),
            chunkCount: Number(data.chunkCount || 0),
            contentHash: String(data.contentHash || ''),
            version: String(data.version || 'v1'),
            revisionNumber: Number(data.revisionNumber || 1),
            sourceUrl: data.sourceUrl ? String(data.sourceUrl) : null,
            effectiveAt: data.effectiveAt
              ? timestampToIso(data.effectiveAt)
              : null,
            expiresAt: data.expiresAt
              ? timestampToIso(data.expiresAt)
              : null,
            createdAt: timestampToIso(data.createdAt),
            updatedAt: timestampToIso(data.updatedAt)
          };
        })
        .sort(
          (first, second) =>
            new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
        );

      const data = ownedBase.data;
      return res.json({
        knowledgeBase: {
          id: ownedBase.snapshot.id,
          name: String(data.name || 'Base sem nome'),
          description: String(data.description || ''),
          owner: req.user!.email || req.user!.uid,
          status: String(data.status || 'active'),
          documentCount: Number(data.documentCount || 0),
          chunksCount: Number(data.chunksCount || 0),
          createdAt: timestampToIso(data.createdAt),
          updatedAt: timestampToIso(data.updatedAt)
        },
        documents
      });
    } catch (error) {
      console.error('Falha ao consultar base de conhecimento:', error);
      return res.status(500).json({
        error: {
          code: 'kb_get_failed',
          message: 'Erro ao consultar base de conhecimento.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

knowledgeRouter.post(
  '/knowledge-bases/:id/documents',
  requireAuth,
  knowledgeLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) return configurationError(req, res);

    const parsed = AddKnowledgeDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'invalid_knowledge_document',
          message: parsed.error.issues[0]?.message || 'Documento inválido.',
          correlationId: req.correlationId
        }
      });
    }

    const sizeBytes = Buffer.byteLength(parsed.data.contentText, 'utf8');
    if (sizeBytes > MAX_DOCUMENT_BYTES) {
      return res.status(413).json({
        error: {
          code: 'knowledge_document_too_large',
          message: 'O documento excede o limite de 750 KB.',
          correlationId: req.correlationId
        }
      });
    }

    const uid = req.user!.uid;
    const knowledgeBaseId = req.params.id;

    try {
      const ownedBase = await getOwnedBase(uid, knowledgeBaseId);
      if (!ownedBase || ownedBase.data.status !== 'active') {
        return res.status(404).json({
          error: {
            code: 'kb_not_found',
            message: 'Base de conhecimento ativa não encontrada.',
            correlationId: req.correlationId
          }
        });
      }

      if (Number(ownedBase.data.documentCount || 0) >= MAX_DOCUMENTS_PER_BASE) {
        return res.status(409).json({
          error: {
            code: 'knowledge_document_limit_reached',
            message: `A base atingiu o limite de ${MAX_DOCUMENTS_PER_BASE} documentos.`,
            correlationId: req.correlationId
          }
        });
      }

      const contentHash = sha256(parsed.data.contentText);
      const revisionId = contentHash.slice(0, 24);
      const duplicateSnapshot = await adminDb
        .collection('knowledge_documents')
        .where('knowledgeBaseId', '==', knowledgeBaseId)
        .where('userId', '==', uid)
        .limit(MAX_DOCUMENTS_PER_BASE)
        .get();
      const duplicateDocument = duplicateSnapshot.docs.find(
        (document) =>
          String(document.data().contentHash || '') === contentHash &&
          document.data().status === 'indexed'
      );

      if (duplicateDocument) {
        const data = duplicateDocument.data();
        return res.status(200).json({
          document: {
            id: duplicateDocument.id,
            filename: String(data.filename || parsed.data.filename),
            mimeType: String(data.mimeType || parsed.data.mimeType),
            sizeBytes: Number(data.sizeBytes || sizeBytes),
            status: 'indexed',
            chunkCount: Number(data.chunkCount || 0),
            contentHash,
            version: String(data.version || 'v1')
          },
          duplicate: true
        });
      }

      const documentId = sha256(`${uid}:${knowledgeBaseId}:${contentHash}`).slice(0, 40);
      const documentReference = adminDb
        .collection('knowledge_documents')
        .doc(documentId);
      const existingDocument = await documentReference.get();

      if (existingDocument.exists) {
        const data = existingDocument.data() || {};
        return res.status(200).json({
          document: {
            id: existingDocument.id,
            filename: String(data.filename || parsed.data.filename),
            mimeType: String(data.mimeType || parsed.data.mimeType),
            sizeBytes: Number(data.sizeBytes || sizeBytes),
            status: String(data.status || 'indexed'),
            chunkCount: Number(data.chunkCount || 0),
            contentHash
          },
          duplicate: true
        });
      }

      await documentReference.set({
        knowledgeBaseId,
        userId: uid,
        filename: parsed.data.filename,
        mimeType: parsed.data.mimeType,
        sizeBytes,
        contentHash,
        activeRevisionId: revisionId,
        revisionNumber: 1,
        version: parsed.data.version || 'v1',
        sourceUrl: parsed.data.sourceUrl || null,
        effectiveAt: parsed.data.effectiveAt || null,
        expiresAt: parsed.data.expiresAt || null,
        status: 'processing',
        chunkCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });

      try {
        const chunkCount = await RAGService.indexDocument(
          uid,
          knowledgeBaseId,
          documentId,
          parsed.data.filename,
          parsed.data.contentText,
          {
            revisionId,
            version: parsed.data.version || 'v1',
            sourceUrl: parsed.data.sourceUrl,
            effectiveAt: parsed.data.effectiveAt,
            expiresAt: parsed.data.expiresAt
          }
        );

        if (chunkCount === 0) {
          throw new Error('O documento não produziu partes indexáveis.');
        }

        await adminDb.runTransaction(async (transaction) => {
          transaction.update(documentReference, {
            status: 'indexed',
            chunkCount,
            updatedAt: FieldValue.serverTimestamp()
          });
          transaction.update(ownedBase.reference, {
            documentCount: FieldValue.increment(1),
            chunksCount: FieldValue.increment(chunkCount),
            lastIndexedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
          });
        });

        return res.status(201).json({
          document: {
            id: documentId,
            filename: parsed.data.filename,
            mimeType: parsed.data.mimeType,
            sizeBytes,
            status: 'indexed',
            chunkCount,
            contentHash,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          duplicate: false
        });
      } catch (indexError) {
        await RAGService.deleteDocumentChunks(uid, documentId).catch(() => undefined);
        await documentReference.delete().catch(() => undefined);
        throw indexError;
      }
    } catch (error) {
      console.error('Falha ao indexar documento:', error);
      return res.status(500).json({
        error: {
          code: 'document_index_failed',
          message: 'Erro ao indexar documento na base de conhecimento.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

knowledgeRouter.post(
  '/knowledge-bases/:id/documents/:documentId/reindex',
  requireAuth,
  knowledgeLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) return configurationError(req, res);

    const parsed = AddKnowledgeDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'invalid_knowledge_document',
          message:
            parsed.error.issues[0]?.message ||
            'Documento inválido.',
          correlationId: req.correlationId
        }
      });
    }

    const sizeBytes = Buffer.byteLength(
      parsed.data.contentText,
      'utf8'
    );
    if (sizeBytes > MAX_DOCUMENT_BYTES) {
      return res.status(413).json({
        error: {
          code: 'knowledge_document_too_large',
          message: 'O documento excede o limite de 750 KB.',
          correlationId: req.correlationId
        }
      });
    }

    const uid = req.user!.uid;
    const knowledgeBaseId = req.params.id;
    const documentId = req.params.documentId;
    const documentReference = adminDb
      .collection('knowledge_documents')
      .doc(documentId);
    let stagedRevisionId: string | null = null;

    try {
      const ownedBase = await getOwnedBase(uid, knowledgeBaseId);
      const documentSnapshot = await documentReference.get();
      const documentData = documentSnapshot.data() || {};

      if (
        !ownedBase ||
        ownedBase.data.status !== 'active' ||
        !documentSnapshot.exists ||
        documentData.userId !== uid ||
        documentData.knowledgeBaseId !== knowledgeBaseId ||
        documentData.status !== 'indexed'
      ) {
        return res.status(404).json({
          error: {
            code: 'knowledge_document_not_found',
            message: 'Documento indexado não encontrado.',
            correlationId: req.correlationId
          }
        });
      }

      const contentHash = sha256(parsed.data.contentText);
      if (contentHash === String(documentData.contentHash || '')) {
        return res.status(200).json({
          document: {
            id: documentSnapshot.id,
            filename: String(documentData.filename || parsed.data.filename),
            status: 'indexed',
            chunkCount: Number(documentData.chunkCount || 0),
            contentHash,
            version: String(documentData.version || 'v1')
          },
          duplicate: true
        });
      }

      stagedRevisionId = contentHash.slice(0, 24);
      const revisionNumber =
        Math.max(Number(documentData.revisionNumber || 1), 1) + 1;
      const version =
        parsed.data.version || `v${revisionNumber}`;
      const previousChunkCount = Number(
        documentData.chunkCount || 0
      );
      const chunkCount = await RAGService.indexDocument(
        uid,
        knowledgeBaseId,
        documentId,
        parsed.data.filename,
        parsed.data.contentText,
        {
          revisionId: stagedRevisionId,
          version,
          sourceUrl: parsed.data.sourceUrl,
          effectiveAt: parsed.data.effectiveAt,
          expiresAt: parsed.data.expiresAt
        }
      );

      if (chunkCount === 0) {
        throw new Error('O documento não produziu partes indexáveis.');
      }

      await adminDb.runTransaction(async (transaction) => {
        transaction.update(documentReference, {
          filename: parsed.data.filename,
          mimeType: parsed.data.mimeType,
          sizeBytes,
          contentHash,
          activeRevisionId: stagedRevisionId,
          revisionNumber,
          version,
          sourceUrl: parsed.data.sourceUrl || null,
          effectiveAt: parsed.data.effectiveAt || null,
          expiresAt: parsed.data.expiresAt || null,
          chunkCount,
          reindexedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        transaction.update(ownedBase.reference, {
          chunksCount: FieldValue.increment(
            chunkCount - previousChunkCount
          ),
          lastIndexedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
      });

      await RAGService.deleteObsoleteDocumentChunks(
        uid,
        documentId,
        stagedRevisionId
      ).catch((cleanupError) => {
        console.warn(
          'A nova revisão foi ativada, mas partes antigas aguardam limpeza:',
          cleanupError
        );
      });

      return res.json({
        document: {
          id: documentId,
          filename: parsed.data.filename,
          mimeType: parsed.data.mimeType,
          sizeBytes,
          status: 'indexed',
          chunkCount,
          contentHash,
          version,
          revisionNumber,
          updatedAt: new Date().toISOString()
        },
        duplicate: false
      });
    } catch (error) {
      if (stagedRevisionId) {
        await RAGService.deleteDocumentRevisionChunks(
          uid,
          documentId,
          stagedRevisionId
        ).catch(() => undefined);
      }

      console.error('Falha ao reindexar documento:', error);
      return res.status(500).json({
        error: {
          code: 'document_reindex_failed',
          message: 'Erro ao reindexar documento na base de conhecimento.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

knowledgeRouter.delete(
  '/knowledge-bases/:id/documents/:documentId',
  requireAuth,
  knowledgeLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) return configurationError(req, res);

    const uid = req.user!.uid;
    const { id: knowledgeBaseId, documentId } = req.params;

    try {
      const ownedBase = await getOwnedBase(uid, knowledgeBaseId);
      const documentReference = adminDb
        .collection('knowledge_documents')
        .doc(documentId);
      const documentSnapshot = await documentReference.get();
      const documentData = documentSnapshot.data();

      if (
        !ownedBase ||
        !documentSnapshot.exists ||
        documentData?.userId !== uid ||
        documentData?.knowledgeBaseId !== knowledgeBaseId
      ) {
        return res.status(404).json({
          error: {
            code: 'knowledge_document_not_found',
            message: 'Documento não encontrado.',
            correlationId: req.correlationId
          }
        });
      }

      const deletedChunks = await RAGService.deleteDocumentChunks(uid, documentId);
      await adminDb.runTransaction(async (transaction) => {
        transaction.delete(documentReference);
        transaction.update(ownedBase.reference, {
          documentCount: FieldValue.increment(-1),
          chunksCount: FieldValue.increment(-deletedChunks),
          updatedAt: FieldValue.serverTimestamp()
        });
      });

      return res.json({ success: true, deletedChunks });
    } catch (error) {
      console.error('Falha ao excluir documento da base:', error);
      return res.status(500).json({
        error: {
          code: 'knowledge_document_delete_failed',
          message: 'Erro ao excluir documento da base de conhecimento.',
          correlationId: req.correlationId
        }
      });
    }
  }
);

knowledgeRouter.delete(
  '/knowledge-bases/:id',
  requireAuth,
  knowledgeLimiter,
  async (req: AuthenticatedRequest, res) => {
    if (!isFirebaseAdminConfigured()) return configurationError(req, res);

    const uid = req.user!.uid;
    const knowledgeBaseId = req.params.id;

    try {
      const ownedBase = await getOwnedBase(uid, knowledgeBaseId);
      if (!ownedBase) {
        return res.status(404).json({
          error: {
            code: 'kb_not_found',
            message: 'Base de conhecimento não encontrada.',
            correlationId: req.correlationId
          }
        });
      }

      await ownedBase.reference.update({
        status: 'deleting',
        updatedAt: FieldValue.serverTimestamp()
      });

      while (true) {
        const documentsSnapshot = await adminDb
          .collection('knowledge_documents')
          .where('knowledgeBaseId', '==', knowledgeBaseId)
          .where('userId', '==', uid)
          .limit(DELETE_BATCH_SIZE)
          .get();

        if (documentsSnapshot.empty) break;

        for (const document of documentsSnapshot.docs) {
          await RAGService.deleteDocumentChunks(uid, document.id);
        }

        const batch = adminDb.batch();
        documentsSnapshot.docs.forEach((document) => batch.delete(document.ref));
        await batch.commit();

        if (documentsSnapshot.size < DELETE_BATCH_SIZE) break;
      }

      await ownedBase.reference.delete();
      return res.json({ success: true });
    } catch (error) {
      console.error('Falha ao excluir base de conhecimento:', error);
      return res.status(500).json({
        error: {
          code: 'kb_delete_failed',
          message: 'Erro ao excluir base de conhecimento.',
          correlationId: req.correlationId
        }
      });
    }
  }
);
