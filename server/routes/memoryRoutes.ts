import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { MemoryScopeAccessError, MemoryService } from '../ai/memoryService.js';
import { MemoryPolicyViolationError } from '../ai/memoryPolicy.js';
import { MemoryEncryptionUnavailableError } from '../ai/memoryCryptoService.js';

export const memoryRouter = Router();

const createMemorySchema = z.object({
  scope: z.enum(['user', 'organization', 'project', 'conversation']).default('user'),
  scopeId: z.string().nullable().optional(),
  category: z.string().max(50).default('general'),
  content: z.string().min(1).max(2000),
  purpose: z.enum([
    'personalization',
    'project_continuity',
    'conversation_context',
    'user_note',
  ]).optional(),
  sensitivity: z.enum(['standard', 'personal']).default('standard'),
  retentionDays: z.number().int().min(1).max(730).optional(),
  consentConfirmed: z.literal(true),
  validUntil: z.string().datetime().nullable().optional(),
}).refine((data) => {
  if ((data.scope === 'project' || data.scope === 'conversation') && !data.scopeId) {
    return false;
  }
  if ((data.scope === 'user' || data.scope === 'organization') && data.scopeId) {
    return false;
  }
  return true;
}, {
  message: 'scopeId é obrigatório para projeto e conversa, e proibido para usuário e empresa.',
});

const updateMemorySchema = z.object({
  category: z.string().max(50).optional(),
  content: z.string().min(1).max(2000).optional(),
  purpose: z.enum([
    'personalization',
    'project_continuity',
    'conversation_context',
    'user_note',
  ]).optional(),
  sensitivity: z.enum(['standard', 'personal']).optional(),
  retentionDays: z.number().int().min(1).max(730).optional(),
  status: z.enum(['active', 'superseded', 'deleted']).optional(),
  userApproved: z.boolean().optional(),
  validUntil: z.string().datetime().nullable().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Ao menos um campo valido deve ser informado para atualizacao.',
});

// GET /api/memories
memoryRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const tenantId = req.user!.tenantId;
    const { projectId, conversationId } = req.query;

    const manage = req.query.manage === 'true';
    const memories = manage
      ? await MemoryService.listMemories(uid, tenantId)
      : await MemoryService.getActiveMemories(
          uid,
          projectId as string | undefined,
          conversationId as string | undefined,
          typeof req.query.prompt === 'string' ? req.query.prompt : '',
          tenantId
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

// GET /api/memories/export - server-side export of the current, decrypted view.
memoryRouter.get('/export', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const memories = await MemoryService.listMemories(
      req.user!.uid,
      req.user!.tenantId
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="frocia-memorias-${new Date().toISOString().slice(0, 10)}.json"`
    );
    return res.json({ exportedAt: new Date().toISOString(), memories });
  } catch {
    return res.status(500).json({
      error: {
        code: 'memory_export_failed',
        message: 'Erro ao exportar memórias.',
        correlationId: req.correlationId,
      },
    });
  }
});

// GET /api/memories/audit - explains when and why memories were used.
memoryRouter.get('/audit', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const events = await MemoryService.listAuditEvents(
      req.user!.uid,
      req.user!.tenantId
    );
    return res.json({ events });
  } catch {
    return res.status(500).json({
      error: {
        code: 'memory_audit_fetch_failed',
        message: 'Erro ao buscar o histórico de uso das memórias.',
        correlationId: req.correlationId,
      },
    });
  }
});

// POST /api/memories
memoryRouter.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const tenantId = req.user!.tenantId;
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

    const {
      scope,
      scopeId,
      category,
      content,
      purpose,
      sensitivity,
      retentionDays,
      validUntil,
    } = parsed.data;
    const consentedAt = new Date().toISOString();

    const memoryId = await MemoryService.saveMemory(uid, {
      scope,
      scopeId: scopeId || null,
      category,
      content,
      source: 'user_manual',
      confidence: 1.0,
      purpose,
      sensitivity,
      retentionDays,
      validFrom: new Date().toISOString(),
      validUntil: validUntil || null,
      status: 'active',
      userApproved: true,
      consentedAt,
    }, tenantId);

    return res.json({
      memory: {
        id: memoryId,
        userId: uid,
        tenantId,
        scope,
        scopeId: scopeId || null,
        category,
        content,
        purpose,
        sensitivity,
        retentionDays,
        status: 'active',
        userApproved: true,
        consentedAt,
        validUntil: validUntil || null,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    if (err instanceof MemoryPolicyViolationError) {
      return res.status(400).json({
        error: { code: err.code, message: err.message, correlationId: req.correlationId },
      });
    }
    if (err instanceof MemoryEncryptionUnavailableError) {
      return res.status(503).json({
        error: { code: 'memory_encryption_unavailable', message: err.message, correlationId: req.correlationId },
      });
    }
    if (err instanceof MemoryScopeAccessError) {
      return res.status(403).json({
        error: { code: 'memory_scope_forbidden', message: err.message, correlationId: req.correlationId },
      });
    }
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

    const success = await MemoryService.updateMemory(
      uid,
      id,
      {
        ...parsed.data,
        consentedAt: parsed.data.userApproved ? new Date().toISOString() : undefined,
      },
      req.user!.tenantId
    );
    if (!success) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Memoria nao encontrada.', correlationId: req.correlationId } });
    }

    return res.json({ success: true });
  } catch (err: any) {
    if (err instanceof MemoryPolicyViolationError) {
      return res.status(400).json({ error: { code: err.code, message: err.message, correlationId: req.correlationId } });
    }
    if (err instanceof MemoryEncryptionUnavailableError) {
      return res.status(503).json({ error: { code: 'memory_encryption_unavailable', message: err.message, correlationId: req.correlationId } });
    }
    return res.status(500).json({ error: { code: 'memory_update_failed', message: 'Erro ao atualizar memoria.', correlationId: req.correlationId } });
  }
});

// DELETE /api/memories/:id
memoryRouter.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { id } = req.params;

    const success = await MemoryService.deleteMemory(uid, id, req.user!.tenantId);
    if (!success) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Memoria nao encontrada.', correlationId: req.correlationId } });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'memory_delete_failed', message: 'Erro ao deletar memoria.', correlationId: req.correlationId } });
  }
});

// DELETE /api/memories?confirm=DELETE_ALL
memoryRouter.delete('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.query.confirm !== 'DELETE_ALL') {
    return res.status(400).json({
      error: {
        code: 'memory_delete_confirmation_required',
        message: 'Confirmação explícita obrigatória para excluir todas as memórias.',
        correlationId: req.correlationId,
      },
    });
  }

  try {
    const deleted = await MemoryService.deleteAllMemories(
      req.user!.uid,
      req.user!.tenantId
    );
    return res.json({ success: true, deleted });
  } catch {
    return res.status(500).json({
      error: {
        code: 'memory_bulk_delete_failed',
        message: 'Erro ao excluir todas as memórias.',
        correlationId: req.correlationId,
      },
    });
  }
});
