import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { MemoryScopeAccessError, MemoryService } from '../ai/memoryService.js';

export const conversationRouter = Router();

function belongsToAuthenticatedContext(
  data: Record<string, any> | undefined,
  req: AuthenticatedRequest
): boolean {
  if (!data || !req.user) return false;
  return (
    data.userId === req.user.uid &&
    (data.tenantId || `user:${data.userId}`) === req.user.tenantId
  );
}

function checkDatabaseAvailability(req: AuthenticatedRequest, res: any): boolean {
  if (!adminDb) {
    res.status(503).json({
      error: {
        code: 'database_unavailable',
        message: 'Banco de dados temporariamente indisponível.',
        correlationId: req.correlationId,
      },
    });
    return false;
  }
  return true;
}

// GET /api/conversations
conversationRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!checkDatabaseAvailability(req, res)) return;
    const uid = req.user!.uid;

    const snap = await adminDb!
      .collection('conversations')
      .where('userId', '==', uid)
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    const conversations = snap.docs
      .filter((doc) => belongsToAuthenticatedContext(doc.data(), req))
      .map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        userId: d.userId,
        tenantId: d.tenantId || `user:${d.userId}`,
        projectId: d.projectId || null,
        title: d.title || 'Nova Conversa',
        mode: d.mode || 'smart',
        summary: d.summary || '',
        createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : new Date(d.createdAt).toISOString()) : new Date().toISOString(),
        updatedAt: d.updatedAt ? (d.updatedAt.toDate ? d.updatedAt.toDate().toISOString() : new Date(d.updatedAt).toISOString()) : new Date().toISOString(),
      };
      });

    return res.json({ conversations });
  } catch (err: any) {
    return res.status(500).json({
      error: {
        code: 'conversations_fetch_failed',
        message: 'Erro ao buscar histórico de conversas.',
        correlationId: req.correlationId,
      },
    });
  }
});

// POST /api/conversations
conversationRouter.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!checkDatabaseAvailability(req, res)) return;
    const uid = req.user!.uid;
    const { title = 'Nova Conversa', mode = 'smart', projectId = null } = req.body;

    if (projectId) {
      await MemoryService.assertScopeAccess(
        uid,
        req.user!.tenantId,
        'project',
        projectId
      );
    }

    const ref = adminDb!.collection('conversations').doc();
    const now = FieldValue.serverTimestamp();

    await ref.set({
      userId: uid,
      tenantId: req.user!.tenantId,
      projectId,
      title: typeof title === 'string' ? title.trim().slice(0, 100) : 'Nova Conversa',
      mode,
      summary: '',
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    return res.json({
      conversation: {
        id: ref.id,
        userId: uid,
        tenantId: req.user!.tenantId,
        title: typeof title === 'string' ? title.trim().slice(0, 100) : 'Nova Conversa',
        mode,
        projectId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    if (err instanceof MemoryScopeAccessError) {
      return res.status(403).json({
        error: {
          code: 'conversation_project_forbidden',
          message: err.message,
          correlationId: req.correlationId,
        },
      });
    }
    return res.status(500).json({
      error: {
        code: 'conversation_create_failed',
        message: 'Erro ao criar conversa no servidor.',
        correlationId: req.correlationId,
      },
    });
  }
});

// GET /api/conversations/:id
conversationRouter.get('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!checkDatabaseAvailability(req, res)) return;
    const uid = req.user!.uid;
    const { id } = req.params;

    const snap = await adminDb!.collection('conversations').doc(id).get();
    if (!snap.exists || !belongsToAuthenticatedContext(snap.data(), req)) {
      return res.status(404).json({
        error: { code: 'conversation_not_found', message: 'Conversa não encontrada ou sem acesso.', correlationId: req.correlationId },
      });
    }

    const d = snap.data()!;
    return res.json({
      conversation: {
        id: snap.id,
        userId: d.userId,
        projectId: d.projectId || null,
        title: d.title,
        mode: d.mode,
        summary: d.summary || '',
        createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : new Date(d.createdAt).toISOString()) : new Date().toISOString(),
        updatedAt: d.updatedAt ? (d.updatedAt.toDate ? d.updatedAt.toDate().toISOString() : new Date(d.updatedAt).toISOString()) : new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'conversation_get_failed', message: 'Erro ao buscar detalhes da conversa.', correlationId: req.correlationId } });
  }
});

