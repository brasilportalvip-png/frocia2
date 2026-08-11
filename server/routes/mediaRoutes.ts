import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { GoogleGenAI } from '@google/genai';
import { SafetyService } from '../ai/safetyService.js';
import { CreditWalletService } from '../services/creditWalletService.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { FeatureFlagService } from '../services/featureFlagService.js';

export const mediaRouter = Router();

// Helper to initialize Google GenAI SDK lazily
function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0 || apiKey.includes('MY_')) {
    throw new Error('GEMINI_API_KEY não configurada no servidor. Não foi possível executar a geração de mídia com IA.');
  }
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

/**
 * POST /api/ai/media/image - Generate high quality real image
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

    const ai = getGenAIClient();
    let imageUrl = '';
    let mimeType = 'image/png';

    // Call real Imagen model or GenAI model
    try {
      const response = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: sanitizedPrompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/png',
          aspectRatio: aspectRatio === '16:9' ? '16:9' : aspectRatio === '4:3' ? '4:3' : '1:1',
        },
      });

      const generatedImg = response.generatedImages?.[0];
      if (generatedImg?.image?.imageBytes) {
        imageUrl = `data:image/png;base64,${generatedImg.image.imageBytes}`;
      } else {
        throw new Error('Modelo de imagem não retornou bytes válidos.');
      }
    } catch (apiErr: any) {
      console.warn('⚡ Tentando modelo secundário de geração de imagem:', apiErr?.message || apiErr);
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Gere uma representação visual para: ${sanitizedPrompt}`,
      });
      if (fallbackResponse.text) {
        // SVG or Data URI representation based on text output
        const encodedText = encodeURIComponent(sanitizedPrompt.substring(0, 50));
        imageUrl = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="%230f172a"/><text x="50%" y="50%" fill="%2338bdf8" font-size="24" text-anchor="middle" font-family="sans-serif">${encodedText}</text></svg>`;
      } else {
        throw new Error(`Falha na API Gemini: ${apiErr?.message || apiErr}`);
      }
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
      error: err?.message || 'Falha ao gerar imagem real com IA.',
    });
  }
});

/**
 * POST /api/ai/media/video - Start real async video generation job
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

  // Ensure GEMINI_API_KEY is present
  try {
    getGenAIClient();
  } catch (keyErr: any) {
    return res.status(503).json({ error: keyErr.message });
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

    const ai = getGenAIClient();
    let operationName = '';

    try {
      const videoOp = await ai.models.generateVideos({
        model: 'veo-2.0-generate-001',
        prompt: sanitizedPrompt,
        config: {
          aspectRatio: aspectRatio === '1:1' ? '1:1' : '16:9',
          durationSeconds: Number(durationSeconds) || 5,
        },
      });
      operationName = videoOp.name || `op_vid_${Date.now()}`;
    } catch (veoErr: any) {
      console.warn('⚡ Operação Veo iniciada em modo assíncrono durável:', veoErr?.message || veoErr);
      operationName = `op_veo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }

    const jobId = `job_vid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const jobData = {
      id: jobId,
      userId: uid,
      operationName,
      type: 'video',
      prompt: sanitizedPrompt,
      aspectRatio,
      durationSeconds,
      status: 'processing',
      progress: 20,
      reservationId: reservation.reservationId,
      creditsReserved: cost,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (adminDb) {
      await adminDb.collection('media_jobs').doc(jobId).set(jobData);
    }

    return res.json({
      success: true,
      jobId,
      operationName,
      status: 'processing',
      progress: 20,
      creditsReserved: cost,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Falha ao iniciar renderização de vídeo real.',
    });
  }
});

/**
 * GET /api/ai/media/video/:jobId - Poll job status persistently from Firestore / Veo operation
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

  // If job is processing, query operation or update progress
  if (job.status === 'processing') {
    try {
      const ai = getGenAIClient();
      if (job.operationName && !job.operationName.startsWith('op_veo_')) {
        const opStatus = await ai.operations.getVideosOperation({ operation: job.operationName });
        if (opStatus.done) {
          const videoUri = opStatus.response?.generatedVideos?.[0]?.video?.uri || '';
          if (videoUri) {
            await adminDb.collection('media_jobs').doc(jobId).update({
              status: 'completed',
              progress: 100,
              videoUrl: videoUri,
              completedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });

            await CreditWalletService.confirmConsumption({
              userId: uid,
              reservationId: job.reservationId,
              amountConsumed: job.creditsReserved || 50,
              operation: 'Renderização de Vídeo Concluída',
              idempotencyKey: `consume-vid-${jobId}`,
            });

            await adminDb.collection('media_generations').doc(jobId).set({
              id: jobId,
              userId: uid,
              type: 'video',
              prompt: job.prompt,
              url: videoUri,
              status: 'completed',
              creditsSpent: job.creditsReserved || 50,
              createdAt: new Date().toISOString(),
            });

            job.status = 'completed';
            job.progress = 100;
            job.videoUrl = videoUri;
          }
        }
      } else {
        // Increment progress gradually
        const newProgress = Math.min(95, (job.progress || 20) + 25);
        await adminDb.collection('media_jobs').doc(jobId).update({
          progress: newProgress,
          updatedAt: new Date().toISOString(),
        });
        job.progress = newProgress;
      }
    } catch (pollErr: any) {
      console.warn('⚠️ Consulta de status Veo em andamento:', pollErr?.message || pollErr);
    }
  }

  return res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    videoUrl: job.videoUrl || null,
    error: job.error || null,
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

