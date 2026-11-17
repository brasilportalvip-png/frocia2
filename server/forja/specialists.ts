/**
 * Revisão dos especialistas do criador de sites (modo "Completo").
 *
 * Depois que o site compila, 3 especialistas olham o site pronto AO MESMO TEMPO
 * (design, textos e SEO, segurança e funcionamento). O arquiteto aplica o que eles
 * apontarem e o site é compilado de novo. Se a correção quebrar a compilação, a
 * versão boa anterior é mantida: a revisão nunca piora o site.
 */

export interface SpecialistIssue {
  severity: 'alta' | 'media' | 'baixa';
  problem: string;
  fix: string;
  file?: string;
}

export interface SpecialistReview {
  id: SpecialistId;
  name: string;
  status: 'ok' | 'issues' | 'skipped';
  issues: SpecialistIssue[];
}

export type SpecialistId = 'design' | 'conteudo' | 'seguranca';

export const SPECIALISTS: { id: SpecialistId; name: string; focus: string }[] = [
  {
    id: 'design',
    name: 'Especialista em design e experiência',
    focus: [
      'Layout no celular (390px), tablet e computador: nada cortado, sobreposto ou com rolagem lateral.',
      'Contraste de texto suficiente, hierarquia visual clara, espaçamentos consistentes.',
      'Menu de navegação funcionando no celular, estados de foco e hover, botões com tamanho de toque (44px).',
      'Fotos: o site usa <Photo id> do kit com fotos declaradas em forja/site.json (4 a 8, incluindo "hero"), prompts em inglês ricos (cena, lente, luz) e sem texto na foto; nada de ilustração SVG genérica no lugar de foto, nem URLs externas.',
      'Acabamento de agência: logotipo próprio (src/components/Logo.tsx) no menu e no rodapé, favicon, luz (brilhos/Spotlight/vidro), animações de entrada (Reveal) e hover; hero com impacto.',
    ].join('\n'),
  },
  {
    id: 'conteudo',
    name: 'Especialista em textos e SEO',
    focus: [
      'Textos reais e específicos do negócio pedido, em português do Brasil, sem "lorem ipsum", "Seu texto aqui" ou placeholders.',
      'Nada inventado que possa enganar: números, prêmios, depoimentos com nome de pessoas reais, CNPJ, endereços falsos apresentados como reais.',
      'index.html com <title>, meta description, lang="pt-BR", canonical e og:url com __SITE_URL__, Open Graph com og:image /forja-img/hero.jpg, Twitter card e JSON-LD (tipo schema.org do negócio + FAQPage); um único <h1> por página e títulos em ordem.',
      'Cada página chama useSeo com título e descrição próprios; existem /privacidade e /termos (componentes PrivacyPolicy e TermsOfUse do kit) com links no rodapé, página 404 e aviso de cookies (CookieConsent).',
      'Chamadas para ação claras (WhatsApp, contato, comprar) e coerentes com o pedido.',
    ].join('\n'),
  },
  {
    id: 'seguranca',
    name: 'Especialista em segurança e funcionamento',
    focus: [
      'Todo botão, link, aba, filtro, formulário, carrinho e modal funciona de verdade (nada de onClick vazio ou href="#" morto).',
      'Formulários com validação por campo e mensagem clara; nenhuma mensagem de sucesso antes de validar.',
      'Sem dangerouslySetInnerHTML com dados do usuário, sem eval, sem chaves/senhas/tokens no código.',
      'Links externos com rel="noopener noreferrer"; nada de window.alert/confirm/prompt.',
      'Erros de lógica evidentes (estado que não atualiza, totais errados no carrinho, datas inválidas).',
    ].join('\n'),
  },
];

