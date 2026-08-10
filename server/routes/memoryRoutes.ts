import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { MemoryService } from '../ai/memoryService.js';

export const memoryRouter = Router();

const createMemorySchema = z.object({
  scope: z.enum(['user', 'project', 'conversation']).default('user'),
  scopeId: z.string().nullable().optional(),
  category: z.string().max(50).default('general'),
  content: z.string().min(1).max(2000),
  userApproved: z.boolean().default(true),
}).refine((data) => {
  if ((data.scope === 'project' || data.scope === 'conversation') && !data.scopeId) {
    return false;
  }
  if (data.scope === 'user' && data.scopeId) {
    return false;
  }
  return true;
}, {
  message: 'scopeId e obrigatorio para escopos project e conversation, e proibido para escopo user.',
});

const updateMemorySchema = z.object({
  category: z.string().max(50).optional(),
  content: z.string().min(1).max(2000).optional(),
  status: z.enum(['active', 'superseded', 'deleted']).optional(),
  userApproved: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Ao menos um campo valido deve ser informado para atualizacao.',
});

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
    const parsed = createMemorySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'invalid_memory_input',
          message: parsed.error.issues[0].message,
          correlationId: req.correlationId,
        },
      });
    }

    const { scope, scopeId, category, content, userApproved } = parsed.data;

    const memoryId = await MemoryService.saveMemory(uid, {
      scope,
      scopeId: scopeId || null,
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
      memory: { id: memoryId, userId: uid, scope, scopeId: scopeId || null, category, content, status: 'active', createdAt: new Date().toISOString() },
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
    const parsed = updateMemorySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'invalid_update_input',
          message: parsed.error.issues[0].message,
          correlationId: req.correlationId,
        },
      });
    }

    const success = await MemoryService.updateMemory(uid, id, parsed.data);
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
