import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

export const projectRouter = Router();

// GET /api/projects - List user projects
projectRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    if (!adminDb) return res.json({ projects: [] });

    const snap = await adminDb
      .collection('projects')
      .where('userId', '==', uid)
      .orderBy('updatedAt', 'desc')
      .limit(100)
      .get();

    const projects = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        userId: d.userId,
        title: d.title || 'Novo Projeto',
        description: d.description || '',
        prompt: d.prompt || '',
        category: d.category || 'Geral',
        colorPalette: d.colorPalette || '',
        tone: d.tone || 'Profissional',
        html: d.html || '',
        isFavorite: d.isFavorite || false,
        suggestedRefinements: d.suggestedRefinements || [],
        createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().getTime() : new Date(d.createdAt).getTime()) : Date.now(),
        updatedAt: d.updatedAt ? (d.updatedAt.toDate ? d.updatedAt.toDate().getTime() : new Date(d.updatedAt).getTime()) : Date.now(),
      };
    });

    return res.json({ projects });
  } catch (err: any) {
    return res.status(500).json({
      error: {
        code: 'projects_fetch_failed',
        message: 'Erro ao buscar projetos.',
        correlationId: req.correlationId,
      },
    });
  }
});

// POST /api/projects - Create new project
projectRouter.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const {
      title = 'Novo Projeto',
      description = '',
      prompt = '',
      category = 'Geral',
      colorPalette = '',
      tone = 'Profissional',
      html = '',
      isFavorite = false,
      suggestedRefinements = []
    } = req.body;

    if (!adminDb) {
      const fallbackId = `local-proj-${Date.now()}`;
      return res.json({
        project: {
          id: fallbackId,
          userId: uid,
          title,
          description,
          prompt,
          category,
          colorPalette,
          tone,
          html,
          isFavorite,
          suggestedRefinements,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
    }

    const ref = adminDb.collection('projects').doc();
    const now = FieldValue.serverTimestamp();

    await ref.set({
      userId: uid,
      title,
      description,
      prompt,
      category,
      colorPalette,
      tone,
      html,
      isFavorite,
      suggestedRefinements,
      createdAt: now,
      updatedAt: now,
    });

    return res.json({
      project: {
        id: ref.id,
        userId: uid,
        title,
        description,
        prompt,
        category,
        colorPalette,
        tone,
        html,
        isFavorite,
        suggestedRefinements,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: {
        code: 'project_create_failed',
        message: 'Erro ao salvar projeto.',
        correlationId: req.correlationId,
      },
    });
  }
});

// GET /api/projects/:id - Get project details
projectRouter.get('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { id } = req.params;

    if (!adminDb) {
      return res.status(404).json({
        error: { code: 'project_not_found', message: 'Projeto nao encontrado.', correlationId: req.correlationId },
      });
    }

    const snap = await adminDb.collection('projects').doc(id).get();
    if (!snap.exists || snap.data()?.userId !== uid) {
      return res.status(404).json({
        error: { code: 'project_not_found', message: 'Projeto nao encontrado ou sem acesso.', correlationId: req.correlationId },
      });
    }

    const d = snap.data()!;
    return res.json({
      project: {
        id: snap.id,
        userId: d.userId,
        title: d.title,
        description: d.description || '',
        prompt: d.prompt || '',
        category: d.category || 'Geral',
        colorPalette: d.colorPalette || '',
        tone: d.tone || 'Profissional',
        html: d.html || '',
        isFavorite: d.isFavorite || false,
        suggestedRefinements: d.suggestedRefinements || [],
        createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().getTime() : new Date(d.createdAt).getTime()) : Date.now(),
        updatedAt: d.updatedAt ? (d.updatedAt.toDate ? d.updatedAt.toDate().getTime() : new Date(d.updatedAt).getTime()) : Date.now(),
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: { code: 'project_fetch_failed', message: 'Erro ao buscar projeto.', correlationId: req.correlationId },
    });
  }
});

// PUT /api/projects/:id - Update project
projectRouter.put('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { id } = req.params;
    const {
      title,
      description,
      prompt,
      category,
      colorPalette,
      tone,
      html,
      isFavorite,
      suggestedRefinements
    } = req.body;

    if (!adminDb) return res.json({ success: true });

    const ref = adminDb.collection('projects').doc(id);
    const snap = await ref.get();

    if (!snap.exists || snap.data()?.userId !== uid) {
      return res.status(404).json({
        error: { code: 'project_not_found', message: 'Projeto nao encontrado ou sem acesso.', correlationId: req.correlationId },
      });
    }

    const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (prompt !== undefined) updates.prompt = prompt;
    if (category !== undefined) updates.category = category;
    if (colorPalette !== undefined) updates.colorPalette = colorPalette;
    if (tone !== undefined) updates.tone = tone;
    if (html !== undefined) updates.html = html;
    if (isFavorite !== undefined) updates.isFavorite = isFavorite;
    if (suggestedRefinements !== undefined) updates.suggestedRefinements = suggestedRefinements;

    await ref.update(updates);

    return res.json({ success: true, id });
  } catch (err: any) {
    return res.status(500).json({
      error: { code: 'project_update_failed', message: 'Erro ao atualizar projeto.', correlationId: req.correlationId },
    });
  }
});

// DELETE /api/projects/:id - Delete project
projectRouter.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { id } = req.params;

    if (!adminDb) return res.json({ success: true });

    const ref = adminDb.collection('projects').doc(id);
    const snap = await ref.get();

    if (!snap.exists || snap.data()?.userId !== uid) {
      return res.status(404).json({
        error: { code: 'project_not_found', message: 'Projeto nao encontrado ou sem acesso.', correlationId: req.correlationId },
      });
    }

    await ref.delete();
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({
      error: { code: 'project_delete_failed', message: 'Erro ao deletar projeto.', correlationId: req.correlationId },
    });
  }
});
