import {
  AIMode,
  RequestClassification,
  SpecialistDomain,
} from './types/ai.js';
import { SocialSearchService } from './socialSearchService.js';
import { SiteAuditService } from '../services/siteAuditService.js';

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
      /\b(pesquis\w*|busqu\w*|fontes?|evid[eê]ncia|not[ií]cias?|estudos?|compar\w*|investigu\w*|internet|web|rede)\b/i,
  },
];

const CURRENT_INFORMATION_PATTERN =
  /\b(hoje|agora|atual(?:mente)?|tempo real|ao vivo|recente|[uú]ltim[oa]s?|not[ií]cias?|pre[çc]os?|promo[çc][oõ]es?|cota[çc][aã]o|agenda|calend[aá]rio|hor[aá]rios?|vers[aã]o|lan[çc]amento|presidente|ceo|lei vigente|regulamento|placar|resultado do jogo|classifica[çc][aã]o|campeonato|tr[aâ]nsito|evento|aberto agora)\b/i;

const EXPLICIT_WEB_RESEARCH_PATTERN =
  /\b(?:pesquis\w*|busqu\w*|procur\w*|consult\w*|verifiqu\w*|investigu\w*)\b[\s\S]{0,80}\b(?:internet|web|rede|online|fontes?|sites?|google)\b|\b(?:internet|web|rede|online|fontes?|sites?|google)\b[\s\S]{0,80}\b(?:pesquis\w*|busqu\w*|procur\w*|consult\w*|verifiqu\w*|investigu\w*)\b/i;

const LIVE_INFORMATION_PATTERN =
  /\b(?:futebol|esportes?|jogos?|placar|tabela|campeonato|not[ií]cias?|mercado|bolsa|d[oó]lar|euro|bitcoin|cripto|pre[çc]os?|produto|restaurante|hotel|viagem|voos?|tempo|clima|tr[aâ]nsito|cinema|eventos?)\b/i;

const CONVERSATIONAL_CHECK_IN_PATTERN =
  /^\s*(?:oi|ol[aá]|bom dia|boa tarde|boa noite|tudo bem|como (?:voc[eê]|c[eê]) (?:est[aá]|vai)|(?:est[aá] )?tudo bem com (?:voc[eê]|c[eê])|como (?:voc[eê]|c[eê]) se sente|(?:voc[eê]|c[eê]) est[aá] bem)(?=\s|[?!.,]|$)/i;

const ATTACHMENT_ONLY_PATTERN =
  /\b(?:somente|apenas|exclusivamente)\b[\s\S]{0,80}\b(?:anex[oa]|arquivo|documento|pdf|planilha|csv|zip|reposit[oó]rio)\b|\b(?:anex[oa]|arquivo|documento|pdf|planilha|csv|zip|reposit[oó]rio)\b[\s\S]{0,80}\b(?:somente|apenas|exclusivamente)\b/i;

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
    const attachmentOnly =
      Boolean(input.hasFiles) &&
      ATTACHMENT_ONLY_PATTERN.test(prompt);
    const socialPlatforms =
      SocialSearchService.extractRequestedPlatforms(
        prompt
      );
    const requiresSocialSearch =
      !attachmentOnly && SocialSearchService.shouldSearch(
        prompt,
        input.mode
      );
    const requiresSiteAudit =
      !attachmentOnly && SiteAuditService.shouldAudit(prompt);
    const siteAuditUrl = requiresSiteAudit
      ? SiteAuditService.extractRequestedUrl(prompt)
      : null;
    const conversationalCheckIn =
      CONVERSATIONAL_CHECK_IN_PATTERN.test(prompt);
    const requiresSearch =
      !attachmentOnly &&
      (input.mode === 'research' ||
        highStakes ||
        domain === 'research' ||
        requiresSocialSearch ||
        requiresSiteAudit ||
        (!conversationalCheckIn && CURRENT_INFORMATION_PATTERN.test(prompt)) ||
        EXPLICIT_WEB_RESEARCH_PATTERN.test(prompt) ||
        (LIVE_INFORMATION_PATTERN.test(prompt) &&
          /\b(qual|quais|quanto|onde|quando|como|melhor|recomend|compare|mostre|informe)\b/i.test(prompt)));
    const requiresCode =
      input.mode === 'code' ||
      input.mode === 'site-builder' ||
      domain === 'code' ||
      domain === 'site-builder';
    const requiresTools =
      requiresSearch ||
      requiresSiteAudit ||
      Boolean(input.hasFiles) ||
      Boolean(input.requestedTools?.length);
    const contextSize =
      input.contextSizeEstimate ||
      Math.ceil(prompt.length / 4);
    const complex =
      input.mode === 'deep' ||
      input.mode === 'code' ||
      input.mode === 'site-builder' ||
      requiresSiteAudit ||
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

    if (attachmentOnly) {
      reasons.push('attachment_context_only');
    }

    if (requiresSocialSearch) {
      reasons.push(
        'official_social_api_search_required'
      );
    }

    if (requiresSiteAudit) {
      reasons.push('full_site_audit_required');
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
      socialPlatforms,
      siteAuditUrl,
    };
  }
}
