import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth.js';
import { AuthenticatedRequest } from '../types.js';
import { CreditWalletService, InsufficientCreditsError } from '../services/creditWalletService.js';
import { validateAIAttachments } from '../validators/aiAttachmentValidators.js';

export const siteBuilderRouter = Router();

const ALLOWED_SITE_MODELS = new Set([
  'gemini-3.6-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
]);

const GENERATE_SITE_CREDIT_COST = 200;
const REFINE_SITE_CREDIT_COST = 50;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('A chave GEMINI_API_KEY não foi configurada nos Segredos.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function cleanMarkdownAndParseJson(rawText: string): any {
  if (!rawText) throw new Error('A IA não retornou conteúdo.');

  let cleaned = rawText.trim();
  // Strip ```json ... ``` or ``` ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Attempt regex extraction of first {...}
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Falha ao formatar resposta da IA em JSON válido.');
  }
}

const GeneratedSiteSchema = z.object({
  siteTitle: z.string().default('Novo Projeto Froc.IA'),
  description: z.string().default(''),
  html: z.string().min(1, 'HTML não pode ser vazio.'),
  suggestedRefinements: z.array(z.string()).default([]),
});

const RefinedSiteSchema = z.object({
  html: z.string().min(1, 'HTML não pode ser vazio.'),
  explanation: z.string().default('Projeto atualizado com sucesso!'),
  suggestedRefinements: z.array(z.string()).default([]),
});

