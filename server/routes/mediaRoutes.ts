import { Router } from 'express';
import { Readable } from 'node:stream';
import { GoogleGenAI } from '@google/genai';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { SafetyService } from '../ai/safetyService.js';
import { CreditWalletService } from '../services/creditWalletService.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { FeatureFlagService } from '../services/featureFlagService.js';

export const mediaRouter = Router();

type ImageAspectRatio = '1:1' | '4:3' | '16:9';
type VideoAspectRatio = '9:16' | '16:9';
type VideoQuality = 'lite' | 'fast' | 'standard';
type VideoDuration = 4 | 6 | 8;

const IMAGE_COST = 18;

const VIDEO_COSTS: Record<VideoQuality, number> = {
  lite: 30,
  fast: 46,
  standard: 120,
};

const IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL ||
  'gemini-3.1-flash-image';

const VIDEO_MODELS: Record<VideoQuality, string> = {
  lite:
    process.env.VEO_LITE_MODEL ||
    'veo-3.1-lite-generate-preview',
  fast:
    process.env.VEO_FAST_MODEL ||
    'veo-3.1-fast-generate-preview',
  standard:
    process.env.VEO_STANDARD_MODEL ||
    'veo-3.1-generate-preview',
};

function getMediaApiKey(): string {
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

  return apiKey.trim();
}

function getGenAIClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: getMediaApiKey(),
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
  return value === '9:16' ? '9:16' : '16:9';
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
): VideoDuration {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 8;
  }

  if (parsed <= 4) {
    return 4;
  }

  if (parsed <= 6) {
    return 6;
  }

  return 8;
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

async function cancelProviderVideoOperation(
  operationName: string
): Promise<boolean> {
  if (
    !operationName ||
    !/^[A-Za-z0-9._/-]+$/.test(operationName)
  ) {
    return false;
  }

  const normalizedOperation =
    operationName.replace(/^\/+/, '');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${normalizedOperation}:cancel`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': getMediaApiKey(),
      },
      body: '{}',
    }
  );

  return response.ok;
}

/**
 * POST /api/ai/media/image
 *
 * Executa geração real de imagem com Gemini 3.1 Flash Image.
 * Não cria SVG, placeholder ou resultado fictício.
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

    const safety = SafetyService.inspectPrompt(prompt);

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
      getGenAIClient();

      const reservation =
        await CreditWalletService.reserveCredits({
          userId: uid,
          amount: IMAGE_COST,
          operation: 'Reserva para geração de imagem IA',
          idempotencyKey: `res-${key}`,
        });

      reservationId = reservation.reservationId;

      const ai = getGenAIClient();

      const interaction =
        await ai.interactions.create({
          model: IMAGE_MODEL,
          input: sanitizedPrompt,
          response_format: {
            type: 'image',
            mime_type: 'image/jpeg',
            aspect_ratio: aspectRatio,
            image_size: '2K',
          },
        });

      const generatedImage =
        interaction.output_image;

      const imageBytes = generatedImage?.data;

      if (!imageBytes) {
        throw new Error(
          'O provedor não retornou uma imagem válida.'
        );
      }

      const mimeType =
        generatedImage.mime_type || 'image/jpeg';

      const imageDataUrl =
        `data:${mimeType};base64,${imageBytes}`;

      const docId =
        `img_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 9)}`;

      const createdAt = new Date().toISOString();

      /*
       * O Base64 não é gravado no Firestore porque documentos possuem
       * limite de tamanho. A imagem é devolvida diretamente ao navegador.
       */
      const mediaRecord = {
        id: docId,
        userId: uid,
        type: 'image',
        prompt: sanitizedPrompt,
        aspectRatio,
        resolution: '2K',
        mimeType,
        model: IMAGE_MODEL,
        status: 'completed',
        storageStatus: 'temporary_browser_delivery',
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
 * Inicia um job real no Veo 3.1 correspondente à qualidade escolhida.
 */
mediaRouter.post(
  '/video',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;

    const {
      prompt,
      aspectRatio: requestedAspectRatio = '16:9',
      durationSeconds: requestedDuration = 8,
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

    const safety = SafetyService.inspectPrompt(prompt);

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
    const selectedModel = VIDEO_MODELS[quality];

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
          model: selectedModel,
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
        model: selectedModel,
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
        model: selectedModel,
        durationSeconds,
        aspectRatio,
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
        


const normalizedOperationName = String(
  job.operationName
).replace(/^\/+/, '');

const operationResponse = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/${normalizedOperationName}`,
  {
    method: 'GET',
    headers: {
      'x-goog-api-key': getMediaApiKey(),
    },
  }
);

if (!operationResponse.ok) {
  const providerError =
    await operationResponse.text();

  throw new Error(
    `Falha ao consultar operação do vídeo: HTTP ${operationResponse.status} — ${providerError}`
  );
}