// PATCH /api/conversations/:id
conversationRouter.patch('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!checkDatabaseAvailability(req, res)) return;
    const uid = req.user!.uid;
    const { id } = req.params;
    const { title, mode } = req.body;

    const ref = adminDb!.collection('conversations').doc(id);
    const snap = await ref.get();

    if (!snap.exists || !belongsToAuthenticatedContext(snap.data(), req)) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Conversa não encontrada.', correlationId: req.correlationId } });
    }

    const updates: any = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof title === 'string' && title.trim()) updates.title = title.trim().slice(0, 100);
    if (mode) updates.mode = mode;

    await ref.update(updates);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'conversation_update_failed', message: 'Erro ao atualizar conversa.', correlationId: req.correlationId } });
  }
});

// DELETE /api/conversations/:id
conversationRouter.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!checkDatabaseAvailability(req, res)) return;
    const uid = req.user!.uid;
    const { id } = req.params;

    const ref = adminDb!.collection('conversations').doc(id);
    const snap = await ref.get();

    if (!snap.exists || !belongsToAuthenticatedContext(snap.data(), req)) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Conversa não encontrada.', correlationId: req.correlationId } });
    }

        // Exclui as mensagens em lotes para respeitar
    // o limite máximo de operações do Firestore.
    const DELETE_BATCH_SIZE = 400;

    while (true) {
      const messagesSnap = await adminDb!
        .collection('messages')
        .where('conversationId', '==', id)
        .where('userId', '==', uid)
        .limit(DELETE_BATCH_SIZE)
        .get();

      if (messagesSnap.empty) {
        break;
      }

      const messageBatch = adminDb!.batch();

      messagesSnap.docs.forEach((document) => {
        messageBatch.delete(document.ref);
      });

      await messageBatch.commit();

      if (
        messagesSnap.size <
        DELETE_BATCH_SIZE
      ) {
        break;
      }
    }

    await ref.delete();

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'conversation_delete_failed', message: 'Erro ao deletar conversa.', correlationId: req.correlationId } });
  }
});

// GET /api/conversations/:id/messages
conversationRouter.get('/:id/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!checkDatabaseAvailability(req, res)) return;
    const uid = req.user!.uid;
    const { id } = req.params;

    // First check conversation existence and ownership
    const convSnap = await adminDb!.collection('conversations').doc(id).get();
    if (!convSnap.exists || !belongsToAuthenticatedContext(convSnap.data(), req)) {
      return res.status(404).json({
        error: { code: 'conversation_not_found', message: 'Conversa não encontrada ou sem acesso.', correlationId: req.correlationId },
      });
    }

        const snap = await adminDb!
      .collection('messages')
      .where('conversationId', '==', id)
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const messages = snap.docs
      .slice()
      .reverse()
      .map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        conversationId: d.conversationId,
        userId: d.userId,
        role: d.role,
        content: d.content,
        attachments: d.attachments || [],
        citations: d.citations || [],
        executionId: d.executionId || null,
        model: d.model || null,
        createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : new Date(d.createdAt).toISOString()) : new Date().toISOString(),
      };
    });

    return res.json({ messages });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'messages_fetch_failed', message: 'Erro ao buscar mensagens da conversa.', correlationId: req.correlationId } });
  }
});

// POST /api/conversations/:id/messages
conversationRouter.post('/:id/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!checkDatabaseAvailability(req, res)) return;
    const uid = req.user!.uid;
    const { id: conversationId } = req.params;
    const { content, attachments = [], citations = [], executionId = null, model = null } = req.body;

    const role = 'user';

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: { code: 'missing_content', message: 'Conteúdo da mensagem é obrigatório.', correlationId: req.correlationId } });
    }

    // Validate conversation existence and ownership
    const convSnap = await adminDb!.collection('conversations').doc(conversationId).get();
    if (!convSnap.exists || !belongsToAuthenticatedContext(convSnap.data(), req)) {
      return res.status(404).json({
        error: { code: 'conversation_not_found', message: 'Conversa não encontrada ou sem acesso.', correlationId: req.correlationId },
      });
    }

    const ref = adminDb!.collection('messages').doc();
    const now = FieldValue.serverTimestamp();

    await ref.set({
      conversationId,
      userId: uid,
      tenantId: req.user!.tenantId,
      role,
      content,
      attachments,
      citations,
      executionId,
      model,
      createdAt: now,
    });

    // Touch conversation updatedAt
    await adminDb!.collection('conversations').doc(conversationId).update({
      updatedAt: now,
    });

    return res.json({
      message: {
        id: ref.id,
        conversationId,
        userId: uid,
        role,
        content,
        attachments,
        citations,
        executionId,
        model,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'message_create_failed', message: 'Erro ao salvar mensagem.', correlationId: req.correlationId } });
  }
});
