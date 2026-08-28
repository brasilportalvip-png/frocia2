import {
  KnowledgeChunk,
  MessageCitation,
  RequestSensitivity,
} from './types/ai.js';

export type EvidenceStatus =
  | 'not_requested'
  | 'supported'
  | 'limited'
  | 'unsupported';

export interface EvidenceAssessment {
  text: string;
  citations: MessageCitation[];
  researchStatus: EvidenceStatus;
  ragStatus: EvidenceStatus;
  sourceCount: number;
  sourceDomains: string[];
}

interface FinalizeEvidenceInput {
  text: string;
  citations: MessageCitation[];
  requiresSearch: boolean;
  sensitivity: RequestSensitivity;
  knowledgeBaseRequested: boolean;
  ragChunksUsed: KnowledgeChunk[];
  minimumSourceDomains?: number;
}

const NO_RESEARCH_EVIDENCE =
  'Não consegui confirmar esta resposta com fontes atuais verificáveis. Para não apresentar informação possivelmente desatualizada como fato, não vou afirmar uma conclusão sem evidência. Tente reformular a pesquisa ou consulte uma fonte oficial diretamente.';

const NO_RAG_EVIDENCE =
  'Não encontrei trechos relevantes nos documentos da base de conhecimento selecionada. Para não inventar uma resposta, preciso de um documento que sustente essa informação ou de uma pergunta mais específica.';

const LIMITED_HIGH_STAKES_EVIDENCE =
  'A pesquisa encontrou evidência limitada para um tema sensível. Confirme a informação em outra fonte oficial ou com um profissional qualificado antes de tomar uma decisão.';

const LIMITED_DEEP_RESEARCH_EVIDENCE =
  'A pesquisa profunda encontrou menos fontes independentes do que o mínimo esperado. A resposta acima é parcial e não representa cobertura completa da internet.';

function uniqueDomains(
  citations: MessageCitation[]
): string[] {
  return [
    ...new Set(
      citations
        .filter(
          (citation) =>
            citation.sourceType === 'web' ||
            citation.sourceType === 'social'
        )
        .map((citation) => citation.domain || '')
        .filter(Boolean)
    ),
  ];
}

export class ResearchEvidenceService {
  static finalize(
    input: FinalizeEvidenceInput
  ): EvidenceAssessment {
    const webCitations = input.citations.filter(
      (citation) =>
        citation.sourceType === 'web' ||
        citation.sourceType === 'social'
    );
    const sourceDomains = uniqueDomains(webCitations);

    let researchStatus: EvidenceStatus =
      'not_requested';
    let ragStatus: EvidenceStatus = 'not_requested';
    let finalText = input.text.trim();

    if (input.requiresSearch) {
      if (webCitations.length === 0) {
        researchStatus = 'unsupported';
        finalText = NO_RESEARCH_EVIDENCE;
      } else if (
        input.sensitivity === 'high-stakes' &&
        sourceDomains.length < 2
      ) {
        researchStatus = 'limited';
        finalText = `${finalText}\n\n${LIMITED_HIGH_STAKES_EVIDENCE}`;
      } else if (
        sourceDomains.length < Math.max(1, input.minimumSourceDomains || 1)
      ) {
        researchStatus = 'limited';
        finalText = `${finalText}\n\n${LIMITED_DEEP_RESEARCH_EVIDENCE}`;
      } else {
        researchStatus = 'supported';
      }
    }

    if (input.knowledgeBaseRequested) {
      if (input.ragChunksUsed.length === 0) {
        ragStatus = 'unsupported';

        if (researchStatus !== 'unsupported') {
          finalText = NO_RAG_EVIDENCE;
        }
      } else {
        ragStatus = 'supported';
      }
    }

    return {
      text: finalText,
      citations: input.citations,
      researchStatus,
      ragStatus,
      sourceCount: webCitations.length,
      sourceDomains,
    };
  }
}