const operation = await operationResponse.json() as {
  done?: boolean;
  response?: {
  generatedVideos?: Array<{
    video?: {
      uri?: string;
    };
  }>;
  generateVideoResponse?: {
    generatedSamples?: Array<{
      video?: {
        uri?: string;
      };
    }>;
  };
};
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

if (operation.error) {
  throw new Error(
    operation.error.message ||
    'O provedor informou falha na geração do vídeo.'
  );
}




        if (operation.done) {
          const videoUri =
  operation.response
    ?.generateVideoResponse
    ?.generatedSamples?.[0]
    ?.video?.uri ||
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
              storageStatus:
                'temporary_provider_delivery',
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
      videoUrl: null,
      quality: job.quality || 'lite',
      model: job.model || null,
      durationSeconds:
        Number(job.durationSeconds || 0),
      aspectRatio: job.aspectRatio || '16:9',
      creditsReserved:
        Number(job.creditsReserved || 0),
      error: job.error || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  }
);





/**
 * GET /api/ai/media/video/:jobId/content
 *
 * Entrega o MP4 pelo backend sem expor a chave ou a URL privada do Google.
 */
mediaRouter.get(
  '/video/:jobId/content',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;
    const { jobId } = req.params;

    if (!adminDb) {
      return res.status(503).json({
        error: 'Banco de dados indisponível.',
      });
    }

    const snapshot = await adminDb
      .collection('media_jobs')
      .doc(jobId)
      .get();

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
        error: 'Acesso não autorizado ao vídeo.',
      });
    }

    if (
      job.status !== 'completed' ||
      typeof job.videoUrl !== 'string' ||
      !job.videoUrl
    ) {
      return res.status(409).json({
        error: 'O vídeo ainda não está disponível.',
      });
    }

    let providerUrl: URL;

    try {
      providerUrl = new URL(job.videoUrl);
    } catch {
      return res.status(502).json({
        error:
          'O provedor retornou uma URL de vídeo inválida.',
      });
    }

    if (
      providerUrl.protocol !== 'https:' ||
      providerUrl.hostname !==
        'generativelanguage.googleapis.com' ||
      !providerUrl.pathname.startsWith(
        '/v1beta/files/'
      )
    ) {
      return res.status(502).json({
        error: 'A origem do vídeo não é permitida.',
      });
    }

    try {
      const providerResponse = await fetch(
        providerUrl,
        {
          method: 'GET',
          headers: {
            'x-goog-api-key': getMediaApiKey(),
          },
        }
      );

      if (
        !providerResponse.ok ||
        !providerResponse.body
      ) {
        const providerError =
          await providerResponse.text();

        return res.status(502).json({
          error:
            `Não foi possível baixar o vídeo do provedor: HTTP ${providerResponse.status} — ${providerError}`,
        });
      }

      res.status(200);

      res.setHeader(
        'Content-Type',
        providerResponse.headers.get(
          'content-type'
        ) || 'video/mp4'
      );

      res.setHeader(
        'Content-Disposition',
        `inline; filename="frocia-video-${jobId}.mp4"`
      );

      res.setHeader(
        'Cache-Control',
        'private, no-store, max-age=0'
      );

      res.setHeader(
        'X-Content-Type-Options',
        'nosniff'
      );

      const contentLength =
        providerResponse.headers.get(
          'content-length'
        );

      if (contentLength) {
        res.setHeader(
          'Content-Length',
          contentLength
        );
      }

      const stream = Readable.fromWeb(
        providerResponse.body as any
      );

      stream.on('error', (error) => {
        console.error(
          `Falha ao transmitir vídeo ${jobId}:`,
          error
        );

        if (!res.headersSent) {
          res.status(502).json({
            error:
              'Falha durante a transmissão do vídeo.',
          });
        } else {
          res.destroy(error as Error);
        }
      });

      stream.pipe(res);
      return;
    } catch (error: any) {
      console.error(
        `Erro ao entregar vídeo ${jobId}:`,
        error?.message || error
      );

      if (!res.headersSent) {
        return res.status(502).json({
          error:
            'Não foi possível entregar o vídeo neste momento.',
        });
      }

      return res.end();
    }
  }
);





/**
 * POST /api/ai/media/video/:jobId/cancel
 *
 * Só devolve os créditos se o provedor confirmar o cancelamento.
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

    let providerCancelled = false;

    try {
      providerCancelled =
        await cancelProviderVideoOperation(
          job.operationName
        );
    } catch (error: any) {
      console.warn(
        'O provedor recusou o cancelamento do vídeo:',
        error?.message || error
      );
    }

    if (!providerCancelled) {
      return res.status(409).json({
        success: false,
        status: 'processing',
        message:
          'O provedor não confirmou o cancelamento. A geração continuará e os créditos não foram devolvidos para evitar prejuízo financeiro.',
      });
    }

    await releaseVideoReservation({
      userId: job.userId,
      reservationId: job.reservationId,
      jobId,
      operation:
        'Estorno após cancelamento confirmado pelo provedor',
    });

    const updatedAt = new Date().toISOString();

    await docRef.set(
      {
        status: 'cancelled',
        progress: 0,
        providerCancelled: true,
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
        'Renderização cancelada e créditos devolvidos.',
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