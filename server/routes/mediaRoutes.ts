import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { SafetyService } from '../ai/safetyService.js';
import { CreditWalletService } from '../services/creditWalletService.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { FeatureFlagService } from '../services/featureFlagService.js';

export const mediaRouter = Router();

type ImageAspectRatio = '1:1' | '4:3' | '16:9';
type VideoAspectRatio = '1:1' | '16:9';
type VideoQuality = 'lite' | 'fast' | 'standard';

const IMAGE_COST = 18;

const VIDEO_COSTS: Record<VideoQuality, number> = {
  lite: 30,
  fast: 46,
  standard: 120,
};

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_MEDIA_API_KEY;

  if (
    !apiKey ||
    apiKey.trim().length === 0 ||
    apiKey.includes('MY_')
  ) {
    throw new Error(
      'GEMINI_MEDIA_API_KEY não configurada no servidor.'
    );
  }

  return new GoogleGenAI({
    apiKey: apiKey.trim(),
  });
}

function normalizeImageAspectRatio(
  value: unknown
): ImageAspectRatio {
  if (value === '16:9' || value === '4:3') {
    return value;
  }

  return '1:1';
}

function normalizeVideoAspectRatio(
  value: unknown
): VideoAspectRatio {
  return value === '1:1' ? '1:1' : '16:9';
}

function normalizeVideoQuality(
  value: unknown
): VideoQuality {
  if (value === 'fast' || value === 'standard') {
    return value;
  }

  return 'lite';
}

function normalizeDurationSeconds(
  value: unknown
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 5;
  }

  return Math.min(8, Math.max(5, Math.round(parsed)));
}

function normalizeIdempotencyKey(
  value: unknown,
  fallback: string
): string {
  if (
    typeof value === 'string' &&
    /^[A-Za-z0-9:_-]{8,200}$/.test(value.trim())
  ) {
    return value.trim();
  }

  return fallback;
}

async function releaseVideoReservation(params: {
  userId: string;
  reservationId?: string | null;
  jobId: string;
  operation: string;
}): Promise<void> {
  if (!params.reservationId) {
    return;
  }

  await CreditWalletService.releaseReservation({
    userId: params.userId,
    reservationId: params.reservationId,
    operation: params.operation,
    idempotencyKey: `release-video-${params.jobId}`,
  }).catch((error) => {
    console.error(
      'Erro ao liberar reserva de vídeo:',
      error
    );
  });
}

/**
 * POST /api/ai/media/image
 *
 * Executa uma geração real de imagem.
 * Não cria SVG, placeholder ou resultado fictício quando o provedor falhar.
 */
