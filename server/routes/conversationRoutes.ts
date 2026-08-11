import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

export const conversationRouter = Router();

// GET /api/conversations
conversationRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    if (!adminDb) return res.json({ conversations: [] });

    const snap = await adminDb
      .collection('conversations')
      .where('userId', '==', uid)
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    const conversations = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        userId: d.userId,
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
        message: 'Erro ao buscar historico de conversas.',
        correlationId: req.correlationId,
      },
    });
  }
});

// POST /api/conversations
conversationRouter.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { title = 'Nova Conversa', mode = 'smart', projectId = null } = req.body;

    if (!adminDb) {
      return res.json({
        conversation: { id: `local-conv-${Date.now()}`, userId: uid, title, mode, projectId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      });
    }

    const ref = adminDb.collection('conversations').doc();
    const now = FieldValue.serverTimestamp();

    await ref.set({
      userId: uid,
      projectId,
      title,
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
        title,
        mode,
        projectId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: {
        code: 'conversation_create_failed',
        message: 'Erro ao criar conversa.',
        correlationId: req.correlationId,
      },
    });
  }
});

// GET /api/conversations/:id
conversationRouter.get('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { id } = req.params;

    if (!adminDb) return res.status(404).json({ error: { code: 'not_found', message: 'Conversa nao encontrada.', correlationId: req.correlationId } });

    const snap = await adminDb.collection('conversations').doc(id).get();
    if (!snap.exists || snap.data()?.userId !== uid) {
      return res.status(404).json({
        error: { code: 'conversation_not_found', message: 'Conversa nao encontrada ou sem acesso.', correlationId: req.correlationId },
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
    const uid = req.user!.uid;
    const { id } = req.params;
    const { title, mode } = req.body;

    if (!adminDb) return res.json({ success: true });

    const ref = adminDb.collection('conversations').doc(id);
    const snap = await ref.get();

    if (!snap.exists || snap.data()?.userId !== uid) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Conversa nao encontrada.', correlationId: req.correlationId } });
    }

    const updates: any = { updatedAt: FieldValue.serverTimestamp() };
    if (title) updates.title = title;
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
    const uid = req.user!.uid;
    const { id } = req.params;

    if (!adminDb) return res.json({ success: true });

    const ref = adminDb.collection('conversations').doc(id);
    const snap = await ref.get();

    if (!snap.exists || snap.data()?.userId !== uid) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Conversa nao encontrada.', correlationId: req.correlationId } });
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
    const uid = req.user!.uid;
    const { id } = req.params;

    if (!adminDb) return res.json({ messages: [] });

    const snap = await adminDb
      .collection('messages')
      .where('conversationId', '==', id)
      .where('userId', '==', uid)
      .orderBy('createdAt', 'asc')
      .get();

    const messages = snap.docs.map((doc) => {
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
    const uid = req.user!.uid;
    const { id: conversationId } = req.params;
    const { content, attachments = [], citations = [], executionId = null, model = null } = req.body;

    // Allow role = 'user' or 'ai' / 'assistant'
    const role = (req.body.role === 'ai' || req.body.role === 'assistant') ? 'ai' : 'user';

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: { code: 'missing_content', message: 'Conteudo da mensagem e obrigatorio.', correlationId: req.correlationId } });
    }

    if (!adminDb) {
      return res.json({ message: { id: `msg-${Date.now()}`, conversationId, userId: uid, role, content, citations, createdAt: new Date().toISOString() } });
    }

    // Validate conversation existence and ownership
    const convSnap = await adminDb.collection('conversations').doc(conversationId).get();
    if (!convSnap.exists || convSnap.data()?.userId !== uid) {
      return res.status(404).json({
        error: { code: 'conversation_not_found', message: 'Conversa nao encontrada ou sem acesso.', correlationId: req.correlationId },
      });
    }

    const ref = adminDb.collection('messages').doc();
    const now = FieldValue.serverTimestamp();

    await ref.set({
      conversationId,
      userId: uid,
      role,
      content,
      attachments,
      citations,
      executionId,
      model,
      createdAt: now,
    });

    // Touch conversation updatedAt
    await adminDb.collection('conversations').doc(conversationId).update({
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
