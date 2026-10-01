import {
  GeminiProvider,
  GeminiProviderError,
} from './providers/geminiProvider.js';

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
  }>;
}

export interface IndependentVerificationResult {
  approved: boolean;
  revisedResponse?: string;
  reason: string;
  risks: string[];
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
    const model =
      process.env.INDEPENDENT_VERIFIER_MODEL ||
      'gemini-3.1-pro-preview';

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
          'Se não houver evidência suficiente para corrigir com segurança, não invente uma correção.',
          'Retorne somente JSON válido com approved, revisedResponse, reason e risks.',
        ].join('\n'),

        userMessage: JSON.stringify({
          originalPrompt: input.prompt,
          proposedResponse: input.response,
          domain: input.domain,
sensitivity: input.sensitivity,
researchStatus: input.researchStatus || 'not_requested',
ragStatus: input.ragStatus || 'not_requested',
citations: input.citations || [],
        }),
      });

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
      };
    } catch (error) {
      if (error instanceof GeminiProviderError) {
        return {
          approved: false,
          reason: error.message,
          risks: [error.code],
        };
      }

      return {
        approved: false,
        reason:
          'O verificador independente não conseguiu concluir a revisão.',
        risks: ['independent_verifier_failed'],
      };
    }
  }
}