mediaRouter.post(
  '/image',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;
    const {
      prompt,
      aspectRatio: requestedAspectRatio = '1:1',
      idempotencyKey,
    } = req.body || {};

    if (
      typeof prompt !== 'string' ||
      prompt.trim().length === 0
    ) {
      return res.status(400).json({
        error:
          'Prompt é obrigatório para geração de imagem.',
      });
    }

    if (prompt.trim().length > 5000) {
      return res.status(400).json({
        error:
          'O prompt de imagem excede o limite de 5.000 caracteres.',
      });
    }

    try {
      await FeatureFlagService.assertEnabled(
        'image_generation'
      );
    } catch {
      return res.status(503).json({
        error:
          'Geração de imagem temporariamente indisponível.',
      });
    }

    const safety =
      SafetyService.inspectPrompt(prompt);

    if (!safety.safe) {
      return res.status(400).json({
        error:
          safety.reason ||
          'Prompt de imagem rejeitado por segurança.',
      });
    }

    const sanitizedPrompt =
      SafetyService.sanitizeInput(prompt.trim());

    const aspectRatio = normalizeImageAspectRatio(
      requestedAspectRatio
    );

    const key = normalizeIdempotencyKey(
      idempotencyKey,
      `img-${uid}-${Date.now()}`
    );

    let reservationId: string | null = null;

    try {
      const reservation =
        await CreditWalletService.reserveCredits({
          userId: uid,
          amount: IMAGE_COST,
          operation: 'Reserva para geração de imagem IA',
          idempotencyKey: `res-${key}`,
        });

      reservationId = reservation.reservationId;

      const ai = getGenAIClient();

      const response = await ai.models.generateImages({
        model:
          process.env.IMAGEN_MODEL ||
          'imagen-3.0-generate-002',
        prompt: sanitizedPrompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/png',
          aspectRatio,
        },
      });

      const generatedImage =
        response.generatedImages?.[0];

      const imageBytes =
        generatedImage?.image?.imageBytes;

      if (!imageBytes) {
        throw new Error(
          'O provedor não retornou uma imagem válida.'
        );
      }

      const imageDataUrl =
        `data:image/png;base64,${imageBytes}`;

      const docId =
        `img_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 9)}`;

      const createdAt = new Date().toISOString();

      /*
       * O Base64 não é gravado no Firestore porque documentos possuem
       * limite de tamanho. A imagem é devolvida diretamente ao navegador.
       * O armazenamento persistente será conectado em arquivo próprio.
       */
      const mediaRecord = {
        id: docId,
        userId: uid,
        type: 'image',
        prompt: sanitizedPrompt,
        aspectRatio,
        mimeType: 'image/png',
        model:
          process.env.IMAGEN_MODEL ||
          'imagen-3.0-generate-002',
        status: 'completed',
        storageStatus: 'awaiting_persistent_storage',
        creditsSpent: IMAGE_COST,
        createdAt,
        updatedAt: createdAt,
      };

      if (adminDb) {
        await adminDb
          .collection('media_generations')
          .doc(docId)
          .set(mediaRecord);
      }

      await CreditWalletService.confirmConsumption({
        userId: uid,
        reservationId,
        amountConsumed: IMAGE_COST,
        operation: 'Geração de imagem concluída',
        idempotencyKey: `consume-${key}`,
      });

      reservationId = null;

      return res.json({
        success: true,
        media: {
          ...mediaRecord,
          url: imageDataUrl,
        },
      });
    } catch (error: any) {
      if (reservationId) {
        await CreditWalletService.releaseReservation({
          userId: uid,
          reservationId,
          operation:
            'Estorno por falha na geração de imagem',
          idempotencyKey: `release-${key}`,
        }).catch((releaseError) => {
          console.error(
            'Erro ao estornar geração de imagem:',
            releaseError
          );
        });
      }

      console.error(
        'Falha real na geração de imagem:',
        error?.message || error
      );

      return res.status(502).json({
        error:
          error?.message ||
          'O provedor não conseguiu gerar a imagem.',
      });
    }
  }
);

/**
 * POST /api/ai/media/video
 *
 * Inicia um job real no provedor. Se o Veo não aceitar a operação,
 * nenhum job fictício será criado e os créditos serão estornados.
 */
