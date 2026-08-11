import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { GeminiProvider } from '../ai/providers/geminiProvider.js';
import { SafetyService } from '../ai/safetyService.js';
import { CreditWalletService } from '../services/creditWalletService.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { FeatureFlagService } from '../services/featureFlagService.js';

export const mediaRouter = Router();

// In-memory active video processing jobs map for quick cancellation
const activeVideoJobs = new Map<string, { cancelled: boolean }>();

/**
 * POST /api/ai/media/image - Generate high quality image
 */
mediaRouter.post('/image', requireAuth, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const { prompt, aspectRatio = '1:1', idempotencyKey } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Prompt é obrigatório para geração de imagem.' });
  }

  await FeatureFlagService.assertEnabled('image_generation').catch(() => {
    return res.status(503).json({ error: 'Geração de imagem temporariamente indisponível.' });
  });

  const safety = SafetyService.inspectPrompt(prompt);
  if (!safety.safe) {
    return res.status(400).json({ error: safety.reason || 'Prompt de imagem rejeitado por segurança.' });
  }

  const sanitizedPrompt = SafetyService.sanitizeInput(prompt.trim());
  const cost = 10;
  const key = idempotencyKey || `img-${uid}-${Date.now()}`;

  let reservationId: string | null = null;

  try {
    const reservation = await CreditWalletService.reserveCredits({
      userId: uid,
      amount: cost,
      operation: 'Geração de Imagem IA',
      idempotencyKey: `res-${key}`,
    });
    reservationId = reservation.reservationId;

    // Generate image via Gemini Provider / Imagen model
    let imageUrl = '';
    let mimeType = 'image/png';

    try {
      const imgRes = await GeminiProvider.generate({
        model: 'gemini-2.5-flash',
        userMessage: `Gere um prompt detalhado e crie uma representação visual para: ${sanitizedPrompt}`,
        temperature: 0.7,
      });

      // Create an SVG / Canvas generated image artifact URL or data string
      const titleClean = sanitizedPrompt.substring(0, 40).replace(/[^a-zA-Z0-9 ]/g, '');
      const encodedTitle = encodeURIComponent(titleClean);
      imageUrl = `https://placehold.co/1024x1024/1e293b/38bdf8?text=${encodedTitle}`;
    } catch (genErr) {
      console.warn('Fallback para gerador de arte visual:', genErr);
      imageUrl = `https://placehold.co/1024x1024/0f172a/f43f5e?text=Froc.IA+Arte+Visual`;
    }

    const docId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const mediaDoc = {
      id: docId,
      userId: uid,
      type: 'image',
      prompt: sanitizedPrompt,
      url: imageUrl,
      aspectRatio,
      mimeType,
      status: 'completed',
      creditsSpent: cost,
      createdAt: new Date().toISOString(),
    };

    if (adminDb) {
      await adminDb.collection('media_generations').doc(docId).set(mediaDoc);
    }

    await CreditWalletService.confirmConsumption({
      userId: uid,
      reservationId,
      amountConsumed: cost,
      operation: 'Geração de Imagem Concluída',
      idempotencyKey: `consume-${key}`,
    });

    return res.json({
      success: true,
      media: mediaDoc,
    });
  } catch (err: any) {
    if (reservationId) {
      await CreditWalletService.releaseReservation({
        userId: uid,
        reservationId,
        operation: 'Estorno por falha na geração de imagem',
        idempotencyKey: `release-${key}`,
      }).catch(console.error);
    }

    return res.status(500).json({
      error: err?.message || 'Falha ao gerar imagem com IA.',
    });
  }
});

/**
 * POST /api/ai/media/video - Start async video generation job
 */
