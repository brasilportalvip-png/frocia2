import {
  AIMode,
  RequestClassification,
  SpecialistDomain,
} from './types/ai.js';

interface ClassificationInput {
  mode: AIMode;
  prompt: string;
  hasFiles?: boolean;
  requestedTools?: string[];
  contextSizeEstimate?: number;
}

const DOMAIN_PATTERNS: Array<{
  domain: SpecialistDomain;
  pattern: RegExp;
}> = [
  {
    domain: 'health',
    pattern:
      /\b(sa[uú]de|m[eé]dic[oa]|doen[çc]a|sintoma|diagn[oó]stico|tratamento|rem[eé]dio|medicamento|dose|exame)\b/i,
  },
  {
    domain: 'legal',
    pattern:
      /\b(jur[ií]dic[oa]|advogad[oa]|lei|legisla[çc][aã]o|contrato|processo judicial|direito|obriga[çc][aã]o legal)\b/i,
  },
  {
    domain: 'finance',
    pattern:
      /\b(financeir[oa]|investimento|a[çc][aã]o|bolsa|cripto|empr[eé]stimo|juros|imposto|tribut[oa]|rentabilidade)\b/i,
  },
  {
    domain: 'security',
    pattern:
      /\b(seguran[çc]a|vulnerabilidade|exploit|malware|phishing|credencial|token|senha|xss|csrf|ssrf|inje[çc][aã]o)\b/i,
  },
  {
    domain: 'site-builder',
    pattern:
      /\b(site|website|landing page|loja virtual|e-?commerce|portal|saas|painel administrativo|aplica[çc][aã]o web)\b/i,
  },
  {
    domain: 'code',
    pattern:
      /\b(c[oó]digo|programa[çc][aã]o|typescript|javascript|react|node|api|banco de dados|arquitetura|bug|commit|deploy)\b/i,
  },
  {
    domain: 'ux-accessibility',
    pattern:
      /\b(ux|ui|design|interface|acessibilidade|wcag|responsiv[oa]|leitor de tela|contraste)\b/i,
  },
  {
    domain: 'data-documents',
    pattern:
      /\b(pdf|documento|planilha|csv|dados|relat[oó]rio|rag|base de conhecimento)\b/i,
  },
  {
    domain: 'social-media',
    pattern:
      /\b(instagram|facebook|tiktok|youtube|linkedin|rede social|postagem|engajamento)\b/i,
  },
  {
    domain: 'marketing',
    pattern:
      /\b(marketing|campanha|an[uú]ncio|copywriting|seo|funil|convers[aã]o|marca|branding)\b/i,
  },
  {
    domain: 'sales',
    pattern:
      /\b(vendas?|cliente|crm|prospec[çc][aã]o|atendimento|lead|negocia[çc][aã]o)\b/i,
  },
  {
    domain: 'research',
    pattern:
      /\b(pesquis|fontes?|evid[eê]ncia|not[ií]cia|estudo|compare|investigue)\b/i,
  },
];

const CURRENT_INFORMATION_PATTERN =
  /\b(hoje|agora|atual(?:mente)?|recente|[uú]ltim[oa]s?|not[ií]cia|pre[çc]o|cota[çc][aã]o|agenda|calend[aá]rio|vers[aã]o|lan[çc]amento|presidente|ceo|lei vigente|regulamento)\b/i;

const COMPLEXITY_PATTERN =
  /\b(arquitetura|auditoria|estrat[eé]gia|compare|implemente|investigue|passo a passo|plano completo|produ[çc][aã]o|multiempresa|migra[çc][aã]o)\b/i;

const PERSONAL_DATA_PATTERN =
  /\b(cpf|rg|passaporte|endere[çc]o|telefone|e-?mail|dado pessoal|prontu[aá]rio|cart[aã]o de cr[eé]dito)\b/i;

function inferDomain(
  mode: AIMode,
  prompt: string
): SpecialistDomain {
  if (mode === 'site-builder') return 'site-builder';
  if (mode === 'code') return 'code';
  if (mode === 'research') return 'research';
  if (mode === 'document') return 'data-documents';

  return (
    DOMAIN_PATTERNS.find(({ pattern }) =>
      pattern.test(prompt)
    )?.domain || 'general'
  );
}

export class AIRequestClassifier {
  static classify(
    input: ClassificationInput
  ): RequestClassification {
    const prompt = input.prompt.trim();
    const domain = inferDomain(input.mode, prompt);
    const highStakes = [
      'health',
      'legal',
      'finance',
    ].includes(domain);
    const personalData =
      PERSONAL_DATA_PATTERN.test(prompt);
    const requiresSearch =
      input.mode === 'research' ||
      highStakes ||
      CURRENT_INFORMATION_PATTERN.test(prompt);
    const requiresCode =
      input.mode === 'code' ||
      input.mode === 'site-builder' ||
      domain === 'code' ||
      domain === 'site-builder';
    const requiresTools =
      requiresSearch ||
      Boolean(input.hasFiles) ||
      Boolean(input.requestedTools?.length);
    const contextSize =
      input.contextSizeEstimate ||
      Math.ceil(prompt.length / 4);
    const complex =
      input.mode === 'deep' ||
      input.mode === 'code' ||
      input.mode === 'site-builder' ||
      contextSize > 8_000 ||
      COMPLEXITY_PATTERN.test(prompt);
    const simple =
      !complex &&
      prompt.length < 180 &&
      !requiresSearch &&
      !requiresTools;

    const reasons: string[] = [
      `domain:${domain}`,
      complex
        ? 'complexity:complex'
        : simple
          ? 'complexity:simple'
          : 'complexity:standard',
    ];

    if (requiresSearch) {
      reasons.push('current_sources_required');
    }

    if (highStakes) {
      reasons.push('high_stakes_guardrails_required');
    }

    if (personalData) {
      reasons.push('personal_data_minimization_required');
    }

    return {
      domain,
      complexity: complex
        ? 'complex'
        : simple
          ? 'simple'
          : 'standard',
      sensitivity: highStakes
        ? 'high-stakes'
        : personalData
          ? 'personal-data'
          : 'normal',
      requiresSearch,
      requiresTools,
      requiresCode,
      requiresIndependentVerification:
        highStakes ||
        domain === 'security' ||
        domain === 'site-builder',
      reasons,
    };
  }
}