mediaRouter.post(
  '/video',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;

    const {
      prompt,
      aspectRatio: requestedAspectRatio = '16:9',
      durationSeconds: requestedDuration = 5,
      quality: requestedQuality = 'lite',
      idempotencyKey,
    } = req.body || {};

    if (
      typeof prompt !== 'string' ||
      prompt.trim().length === 0
    ) {
      return res.status(400).json({
        error:
          'Prompt é obrigatório para geração de vídeo.',
      });
    }

    if (prompt.trim().length > 5000) {
      return res.status(400).json({
        error:
          'O prompt de vídeo excede o limite de 5.000 caracteres.',
      });
    }

    try {
      await FeatureFlagService.assertEnabled(
        'video_generation'
      );
    } catch {
      return res.status(503).json({
        error:
          'Geração de vídeo temporariamente indisponível.',
      });
    }

    const safety =
      SafetyService.inspectPrompt(prompt);

    if (!safety.safe) {
      return res.status(400).json({
        error:
          safety.reason ||
          'Prompt de vídeo rejeitado por segurança.',
      });
    }

    const sanitizedPrompt =
      SafetyService.sanitizeInput(prompt.trim());

    const aspectRatio = normalizeVideoAspectRatio(
      requestedAspectRatio
    );

    const durationSeconds =
      normalizeDurationSeconds(requestedDuration);

    const quality = normalizeVideoQuality(
      requestedQuality
    );

    const cost = VIDEO_COSTS[quality];

    const key = normalizeIdempotencyKey(
      idempotencyKey,
      `vid-${uid}-${Date.now()}`
    );

    let reservationId: string | null = null;

    try {
      getGenAIClient();

      const reservation =
        await CreditWalletService.reserveCredits({
          userId: uid,
          amount: cost,
          operation:
            `Reserva para geração de vídeo IA (${quality})`,
          idempotencyKey: `res-${key}`,
        });

      reservationId = reservation.reservationId;

      const ai = getGenAIClient();

      const videoOperation =
        await ai.models.generateVideos({
          model:
            process.env.VEO_MODEL ||
            'veo-2.0-generate-001',
          prompt: sanitizedPrompt,
          config: {
            aspectRatio,
            durationSeconds,
          },
        });

      const operationName = videoOperation.name;

      if (!operationName) {
        throw new Error(
          'O provedor de vídeo não retornou uma operação válida.'
        );
      }

      const jobId =
        `job_vid_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 9)}`;

      const createdAt = new Date().toISOString();

      const jobData = {
        id: jobId,
        userId: uid,
        operationName,
        type: 'video',
        prompt: sanitizedPrompt,
        aspectRatio,
        durationSeconds,
        quality,
        model:
          process.env.VEO_MODEL ||
          'veo-2.0-generate-001',
        status: 'processing',
        progress: 10,
        pollFailures: 0,
        reservationId,
        creditsReserved: cost,
        createdAt,
        updatedAt: createdAt,
      };

      if (!adminDb) {
        throw new Error(
          'Banco de dados indisponível para registrar o job de vídeo.'
        );
      }

      await adminDb
        .collection('media_jobs')
        .doc(jobId)
        .set(jobData);

      return res.status(202).json({
        success: true,
        jobId,
        status: 'processing',
        progress: 10,
        quality,
        creditsReserved: cost,
      });
    } catch (error: any) {
      if (reservationId) {
        await CreditWalletService.releaseReservation({
          userId: uid,
          reservationId,
          operation:
            'Estorno por falha ao iniciar geração de vídeo',
          idempotencyKey: `release-${key}`,
        }).catch((releaseError) => {
          console.error(
            'Erro ao estornar reserva de vídeo:',
            releaseError
          );
        });
      }

      console.error(
        'Falha real ao iniciar vídeo:',
        error?.message || error
      );

      return res.status(502).json({
        error:
          error?.message ||
          'O provedor não conseguiu iniciar o vídeo.',
      });
    }
  }
);

/**
 * GET /api/ai/media/video/:jobId
 *
 * Consulta uma operação real do Veo.
 */
