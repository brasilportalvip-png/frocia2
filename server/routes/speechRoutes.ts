import { Router } from 'express';
import { z } from 'zod';
import {
  NEURAL_SPEECH_CHANNELS,
  NEURAL_SPEECH_SAMPLE_RATE,
  NeuralSpeechService,
} from '../ai/neuralSpeechService.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';

export const speechRouter = Router();

const speechLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  keyPrefix: 'neural-speech',
});

const speechSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(5000),
});

/**
 * Emite um token temporário para o reconhecimento
 * de voz em tempo real do Froc.IA.
 *
 * A chave Gemini permanece somente no servidor.
 * O modelo Live transcreve, mas não substitui
 * a inteligência nem a voz neural original.
 */
speechRouter.post(
  '/live-token',
  requireAuth,
  speechLimiter,
  async (req: AuthenticatedRequest, res) => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    res.setHeader('Cache-Control', 'no-store');

    if (!apiKey) {
      return res.status(503).json({
        error: {
          code: 'live_voice_not_configured',
          message: 'Reconhecimento em tempo real indisponível.',
          correlationId: req.correlationId,
        },
      });
    }

    const model = 'gemini-3.5-transcribe-live';
    const expiresAt = new Date(
      Date.now() + 30 * 60 * 1000
    ).toISOString();

    const newSessionExpiresAt = new Date(
      Date.now() + 60 * 1000
    ).toISOString();

    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/auth_tokens',
        {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            uses: 1,
            expireTime: expiresAt,
            newSessionExpireTime: newSessionExpiresAt,
          }),
        }
      );

         if (!response.ok) {
        const providerBody = await response.json().catch(() => null) as {
          error?: {
            code?: number;
            status?: string;
            message?: string;
          };
        } | null;

        const providerError = providerBody?.error;

        const safeMessage =
          typeof providerError?.message === 'string'
            ? providerError.message
                .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]')
                .slice(0, 500)
            : 'O Google não forneceu detalhes do erro.';

        console.error('live_voice_token_provider_error', {
          status: response.status,
          providerCode: providerError?.code,
          providerStatus: providerError?.status,
          providerMessage: safeMessage,
          correlationId: req.correlationId,
        });

        return res.status(503).json({
          error: {
            code: 'live_voice_token_unavailable',
            message: 'Não foi possível iniciar a escuta em tempo real.',
            correlationId: req.correlationId,
          },
        });
      }

      const result = await response.json() as {
        name?: string;
      };

      if (!result.name) {
        throw new Error('live_voice_token_missing');
      }

      return res.status(200).json({
        token: result.name,
        model,
        expiresAt,
      });
    } catch (error) {
      console.error('live_voice_token_error', {
        message: error instanceof Error
          ? error.message
          : 'unknown_error',
        correlationId: req.correlationId,
      });

      return res.status(503).json({
        error: {
          code: 'live_voice_connection_failed',
          message: 'A conexão de voz não pôde ser preparada.',
          correlationId: req.correlationId,
        },
      });
    }
  }
);

/**
 * POST /api/ai/speech
 *
 * Modo tradicional.
 * Continua existindo como fallback e preserva
 * exatamente o comportamento de voz já usado.
 */
speechRouter.post(
  '/',
  requireAuth,
  speechLimiter,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    const parsed =
      speechSchema.safeParse(
        req.body
      );

    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code:
            'invalid_speech_request',
          message:
            'O texto para voz é inválido ou excede o limite permitido.',
          correlationId:
            req.correlationId,
        },
      });
    }

    try {
      const result =
        await NeuralSpeechService.synthesize(
          parsed.data.text
        );

      res.setHeader(
        'Cache-Control',
        'private, no-store'
      );

      return res.json(
        result
      );
    } catch (error) {
      console.error(
        'Falha na voz neural:',
        {
          correlationId:
            req.correlationId,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        }
      );

      return res
        .status(503)
        .json({
          error: {
            code:
              'neural_speech_unavailable',
            message:
              'A voz neural está temporariamente indisponível.',
            correlationId:
              req.correlationId,
          },
        });
    }
  }
);

