export interface GeneratedSiteFunctionalGateResult {
  passed: boolean;
  issues: string[];
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function requested(prompt: string, pattern: RegExp): boolean {
  return pattern.test(normalize(prompt));
}

export function validateGeneratedSiteFunctionality(
  prompt: string,
  html: string
): GeneratedSiteFunctionalGateResult {
  const source = normalize(html);
  const issues: string[] = [];
  const hasExecutableInteraction =
    /addeventlistener\s*\(|onclick\s*=|onsubmit\s*=/.test(source);

  if (!/^\s*<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html)) {
    issues.push('Entregar um documento HTML5 completo e executável.');
  }
  if (!/<script[\s>]/i.test(html) || !hasExecutableInteraction) {
    issues.push('Implementar JavaScript real para todos os botões, formulários e navegação; não entregar controles decorativos.');
  }

  if (requested(prompt, /persist|apos atualizar|depois de atualizar|f5|permanec/)) {
    if (!/localstorage|indexeddb/.test(source)) {
      issues.push('Persistir os dados no navegador com localStorage ou IndexedDB e restaurá-los ao carregar a página.');
    }
  }

  if (requested(prompt, /tema claro|tema escuro|modo claro|modo escuro/)) {
    const hasThemeControl =
      /theme|tema|darkmode|dark-mode/.test(source) &&
      /classlist|dataset|setattribute/.test(source);
    if (!hasThemeControl) {
      issues.push('Criar um controle funcional de tema claro/escuro e persistir a preferência.');
    }
  }

  if (requested(prompt, /busca|buscar|pesquis/)) {
    const hasSearchBehavior =
      /type=["']search["']|buscar|pesquisar/.test(source) &&
      /\.filter\s*\(|includes\s*\(|indexof\s*\(/.test(source);
    if (!hasSearchBehavior) {
      issues.push('Implementar busca funcional que filtre os registros enquanto o usuário pesquisa.');
    }
  }

  if (requested(prompt, /cadastro|cadastrar|agendamento|agendar/)) {
    const hasSubmission =
      /<form[\s>]/.test(source) &&
      /submit|onsubmit/.test(source) &&
      /preventdefault\s*\(/.test(source);
    if (!hasSubmission) {
      issues.push('Implementar formulários funcionais de cadastro/agendamento, validação e atualização imediata das listas.');
    }
  }

  if (requested(prompt, /status|agendada|concluida|cancelada/)) {
    const hasStatuses = ['agendada', 'concluida', 'cancelada'].every((status) =>
      source.includes(status)
    );
    if (!hasStatuses || !hasExecutableInteraction) {
      issues.push('Permitir alterar de verdade o status entre agendada, concluída e cancelada.');
    }
  }

  if (requested(prompt, /responsiv|celular|mobile/)) {
    const hasViewport = /name=["']viewport["']/.test(source);
    const hasResponsiveRules = /@media|sm:|md:|lg:/.test(source);
    if (!hasViewport || !hasResponsiveRules) {
      issues.push('Implementar layout responsivo real para celular, tablet e desktop.');
    }
  }

  return { passed: issues.length === 0, issues };
}
