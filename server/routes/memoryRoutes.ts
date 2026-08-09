import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { MemoryService } from '../ai/memoryService.js';
import { adminDb } from '../lib/firebaseAdmin.js';

export const memoryRouter = Router();

// GET /api/memories
memoryRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { projectId, conversationId } = req.query;

    const memories = await MemoryService.getActiveMemories(
      uid,
      projectId as string | undefined,
      conversationId as string | undefined
    );

    return res.json({ memories });
  } catch (err: any) {
    return res.status(500).json({
      error: {
        code: 'memories_fetch_failed',
        message: 'Erro ao buscar memorias do usuario.',
        correlationId: req.correlationId,
      },
    });
  }
});

// POST /api/memories
memoryRouter.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { scope = 'user', scopeId = null, category = 'general', content, userApproved = true } = req.body;

    if (!content) {
      return res.status(400).json({
        error: { code: 'missing_content', message: 'Conteudo da memoria e obrigatorio.', correlationId: req.correlationId },
      });
    }

    const memoryId = await MemoryService.saveMemory(uid, {
      scope,
      scopeId,
      category,
      content,
      source: 'user_manual',
      confidence: 1.0,
      validFrom: new Date().toISOString(),
      validUntil: null,
      status: 'active',
      userApproved,
    });

    return res.json({
      memory: { id: memoryId, userId: uid, scope, scopeId, category, content, status: 'active', createdAt: new Date().toISOString() },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: { code: 'memory_create_failed', message: 'Erro ao criar memoria.', correlationId: req.correlationId },
    });
  }
});

// PATCH /api/memories/:id
memoryRouter.patch('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { id } = req.params;
    const { category, content, status, userApproved } = req.body;

    const success = await MemoryService.updateMemory(uid, id, { category, content, status, userApproved });
    if (!success) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Memoria nao encontrada.', correlationId: req.correlationId } });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'memory_update_failed', message: 'Erro ao atualizar memoria.', correlationId: req.correlationId } });
  }
});

// DELETE /api/memories/:id
memoryRouter.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { id } = req.params;

    const success = await MemoryService.deleteMemory(uid, id);
    if (!success) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Memoria nao encontrada.', correlationId: req.correlationId } });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'memory_delete_failed', message: 'Erro ao deletar memoria.', correlationId: req.correlationId } });
  }
});