mediaRouter.get(
  '/video/:jobId',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;
    const { jobId } = req.params;

    if (!adminDb) {
      return res.status(503).json({
        error: 'Banco de dados indisponível.',
      });
    }

    const docRef = adminDb
      .collection('media_jobs')
      .doc(jobId);

    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return res.status(404).json({
        error: 'Job de vídeo não encontrado.',
      });
    }

    const job = snapshot.data()!;

    if (
      job.userId !== uid &&
      req.user!.role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Acesso não autorizado ao job de vídeo.',
      });
    }

    if (job.status === 'processing') {
      try {
        const ai = getGenAIClient();

        const operation =
          await ai.operations.getVideosOperation({
            operation: job.operationName,
          });

        if (operation.done) {
          const videoUri =
            operation.response
              ?.generatedVideos?.[0]
              ?.video?.uri;

          if (!videoUri) {
            throw new Error(
              'A operação terminou sem retornar um vídeo válido.'
            );
          }

          const completedAt =
            new Date().toISOString();

          await docRef.update({
            status: 'completed',
            progress: 100,
            videoUrl: videoUri,
            completedAt,
            updatedAt: completedAt,
          });

          await CreditWalletService.confirmConsumption({
            userId: job.userId,
            reservationId: job.reservationId,
            amountConsumed:
              job.creditsReserved ||
              VIDEO_COSTS.lite,
            operation:
              `Geração de vídeo concluída (${job.quality || 'lite'})`,
            idempotencyKey:
              `consume-video-${jobId}`,
          });

          await adminDb
            .collection('media_generations')
            .doc(jobId)
            .set({
              id: jobId,
              userId: job.userId,
              type: 'video',
              prompt: job.prompt,
              url: videoUri,
              aspectRatio: job.aspectRatio,
              durationSeconds: job.durationSeconds,
              quality: job.quality || 'lite',
              model: job.model,
              status: 'completed',
              creditsSpent:
                job.creditsReserved ||
                VIDEO_COSTS.lite,
              createdAt: job.createdAt,
              completedAt,
              updatedAt: completedAt,
            });

          job.status = 'completed';
          job.progress = 100;
          job.videoUrl = videoUri;
          job.updatedAt = completedAt;
        } else {
          const currentProgress =
            Number(job.progress || 10);

          const nextProgress = Math.min(
            90,
            currentProgress + 10
          );

          await docRef.update({
            progress: nextProgress,
            pollFailures: 0,
            updatedAt: new Date().toISOString(),
          });

          job.progress = nextProgress;
        }
      } catch (error: any) {
        const pollFailures =
          Number(job.pollFailures || 0) + 1;

        console.warn(
          `Falha ${pollFailures} ao consultar vídeo ${jobId}:`,
          error?.message || error
        );

        if (pollFailures >= 3) {
          const failedAt = new Date().toISOString();

          await releaseVideoReservation({
            userId: job.userId,
            reservationId: job.reservationId,
            jobId,
            operation:
              'Estorno após falha definitiva na geração de vídeo',
          });

          await docRef.update({
            status: 'failed',
            progress: 0,
            pollFailures,
            error:
              error?.message ||
              'Falha ao consultar geração de vídeo.',
            failedAt,
            updatedAt: failedAt,
          });

          job.status = 'failed';
          job.progress = 0;
          job.error =
            error?.message ||
            'Falha ao consultar geração de vídeo.';
          job.updatedAt = failedAt;
        } else {
          await docRef.update({
            pollFailures,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    return res.json({
      jobId: job.id,
      status: job.status,
      progress: Number(job.progress || 0),
      videoUrl: job.videoUrl || null,
      quality: job.quality || 'lite',
      creditsReserved:
        Number(job.creditsReserved || 0),
      error: job.error || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  }
);

/**
 * POST /api/ai/media/video/:jobId/cancel
 */
mediaRouter.post(
  '/video/:jobId/cancel',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;
    const { jobId } = req.params;

    if (!adminDb) {
      return res.status(503).json({
        error: 'Banco de dados indisponível.',
      });
    }

    const docRef = adminDb
      .collection('media_jobs')
      .doc(jobId);

    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return res.status(404).json({
        error: 'Job de vídeo não encontrado.',
      });
    }

    const job = snapshot.data()!;

    if (
      job.userId !== uid &&
      req.user!.role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Acesso negado.',
      });
    }

    if (
      job.status === 'completed' ||
      job.status === 'cancelled' ||
      job.status === 'failed'
    ) {
      return res.json({
        success: true,
        status: job.status,
        message: 'O job já foi finalizado.',
      });
    }

    await releaseVideoReservation({
      userId: job.userId,
      reservationId: job.reservationId,
      jobId,
      operation:
        'Estorno por cancelamento manual de vídeo',
    });

    const updatedAt = new Date().toISOString();

    await docRef.set(
      {
        status: 'cancelled',
        progress: 0,
        cancelledAt: updatedAt,
        updatedAt,
      },
      {
        merge: true,
      }
    );

    return res.json({
      success: true,
      status: 'cancelled',
      message:
        'Renderização de vídeo cancelada com sucesso.',
    });
  }
);

/**
 * GET /api/ai/media/history
 */
mediaRouter.get(
  '/history',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;

    if (!adminDb) {
      return res.status(503).json({
        error: 'Banco de dados indisponível.',
      });
    }

    try {
      const snapshot = await adminDb
        .collection('media_generations')
        .where('userId', '==', uid)
        .limit(50)
        .get();

      const items = snapshot.docs
        .map((document) => document.data())
        .sort(
          (first, second) =>
            new Date(second.createdAt).getTime() -
            new Date(first.createdAt).getTime()
        );

      return res.json({
        items,
      });
    } catch (error: any) {
      console.error(
        'Erro ao carregar histórico de mídia:',
        error?.message || error
      );

      return res.status(500).json({
        error:
          'Não foi possível carregar o histórico de mídia.',
      });
    }
  }
);