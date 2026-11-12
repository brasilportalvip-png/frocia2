/**
 * Atuador universal da Froc.IA: aperta qualquer botão, aba, link, opção ou
 * interruptor VISÍVEL na tela pelo nome falado, e digita em campos.
 * É o que dá à voz acesso a todas as funções do site, inclusive as que não
 * têm comando próprio no catálogo (dentro do painel admin, preços, integrações...).
 *
 * Segurança: só atua no que o próprio usuário já está vendo e poderia clicar;
 * ações perigosas (excluir, pagar, publicar, sair...) pedem confirmação falada;
 * o servidor continua validando cada operação.
 */

const normalize = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CLICKABLE = [
  'button', 'a[href]', '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="menuitemradio"]',
  '[role="option"]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]', '[role="link"]',
  'input[type="checkbox"]', 'input[type="radio"]', 'input[type="submit"]', 'input[type="button"]',
  'summary', 'select',
].join(',');

const FIELDS = 'input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="number"],input[type="tel"],input[type="password"],textarea,[contenteditable="true"]';

const DANGEROUS =
  /\b(?:exclu|apag|delet|remov|limp|destru|resetar|redefinir|revog|banir|bloque|desativ|cancelar assinatura|pagar|pagamento|comprar|assinar|finalizar compra|checkout|publicar|deploy|merge|sair|logout|restaur|reverter|rollback|enviar para producao|conceder|transferir)/;

export interface ActuatorMatch {
  element: HTMLElement;
  label: string;
  dangerous: boolean;
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest('[data-testid="site-command-toast"]')) return false;
  if (element.closest('[aria-hidden="true"]')) return false;
  if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') return false;
  const rects = element.getClientRects();
  if (!rects.length) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || '1') > 0.05;
}

function labelOf(element: HTMLElement): string {
  const aria = element.getAttribute('aria-label') || element.getAttribute('title') || '';
  const labelledBy = element.getAttribute('aria-labelledby');
  const labelled = labelledBy ? labelledBy.split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ') : '';
  let own = '';
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    // O que está DIGITADO num campo não é o nome dele: "digite ... no campo nome" achava a caixa
    // do chat porque a própria frase digitada continha "nome". Só botões (submit/button) usam o valor.
    own = element instanceof HTMLInputElement && /^(?:submit|button|reset)$/.test(element.type) ? element.value : '';
    const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : element.closest('label');
    own = `${own} ${label?.textContent || ''} ${element.placeholder || ''} ${element.getAttribute('name') || ''}`;
  } else if (element instanceof HTMLSelectElement) {
    const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : element.closest('label');
    own = label?.textContent || element.name || '';
  } else {
    own = element.innerText || element.textContent || '';
  }
  return `${aria} ${labelled} ${own}`.replace(/\s+/g, ' ').trim().slice(0, 140);
}

/** A janela aberta por cima (modal) tem prioridade sobre o resto da tela. */
function scopeRoot(): ParentNode {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')).filter(isVisible);
  return dialogs.length ? dialogs[dialogs.length - 1] : document;
}

function score(label: string, query: string): number {
  const l = normalize(label);
  const q = normalize(query);
  if (!l || !q) return 0;
  if (l === q) return 100;
  if (l.startsWith(q) || l.endsWith(q)) return 88;
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l)) return 80;
  if (l.includes(q)) return 70;
  const words = q.split(' ').filter((word) => word.length > 2);
  if (!words.length) return 0;
  const hits = words.filter((word) => l.includes(word)).length;
  // Rótulos muito longos (cartões inteiros) valem menos que um botão objetivo.
  const lengthPenalty = Math.min(15, Math.max(0, l.length - q.length * 3) / 10);
  return Math.round((hits / words.length) * 65 - lengthPenalty);
}

function findBest(selector: string, query: string): { match?: ActuatorMatch; options?: string[] } {
  const roots: ParentNode[] = [scopeRoot()];
  if (roots[0] !== document) roots.push(document);
  for (const root of roots) {
    const scored = Array.from(root.querySelectorAll(selector))
      .filter(isVisible)
      .map((element) => {
        const label = labelOf(element as HTMLElement);
        return { element: element as HTMLElement, label, value: score(label, query) };
      })
      .filter((entry) => entry.value >= 45 && entry.label)
      .sort((a, b) => b.value - a.value);
    if (!scored.length) continue;
    const best = scored[0];
    const ties = scored.filter((entry) => entry.value === best.value && normalize(entry.label) !== normalize(best.label));
    if (ties.length && best.value < 88) {
      return { options: [best.label, ...ties.map((entry) => entry.label)].slice(0, 4) };
    }
    return { match: { element: best.element, label: best.label, dangerous: DANGEROUS.test(normalize(best.label)) } };
  }
  return {};
}

export function findClickTarget(query: string) {
  return findBest(CLICKABLE, query);
}

export function clickTarget(match: ActuatorMatch) {
  const element = match.element;
  element.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  element.focus?.({ preventScroll: true });
  if (element instanceof HTMLSelectElement) {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return;
  }
  element.click();
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter ? setter.call(element, value) : (element.value = value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Digita no campo citado ("no campo e-mail") ou no campo em foco / primeiro campo da janela aberta. */
export function typeIntoField(text: string, fieldName?: string): { ok: boolean; message: string } {
  let target: HTMLElement | null = null;
  if (fieldName) {
    const found = findBest(FIELDS, fieldName);
    if (found.options) return { ok: false, message: `Encontrei mais de um campo: ${found.options.join(', ')}. Diga qual.` };
    target = found.match?.element || null;
    if (!target) return { ok: false, message: `Não encontrei o campo "${fieldName}" nesta tela.` };
  } else {
    const active = document.activeElement as HTMLElement | null;
    if (active && active.matches?.(FIELDS) && isVisible(active)) target = active;
    if (!target) {
      const root = scopeRoot();
      target = (Array.from(root.querySelectorAll(FIELDS)).find(isVisible) as HTMLElement) || null;
    }
    if (!target) return { ok: false, message: 'Não há nenhum campo de texto visível nesta tela.' };
  }
  target.focus();
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) setNativeValue(target, text);
  else {
    target.textContent = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const label = labelOf(target) || 'campo';
  return { ok: true, message: `Digitei em "${label.slice(0, 40)}".` };
}

/** Lista curta do que pode ser clicado agora (para "o que tem nesta tela"). */
export function listVisibleActions(limit = 12): string[] {
  const root = scopeRoot();
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const element of Array.from(root.querySelectorAll(CLICKABLE))) {
    if (!isVisible(element)) continue;
    const label = labelOf(element as HTMLElement).slice(0, 40);
    const key = normalize(label);
    if (!key || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= limit) break;
  }
  return labels;
}