export function specialistSystemInstruction(focus: string): string {
  return [
    'Você é um revisor sênior de sites React + TypeScript + Tailwind prontos para produção.',
    'Revise SOMENTE os pontos do seu foco abaixo. Aponte apenas problemas reais e concretos que você consegue ver no código; não invente.',
    'Para cada problema, diga em português simples o que está errado e exatamente como corrigir (arquivo e mudança).',
    'Se estiver tudo certo no seu foco, devolva a lista vazia. No máximo 5 problemas, os mais importantes primeiro.',
    'IMPORTANTE SOBRE A MONTAGEM: o compilador da Froc embute React, ícones e todo o código direto no HTML final. O index.html NÃO deve ter <script src="/src/main.tsx">, importmap nem outros scripts locais — a ausência deles está CORRETA. Nunca peça para adicioná-los e nunca aponte isso como problema.',
    'Responda SOMENTE com JSON no formato: {"issues":[{"severity":"alta|media|baixa","file":"src/...","problem":"...","fix":"..."}]}',
    '',
    'SEU FOCO:',
    focus,
  ].join('\n');
}

export function specialistUserContent(files: Record<string, string>, originalPrompt: string): string {
  const snapshot = Object.entries(files)
    .map(([path, content]) => `<current_file path="${path}">\n${content}\n</current_file>`)
    .join('\n\n');
  return `PEDIDO ORIGINAL DO CLIENTE:\n${originalPrompt}\n\nARQUIVOS DO SITE:\n${snapshot}`;
}

/** Lê a resposta do especialista com tolerância (JSON puro, em bloco ```json ou com texto em volta). */
export function parseSpecialistIssues(raw: string): SpecialistIssue[] {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = Array.isArray((data as { issues?: unknown })?.issues) ? ((data as { issues: unknown[] }).issues) : [];
  const sev = (v: unknown): SpecialistIssue['severity'] => {
    const s = String(v || '').toLowerCase();
    if (s.startsWith('alt') || s === 'high') return 'alta';
    if (s.startsWith('bai') || s === 'low') return 'baixa';
    return 'media';
  };
  return list
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i) => ({
      severity: sev(i.severity),
      problem: String(i.problem || '').trim().slice(0, 400),
      fix: String(i.fix || '').trim().slice(0, 600),
      ...(i.file ? { file: String(i.file).slice(0, 200) } : {}),
    }))
    .filter((i) => i.problem && i.fix)
    .slice(0, 5);
}

/** Só vale a pena chamar o arquiteto de novo para problemas de gravidade alta ou média. */
export function issuesToFix(reviews: SpecialistReview[]): { reviewer: string; issue: SpecialistIssue }[] {
  return reviews.flatMap((r) => r.issues.filter((i) => i.severity !== 'baixa').map((issue) => ({ reviewer: r.name, issue }))).slice(0, 12);
}

export function buildSpecialistFixContents(params: {
  originalPrompt: string;
  currentFiles: Record<string, string>;
  fixes: { reviewer: string; issue: SpecialistIssue }[];
}): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const snapshot = Object.entries(params.currentFiles)
    .map(([path, content]) => `<current_file path="${path}">\n${content}\n</current_file>`)
    .join('\n\n');
  const list = params.fixes
    .map((f, n) => `${n + 1}. [${f.reviewer} — ${f.issue.severity}]${f.issue.file ? ` (${f.issue.file})` : ''} ${f.issue.problem}\n   Como corrigir: ${f.issue.fix}`)
    .join('\n');
  return [
    {
      role: 'user',
      parts: [
        {
          text: `Os especialistas revisaram o site pronto e apontaram estes problemas:\n\n${list}\n\nARQUIVOS ATUAIS:\n${snapshot}\n\nPEDIDO ORIGINAL:\n${params.originalPrompt}\n\nCorrija TODOS os problemas acima sem remover nada que já funciona. Retorne SOMENTE os arquivos <file path="..."> alterados (completos, sem omitir linhas) e um breve <summary> em português dizendo o que foi melhorado.`,
        },
      ],
    },
  ];
}
