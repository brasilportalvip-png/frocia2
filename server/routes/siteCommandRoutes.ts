import { Router } from 'express';
import { z } from 'zod';
import {
  acceptModelInterpretation,
  buildInterpretInstruction,
  getSiteCommand,
  parseSiteCommand,
} from '../../shared/siteCommandCatalog.js';
import { GeminiProvider } from '../ai/providers/geminiProvider.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import type { AuthenticatedRequest } from '../types.js';

/**
 * Central de Comandos do Site — interpretação de frases livres.
 *
 * O navegador já entende sozinho os comandos comuns. Quando a frase é uma ordem
 * fora do padrão ("dá um jeito de me mostrar onde ficam meus backups"), esta rota
 * pede à IA para escolher UMA ação do catálogo. Segurança:
 *  - o catálogo enviado à IA é filtrado pelo papel verificado no servidor;
 *  - a resposta só é aceita se o id existir no catálogo e for permitido ao papel;
 *  - a rota apenas interpreta: quem executa é a interface, e cada API continua
 *    exigindo autenticação/admin no próprio servidor.
 */
export const siteCommandRouter = Router();

const limiter = createRateLimiter({ windowMs: 60_000, max: 40, keyPrefix: 'site-command-interpret' });

const bodySchema = z.object({ text: z.string().trim().min(1).max(300) });

const responseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'id do comando escolhido ou "none"' },
    name: { type: 'string', description: 'nome/número do item citado (conversa ou projeto), se houver' },
    value: { type: 'string', description: 'um dos valores permitidos do comando, se houver' },
    confidence: { type: 'number', description: 'de 0 a 1' },
  },
  required: ['id', 'confidence'],
};

siteCommandRouter.post('/interpret', requireAuth, limiter, async (req: AuthenticatedRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const parsedBody = bodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: { code: 'invalid_text', message: 'Frase inválida.' } });
  }
  const isAdmin = req.user?.role === 'admin';
  const text = parsedBody.data.text;

  // Primeiro o interpretador local (sem custo).
  const local = parseSiteCommand(text);
  if (local && !local.id.startsWith('confirm.')) {
    const definition = getSiteCommand(local.id);
    if (definition && (definition.audience !== 'admin' || isAdmin)) {
      return res.json({ command: { id: local.id, params: local.params }, source: 'local' });
    }
    return res.json({ command: null, source: 'local' });
  }

  if (!process.env.GEMINI_API_KEY) return res.json({ command: null, source: 'unavailable' });

  try {
    const response = await GeminiProvider.generate({
      model: process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite',
      systemInstruction: buildInterpretInstruction(isAdmin),
      userMessage: `Frase: "${text.replace(/"/g, "'")}"`,
      responseFormat: 'json',
      jsonSchema: responseSchema,
      temperature: 0,
      timeoutMs: 8000,
      maxRetries: 1,
      maxOutputTokens: 200,
    });
    let json: unknown = null;
    try { json = JSON.parse(response.text || 'null'); } catch { json = null; }
    const command = acceptModelInterpretation(json, isAdmin);
    return res.json({ command, source: 'ai' });
  } catch (error) {
    console.warn('site_command_interpret_failed', {
      correlationId: req.correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.json({ command: null, source: 'error' });
  }
});
