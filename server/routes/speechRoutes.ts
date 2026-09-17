import { Router } from 'express';
import { z } from 'zod';
import { NeuralSpeechService } from '../ai/neuralSpeechService.js';
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
  text: z.string().trim().min(1).max(5000),
});

speechRouter.post('/', requireAuth, speechLimiter, async (req: AuthenticatedRequest, res) => {
  const parsed = speechSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: 'invalid_speech_request',
        message: 'O texto para voz é inválido ou excede o limite permitido.',
        correlationId: req.correlationId,
      },
    });
  }
  try {
    const result = await NeuralSpeechService.synthesize(parsed.data.text);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(result);
  } catch (error) {
    console.error('Falha na voz neural:', {
      correlationId: req.correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(503).json({
      error: {
        code: 'neural_speech_unavailable',
        message: 'A voz neural está temporariamente indisponível.',
        correlationId: req.correlationId,
      },
    });
  }
});