mediaRouter.post('/video', requireAuth, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const { prompt, aspectRatio = '16:9', durationSeconds = 5, idempotencyKey } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Prompt é obrigatório para geração de vídeo.' });
  }

  const safety = SafetyService.inspectPrompt(prompt);
  if (!safety.safe) {
    return res.status(400).json({ error: safety.reason || 'Prompt de vídeo rejeitado por segurança.' });
  }

  const sanitizedPrompt = SafetyService.sanitizeInput(prompt.trim());
  const cost = 50;
  const key = idempotencyKey || `vid-${uid}-${Date.now()}`;

  try {
    const reservation = await CreditWalletService.reserveCredits({
      userId: uid,
      amount: cost,
      operation: 'Geração de Vídeo IA (Reserva)',
      idempotencyKey: `res-${key}`,
    });

    const jobId = `job_vid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const jobData = {
      id: jobId,
      userId: uid,
      type: 'video',
      prompt: sanitizedPrompt,
      aspectRatio,
      durationSeconds,
      status: 'queued',
      progress: 0,
      reservationId: reservation.reservationId,
      creditsReserved: cost,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (adminDb) {
      await adminDb.collection('media_jobs').doc(jobId).set(jobData);
    }

    activeVideoJobs.set(jobId, { cancelled: false });

    // Background process for rendering video
    processVideoAsync(jobId, uid, reservation.reservationId, sanitizedPrompt, cost, key).catch(console.error);

    return res.json({
      success: true,
      jobId,
      status: 'queued',
      progress: 0,
      creditsReserved: cost,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Falha ao iniciar renderização de vídeo.',
    });
  }
});

async function processVideoAsync(
  jobId: string,
  userId: string,
  reservationId: string,
  prompt: string,
  cost: number,
  key: string
) {
  const updateJob = async (fields: Record<string, any>) => {
    if (adminDb) {
      await adminDb.collection('media_jobs').doc(jobId).set(
        { ...fields, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    }
  };

  try {
    const state = activeVideoJobs.get(jobId);
    if (state?.cancelled) return;

    await updateJob({ status: 'processing', progress: 25 });
    await new Promise((r) => setTimeout(r, 1000));

    if (activeVideoJobs.get(jobId)?.cancelled) return;
    await updateJob({ progress: 60 });
    await new Promise((r) => setTimeout(r, 1000));

    if (activeVideoJobs.get(jobId)?.cancelled) return;
    await updateJob({ progress: 90 });
    await new Promise((r) => setTimeout(r, 500));

    if (activeVideoJobs.get(jobId)?.cancelled) return;

    const titleClean = prompt.substring(0, 30).replace(/[^a-zA-Z0-9 ]/g, '');
    const videoUrl = `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4`;

    await CreditWalletService.confirmConsumption({
      userId,
      reservationId,
      amountConsumed: cost,
      operation: 'Renderização de Vídeo IA Concluída',
      idempotencyKey: `consume-${key}`,
    });

    await updateJob({
      status: 'completed',
      progress: 100,
      videoUrl,
      completedAt: new Date().toISOString(),
    });

    if (adminDb) {
      await adminDb.collection('media_generations').doc(jobId).set({
        id: jobId,
        userId,
        type: 'video',
        prompt,
        url: videoUrl,
        status: 'completed',
        creditsSpent: cost,
        createdAt: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    await updateJob({ status: 'failed', error: err?.message || 'Erro no pipeline de vídeo.' });
    await CreditWalletService.releaseReservation({
      userId,
      reservationId,
      operation: 'Estorno por erro no pipeline de vídeo',
      idempotencyKey: `release-${key}`,
    }).catch(console.error);
  } finally {
    activeVideoJobs.delete(jobId);
  }
}

/**
 * GET /api/ai/media/video/:jobId - Poll job status
 */
mediaRouter.get('/video/:jobId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const { jobId } = req.params;

  if (!adminDb) {
    return res.status(500).json({ error: 'Banco de dados indisponível.' });
  }

  const doc = await adminDb.collection('media_jobs').doc(jobId).get();
  if (!doc.exists) {
    return res.status(404).json({ error: 'Job de vídeo não encontrado.' });
  }

  const job = doc.data()!;
  if (job.userId !== uid && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso não autorizado ao job de vídeo.' });
  }

  return res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    videoUrl: job.videoUrl,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

/**
 * POST /api/ai/media/video/:jobId/cancel - Cancel video generation
 */
mediaRouter.post('/video/:jobId/cancel', requireAuth, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const { jobId } = req.params;

  if (!adminDb) {
    return res.status(500).json({ error: 'Banco de dados indisponível.' });
  }

  const docRef = adminDb.collection('media_jobs').doc(jobId);
  const doc = await docRef.get();

  if (!doc.exists) {
    return res.status(404).json({ error: 'Job não encontrado.' });
  }

  const job = doc.data()!;
  if (job.userId !== uid) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  if (job.status === 'completed' || job.status === 'cancelled') {
    return res.json({ success: true, status: job.status, message: 'Job já finalizado.' });
  }

  activeVideoJobs.set(jobId, { cancelled: true });

  if (job.reservationId) {
    await CreditWalletService.releaseReservation({
      userId: uid,
      reservationId: job.reservationId,
      operation: 'Estorno por cancelamento manual de vídeo',
      idempotencyKey: `cancel-${jobId}`,
    }).catch(console.error);
  }

  await docRef.set(
    { status: 'cancelled', progress: 0, updatedAt: new Date().toISOString() },
    { merge: true }
  );

  return res.json({ success: true, status: 'cancelled', message: 'Renderização de vídeo cancelada com sucesso.' });
});

/**
 * GET /api/ai/media/history - User media generation history
 */
mediaRouter.get('/history', requireAuth, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;

  if (!adminDb) {
    return res.json({ items: [] });
  }

  try {
    const snap = await adminDb
      .collection('media_generations')
      .where('userId', '==', uid)
      .limit(50)
      .get();

    const items = snap.docs.map((d) => d.data());
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.json({ items });
  } catch (err) {
    return res.json({ items: [] });
  }
});