// POST /api/generate-site
siteBuilderRouter.post('/generate-site', requireAuth, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const correlationId = req.correlationId;

  const {
    prompt,
    category = 'Geral',
    colorPalette = 'Modern Blue',
    tone = 'Profissional',
    features = [],
    language = 'pt-BR',
    modelName = 'gemini-3.6-flash',
    attachments: rawAttachments = []
  } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({
      error: {
        code: 'missing_prompt',
        message: 'O prompt do site é obrigatório.',
        correlationId,
      },
    });
  }

  if (!ALLOWED_SITE_MODELS.has(modelName)) {
    return res.status(400).json({
      error: {
        code: 'invalid_model',
        message: `O modelo de IA '${modelName}' não é permitido para geração de sites.`,
        correlationId,
      },
    });
  }

  let validatedAttachments;
  try {
    validatedAttachments = validateAIAttachments(rawAttachments);
  } catch (attErr: any) {
    return res.status(400).json({
      error: {
        code: 'invalid_attachments',
        message: attErr.issues ? attErr.issues[0] : 'Anexos inválidos.',
        correlationId,
      },
    });
  }

  const idempotencyKey = req.body.idempotencyKey || `gen-site-${uid}-${Date.now()}`;

  let reserveResult;
  try {
    reserveResult = await CreditWalletService.reserveCredits({
      userId: uid,
      amount: GENERATE_SITE_CREDIT_COST,
      operation: `Geração de Site com IA (${modelName})`,
      idempotencyKey,
    });
  } catch (reserveErr: any) {
    const isInsufficient = reserveErr instanceof InsufficientCreditsError;
    return res.status(isInsufficient ? 402 : 500).json({
      error: {
        code: isInsufficient ? 'insufficient_credits' : 'credit_reservation_failed',
        message: reserveErr.message || 'Erro ao reservar créditos para geração de site.',
        correlationId,
      },
    });
  }

  try {
    const ai = getGeminiClient();

    const systemInstruction = `Você é o Froc.IA Site Engine, especialista em design front-end, HTML5, Tailwind CSS, JavaScript e interfaces web modernas de altíssima conversão.
Responda ESTRITAMENTE em formato JSON com as chaves:
- "siteTitle": título curto e atrativo do projeto
- "description": breve resumo do site
- "html": o código HTML5 completo do site (incluindo <!DOCTYPE html>, <html>, <head>, <script src="https://cdn.tailwindcss.com"></script>, <body>)
- "suggestedRefinements": array com 3 sugestões de melhorias/personalizações que o usuário pode pedir a seguir.

IMPORTANTE: O código HTML retornado na chave "html" DEVE ser totalmente completo, autônomo e executável em um iframe seguro. Não omita tags ou seções.`;

    let userPrompt = `Crie um site completo para: "${prompt.trim()}".
Categoria: ${category}
Paleta de Cores: ${colorPalette}
Tom de Voz: ${tone}
Idioma: ${language}
Recursos Desejados: ${Array.isArray(features) ? features.join(', ') : features}`;

    if (validatedAttachments.length > 0) {
      userPrompt += `\n\nForam incluídos ${validatedAttachments.length} anexo(s) como contexto. Analise o conteúdo dos anexos para criar o site conforme instruído.`;
    }

    const contentsParts: any[] = [{ text: userPrompt }];

    for (const att of validatedAttachments) {
      if (att.mimeType.startsWith('image/') || att.mimeType.startsWith('audio/') || att.mimeType.startsWith('video/') || att.mimeType === 'application/pdf') {
        contentsParts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.data
          }
        });
      } else {
        const decodedText = Buffer.from(att.data, 'base64').toString('utf-8');
        contentsParts.push({
          text: `--- Anexo: ${att.name} (${att.mimeType}) ---\n${decodedText}\n--- Fim do Anexo ---`
        });
      }
    }

    const response = await ai.models.generateContent({
      model: modelName,
      contents: contentsParts,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    });

    const rawText = response.text || '';
    let parsedData = cleanMarkdownAndParseJson(rawText);

    // Validate structured response
    const validationResult = GeneratedSiteSchema.safeParse(parsedData);
    if (!validationResult.success) {
      // Retry once if schema validation fails
      const retryResponse = await ai.models.generateContent({
        model: modelName,
        contents: `Instrução: Corrija e retorne ESTRITAMENTE no formato JSON com "siteTitle", "description", "html" (código HTML completo) e "suggestedRefinements".\n\nTexto original:\n${rawText}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.3,
        },
      });
      parsedData = cleanMarkdownAndParseJson(retryResponse.text || '');
    }

    const finalData = GeneratedSiteSchema.parse(parsedData);

    await CreditWalletService.confirmConsumption({
      userId: uid,
      reservationId: reserveResult.reservationId,
      amountConsumed: GENERATE_SITE_CREDIT_COST,
      operation: `Geração de Site (${modelName})`,
      idempotencyKey: `cnf-${idempotencyKey}`,
    });

    return res.json({
      siteTitle: finalData.siteTitle,
      description: finalData.description,
      html: finalData.html,
      suggestedRefinements: finalData.suggestedRefinements,
      consumedCredits: GENERATE_SITE_CREDIT_COST,
      correlationId,
    });
  } catch (aiErr: any) {
    console.error('❌ Erro na geração de site:', aiErr);

    await CreditWalletService.releaseReservation({
      userId: uid,
      reservationId: reserveResult.reservationId,
      operation: `Estorno por falha na geração do site: ${aiErr.message}`,
      idempotencyKey: `rel-${idempotencyKey}`,
    });

    return res.status(500).json({
      error: {
        code: 'site_generation_failed',
        message: aiErr.message || 'Falha ao gerar o site com IA.',
        correlationId,
      },
    });
  }
});

// POST /api/refine-site
siteBuilderRouter.post('/refine-site', requireAuth, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const correlationId = req.correlationId;

  const {
    currentHtml,
    instructions,
    prompt: altPrompt,
    modelName = 'gemini-3.6-flash',
    attachments: rawAttachments = []
  } = req.body;

  const instructionText = (instructions || altPrompt || '').trim();

  if (!currentHtml || typeof currentHtml !== 'string') {
    return res.status(400).json({
      error: {
        code: 'missing_html',
        message: 'O HTML atual do projeto é obrigatório para refinamento.',
        correlationId,
      },
    });
  }

  if (!instructionText) {
    return res.status(400).json({
      error: {
        code: 'missing_instructions',
        message: 'A instrução de refinamento é obrigatória.',
        correlationId,
      },
    });
  }

  if (!ALLOWED_SITE_MODELS.has(modelName)) {
    return res.status(400).json({
      error: {
        code: 'invalid_model',
        message: `O modelo de IA '${modelName}' não é permitido.`,
        correlationId,
      },
    });
  }

  let validatedAttachments;
  try {
    validatedAttachments = validateAIAttachments(rawAttachments);
  } catch (attErr: any) {
    return res.status(400).json({
      error: {
        code: 'invalid_attachments',
        message: attErr.issues ? attErr.issues[0] : 'Anexos inválidos.',
        correlationId,
      },
    });
  }

  const idempotencyKey = req.body.idempotencyKey || `ref-site-${uid}-${Date.now()}`;

  let reserveResult;
  try {
    reserveResult = await CreditWalletService.reserveCredits({
      userId: uid,
      amount: REFINE_SITE_CREDIT_COST,
      operation: `Refinamento de Site (${modelName})`,
      idempotencyKey,
    });
  } catch (reserveErr: any) {
    const isInsufficient = reserveErr instanceof InsufficientCreditsError;
    return res.status(isInsufficient ? 402 : 500).json({
      error: {
        code: isInsufficient ? 'insufficient_credits' : 'credit_reservation_failed',
        message: reserveErr.message || 'Erro ao reservar créditos para refinamento.',
        correlationId,
      },
    });
  }

  try {
    const ai = getGeminiClient();

    const systemInstruction = `Você é o Froc.IA Site Refiner, especialista em alteração cirúrgica e aprimoramento de sites HTML/Tailwind.
Responda ESTRITAMENTE em formato JSON com as chaves:
- "html": o código HTML5 completo e atualizado do site com as alterações solicitadas.
- "explanation": breve explicação (1 a 2 frases em Português) das alterações realizadas.
- "suggestedRefinements": array de 3 próximas sugestões de refinamento.

ATENÇÃO: Preserve a estrutura e estilização geral do site, aplicando apenas as mudanças explicitamente solicitadas. Retorne o HTML completo.`;

    const userMessage = `Siga estas instruções de refinamento:
"${instructionText}"

--- HTML ATUAL DO SITE ---
${currentHtml}
--- FIM DO HTML ATUAL ---`;

    const contentsParts: any[] = [{ text: userMessage }];

    for (const att of validatedAttachments) {
      if (att.mimeType.startsWith('image/') || att.mimeType.startsWith('audio/') || att.mimeType.startsWith('video/') || att.mimeType === 'application/pdf') {
        contentsParts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.data
          }
        });
      } else {
        const decodedText = Buffer.from(att.data, 'base64').toString('utf-8');
        contentsParts.push({
          text: `--- Anexo para Refinamento: ${att.name} (${att.mimeType}) ---\n${decodedText}\n--- Fim do Anexo ---`
        });
      }
    }

    const response = await ai.models.generateContent({
      model: modelName,
      contents: contentsParts,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.5,
      },
    });

    const rawText = response.text || '';
    const parsedData = cleanMarkdownAndParseJson(rawText);
    const finalData = RefinedSiteSchema.parse(parsedData);

    await CreditWalletService.confirmConsumption({
      userId: uid,
      reservationId: reserveResult.reservationId,
      amountConsumed: REFINE_SITE_CREDIT_COST,
      operation: `Refinamento de Site (${modelName})`,
      idempotencyKey: `cnf-${idempotencyKey}`,
    });

    return res.json({
      html: finalData.html,
      explanation: finalData.explanation,
      suggestedRefinements: finalData.suggestedRefinements,
      consumedCredits: REFINE_SITE_CREDIT_COST,
      correlationId,
    });
  } catch (aiErr: any) {
    console.error('❌ Erro no refinamento de site:', aiErr);

    await CreditWalletService.releaseReservation({
      userId: uid,
      reservationId: reserveResult.reservationId,
      operation: `Estorno por falha no refinamento: ${aiErr.message}`,
      idempotencyKey: `rel-${idempotencyKey}`,
    });

    return res.status(500).json({
      error: {
        code: 'site_refinement_failed',
        message: aiErr.message || 'Falha ao refinar o site com IA.',
        correlationId,
      },
    });
  }
});
