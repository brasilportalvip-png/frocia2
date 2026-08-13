import { apiClient } from './apiClient';

export type ImageAspectRatio =
  | '1:1'
  | '4:3'
  | '16:9';

export type VideoAspectRatio =
  | '9:16'
  | '16:9';

export type VideoDuration = 4 | 6 | 8;

export type VideoQuality =
  | 'lite'
  | 'fast'
  | 'standard';

export interface GeneratedImage {
  id: string;
  type: 'image';
  prompt: string;
  url: string;
  aspectRatio: ImageAspectRatio;
  mimeType: 'image/jpeg';
  model: string;
  status: 'completed';
  creditsSpent: number;
  createdAt: string;
}

export interface VideoJob {
  jobId: string;
  status:
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled';
  progress: number;
  videoUrl: string | null;
  quality: VideoQuality;
  model?: string | null;
  durationSeconds?: VideoDuration;
  aspectRatio?: VideoAspectRatio;
  creditsReserved: number;
  error: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MediaHistoryItem {
  id: string;
  type: 'image' | 'video';
  prompt: string;
  url?: string | null;
  status: string;
  creditsSpent?: number;
  createdAt: string;
}

interface GenerateImageInput {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  idempotencyKey?: string;
}

interface StartVideoInput {
  prompt: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds: VideoDuration;
  quality: VideoQuality;
  idempotencyKey?: string;
}

function createIdempotencyKey(
  prefix: string
): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 12)}`;
}

function fileExtensionFromMimeType(
  mimeType: string
): string {
  return mimeType === 'image/png'
    ? 'png'
    : 'jpg';
}

export class MediaGenerationService {
  static async generateImage(
    input: GenerateImageInput
  ): Promise<GeneratedImage> {
    const result = await apiClient<{
      success: boolean;
      media: GeneratedImage;
    }>('/api/ai/media/image', {
      method: 'POST',
      body: JSON.stringify({
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        idempotencyKey:
          input.idempotencyKey ||
          createIdempotencyKey('image'),
      }),
    });

    if (
      !result?.success ||
      !result.media?.url
    ) {
      throw new Error(
        'O servidor não retornou uma imagem válida.'
      );
    }

    return result.media;
  }

  static async startVideo(
    input: StartVideoInput
  ): Promise<VideoJob> {
    const result = await apiClient<{
      success: boolean;
      jobId: string;
      status: 'processing';
      progress: number;
      quality: VideoQuality;
      model: string;
      durationSeconds: VideoDuration;
      aspectRatio: VideoAspectRatio;
      creditsReserved: number;
    }>('/api/ai/media/video', {
      method: 'POST',
      body: JSON.stringify({
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
        quality: input.quality,
        idempotencyKey:
          input.idempotencyKey ||
          createIdempotencyKey('video'),
      }),
    });

    if (
      !result?.success ||
      !result.jobId
    ) {
      throw new Error(
        'O servidor não iniciou o vídeo corretamente.'
      );
    }

    return {
      jobId: result.jobId,
      status: result.status,
      progress: result.progress,
      videoUrl: null,
      quality: result.quality,
      model: result.model,
      durationSeconds: result.durationSeconds,
      aspectRatio: result.aspectRatio,
      creditsReserved: result.creditsReserved,
      error: null,
    };
  }

  static async getVideoJob(
    jobId: string
  ): Promise<VideoJob> {
    if (!jobId) {
      throw new Error(
        'Identificador do vídeo inválido.'
      );
    }

    return apiClient<VideoJob>(
      `/api/ai/media/video/${encodeURIComponent(jobId)}`
    );
  }

  static async waitForVideo(
    jobId: string,
    options?: {
      intervalMs?: number;
      timeoutMs?: number;
      signal?: AbortSignal;
      onProgress?: (job: VideoJob) => void;
    }
  ): Promise<VideoJob> {
    const intervalMs =
      options?.intervalMs ?? 5000;

    const timeoutMs =
      options?.timeoutMs ?? 10 * 60 * 1000;

    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (options?.signal?.aborted) {
        throw new DOMException(
          'Acompanhamento cancelado.',
          'AbortError'
        );
      }

      const job =
        await this.getVideoJob(jobId);

      options?.onProgress?.(job);

      if (job.status === 'completed') {
        if (!job.videoUrl) {
          throw new Error(
            'O vídeo foi concluído sem uma URL válida.'
          );
        }

        return job;
      }

      if (job.status === 'failed') {
        throw new Error(
          job.error ||
          'A geração do vídeo falhou.'
        );
      }

      if (job.status === 'cancelled') {
        throw new Error(
          'A geração do vídeo foi cancelada.'
        );
      }

      await new Promise<void>(
        (resolve, reject) => {
          const timeoutId = window.setTimeout(
            resolve,
            intervalMs
          );

          const abortHandler = () => {
            window.clearTimeout(timeoutId);

            reject(
              new DOMException(
                'Acompanhamento cancelado.',
                'AbortError'
              )
            );
          };

          options?.signal?.addEventListener(
            'abort',
            abortHandler,
            {
              once: true,
            }
          );
        }
      );
    }

    throw new Error(
      'O vídeo excedeu o tempo máximo de processamento.'
    );
  }

  static async cancelVideo(
    jobId: string
  ): Promise<{
    success: boolean;
    status: string;
    message: string;
  }> {
    if (!jobId) {
      throw new Error(
        'Identificador do vídeo inválido.'
      );
    }

    return apiClient(
      `/api/ai/media/video/${encodeURIComponent(jobId)}/cancel`,
      {
        method: 'POST',
      }
    );
  }

  static async getHistory(): Promise<
    MediaHistoryItem[]
  > {
    const result = await apiClient<{
      items: MediaHistoryItem[];
    }>('/api/ai/media/history');

    return Array.isArray(result?.items)
      ? result.items
      : [];
  }

  static downloadImage(
    image: GeneratedImage
  ): void {
    const anchor =
      document.createElement('a');

    const extension =
      fileExtensionFromMimeType(image.mimeType);

    anchor.href = image.url;
    anchor.download =
      `frocia-imagem-${image.id}.${extension}`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
}