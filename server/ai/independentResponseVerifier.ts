import {
  GeminiProvider,
  GeminiProviderError,
} from './providers/geminiProvider.js';

import { env } from '../config/env.js';

export interface IndependentVerificationInput {
  prompt: string;
  response: string;
  domain: string;
  sensitivity: string;
  researchStatus?: string;
  ragStatus?: string;
 citations?: Array<{
  title?: string;
  uri?: string;
  snippet?: string;
  domain?: string;
  supportedText?: string;
}>;
}

export interface IndependentVerificationResult {
  approved: boolean;
  revisedResponse?: string;
  reason: string;
  risks: string[];
  modelUsed?: string;
  inputTokens: number;
  outputTokens: number;
}

interface VerificationPayload {
  approved?: unknown;
  revisedResponse?: unknown;
  reason?: unknown;
  risks?: unknown;
}

function cleanRisks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is string =>
        typeof item === 'string'
    )
    .map((item) => item.trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 20);
}

export class IndependentResponseVerifier {
  static async verify(
    input: IndependentVerificationInput
  ): Promise<IndependentVerificationResult> {
    const model = env.INDEPENDENT_VERIFIER_MODEL;

    try {
      const result = await GeminiProvider.generate({
        model,
        responseFormat: 'json',
        temperature: 0.1,
        timeoutMs: 45_000,
        maxRetries: 1,

        systemInstruction: [
          'Você é o verificador independente da Froc.IA.',
          'Sua função é revisar criticamente a resposta produzida por outra IA.',
          'Não confie automaticamente na resposta original.',
          'Procure erros factuais, contradições, afirmações sem suporte, riscos de segurança e conclusões excessivamente confiantes.',
          'Quando houver citações, verifique se a resposta está compatível com a evidência fornecida.',
          'Considere também researchStatus e ragStatus: limited significa evidência parcial e unsupported significa ausência de sustentação suficiente.',
          'Nunca aprove como plenamente sustentada uma conclusão que dependa de evidência marcada como limited ou unsupported.',
          'Não invente fatos, fontes ou evidências.',
          'Não altere o sentido da pergunta do usuário.',
          'Se a resposta estiver correta e suficientemente sustentada, aprove.',
          'Se houver erro corrigível, forneça revisedResponse completa.',
          'A revisedResponse deve usar somente fatos sustentados pelo prompt original, pela resposta já validável e pelas evidências/citações fornecidas.',
          'Não introduza nomes, números, datas, versões, links, eventos ou conclusões factuais novas que não estejam sustentadas pela evidência recebida.',
          'Se não houver evidência suficiente para corrigir com segurança, não invente uma correção.',
          'Retorne somente JSON válido com approved, revisedResponse, reason e risks.',
        ].join('\n'),

        userMessage: JSON.stringify({
          originalPrompt: input.prompt,
          proposedResponse: input.response,
          domain: input.domain,
          sensitivity: input.sensitivity,
          researchStatus:
            input.researchStatus || 'not_requested',
          ragStatus:
            input.ragStatus || 'not_requested',
          citations: input.citations || [],
        }),
      });

      const usage = {
        modelUsed: model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };

      let parsed: VerificationPayload;

      try {
        parsed = JSON.parse(
          result.text.replace(
            /^```json\s*|\s*```$/g,
            ''
          )
        );
      } catch {
        return {
          approved: false,
          reason:
            'O verificador independente retornou uma resposta inválida.',
          risks: [
            'independent_verifier_invalid_json',
          ],
          ...usage,
        };
      }

      const approved =
        parsed.approved === true;

      const revisedResponse =
        typeof parsed.revisedResponse === 'string'
          ? parsed.revisedResponse.trim()
          : '';

      const reason =
        typeof parsed.reason === 'string'
          ? parsed.reason.trim().slice(0, 2000)
          : '';

      const risks = cleanRisks(parsed.risks);

      if (approved) {
        return {
          approved: true,
          reason:
            reason ||
            'Resposta aprovada pelo verificador independente.',
          risks,
          ...usage,
        };
      }

      if (revisedResponse.length > 0) {
        return {
          approved: false,
          revisedResponse,
          reason:
            reason ||
            'Resposta revisada pelo verificador independente.',
          risks,
          ...usage,
        };
      }

      return {
        approved: false,
        reason:
          reason ||
          'A resposta não pôde ser validada com segurança.',
        risks:
          risks.length > 0
            ? risks
            : ['independent_verification_failed'],
        ...usage,
      };
    } catch (error) {
      if (error instanceof GeminiProviderError) {
        return {
          approved: false,
          reason: error.message,
          risks: [error.code],
          inputTokens: 0,
          outputTokens: 0,
        };
      }

      return {
        approved: false,
        reason:
          'O verificador independente não conseguiu concluir a revisão.',
        risks: [
          'independent_verifier_failed',
        ],
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }
}