/**
 * POST /api/ai/speech/stream
 *
 * Novo modo de baixa latência.
 *
 * O Gemini entrega PCM 16-bit
 * enquanto ainda sintetiza o restante.
 *
 * Formato:
 * - PCM linear assinado
 * - 16 bits
 * - little-endian
 * - 24 kHz
 * - mono
 *
 * A rota antiga continua disponível
 * como fallback.
 */
speechRouter.post(
  '/stream',
  requireAuth,
  speechLimiter,
  async (
    req: AuthenticatedRequest,
    res
  ) => {
    const parsed =
      speechSchema.safeParse(
        req.body
      );

    if (!parsed.success) {
      return res
        .status(400)
        .json({
          error: {
            code:
              'invalid_speech_request',
            message:
              'O texto para voz é inválido ou excede o limite permitido.',
            correlationId:
              req.correlationId,
          },
        });
    }

    let streamStarted =
      false;

    let clientDisconnected =
      false;

   res.once(
  'close',
  () => {
    clientDisconnected =
      true;
  }
);

    try {
      res.status(200);

      res.setHeader(
        'Content-Type',
        'audio/L16'
      );

      res.setHeader(
        'Cache-Control',
        'private, no-store, no-transform'
      );

      res.setHeader(
        'X-Content-Type-Options',
        'nosniff'
      );

      res.setHeader(
        'X-Froc-Audio-Format',
        'pcm-s16le'
      );

      res.setHeader(
        'X-Froc-Audio-Sample-Rate',
        String(
          NEURAL_SPEECH_SAMPLE_RATE
        )
      );

      res.setHeader(
        'X-Froc-Audio-Channels',
        String(
          NEURAL_SPEECH_CHANNELS
        )
      );

      res.setHeader(
        'X-Accel-Buffering',
        'no'
      );

      if (
        typeof res.flushHeaders ===
        'function'
      ) {
        res.flushHeaders();
      }

      const stream =
        NeuralSpeechService
          .synthesizeStream(
            parsed.data.text
          );

      for await (
        const chunk of stream
      ) {
        if (
          clientDisconnected ||
          res.writableEnded ||
          res.destroyed
        ) {
          break;
        }

        if (
          !chunk.audio.length
        ) {
          continue;
        }

        streamStarted =
          true;

        const canContinue =
          res.write(
            chunk.audio
          );

        if (!canContinue) {
          await new Promise<void>(
            (
              resolve,
              reject
            ) => {
              const cleanup =
                () => {
                  res.off(
                    'drain',
                    handleDrain
                  );

                  res.off(
                    'close',
                    handleClose
                  );

                  res.off(
                    'error',
                    handleError
                  );
                };

              const handleDrain =
                () => {
                  cleanup();
                  resolve();
                };

              const handleClose =
                () => {
                  cleanup();
                  resolve();
                };

              const handleError =
                (
                  error: Error
                ) => {
                  cleanup();
                  reject(
                    error
                  );
                };

              res.once(
                'drain',
                handleDrain
              );

              res.once(
                'close',
                handleClose
              );

              res.once(
                'error',
                handleError
              );
            }
          );
        }
      }

      if (
        !res.writableEnded &&
        !res.destroyed
      ) {
        res.end();
      }
    } catch (error) {
      console.error(
        'Falha no streaming da voz neural:',
        {
          correlationId:
            req.correlationId,
          streamStarted,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        }
      );

      if (
        res.writableEnded ||
        res.destroyed
      ) {
        return;
      }

      /*
       * Se nenhum áudio ainda foi entregue,
       * ainda podemos retornar um erro JSON
       * normal para permitir fallback.
       */
      if (!streamStarted) {
        if (
          !res.headersSent
        ) {
          return res
            .status(503)
            .json({
              error: {
                code:
                  'neural_speech_stream_unavailable',
                message:
                  'O streaming de voz está temporariamente indisponível.',
                correlationId:
                  req.correlationId,
              },
            });
        }

        res.end();
        return;
      }

      /*
       * Se o áudio já começou, não podemos
       * trocar a resposta para JSON.
       * Apenas encerramos o fluxo.
       */
      res.end();
    }
  }
);