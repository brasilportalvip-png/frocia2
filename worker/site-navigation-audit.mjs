import crypto from 'node:crypto';

export const REQUIRED_SELF_SITE_VIEWS = [
  'Início', 'Meus projetos', 'Conversas', 'Criar projeto', 'Modelos',
  'Ferramentas de IA', 'Integrações', 'Planos e créditos',
];

/** Navegacao somente de leitura; nao envia chats, compra creditos nem altera projetos. */
export async function auditSelfSiteViews(page, target, options = {}) {
  const results = [];
  const deadline = Date.now() + 60_000;
  const timeout = () => Math.max(500, Math.min(10_000, deadline - Date.now()));
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeout() });
  const discovered = await page.locator('aside[aria-label="Menu principal da Froc.IA"] [data-site-audit-view]')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-site-audit-view')).filter(Boolean));
  const catalog = [...new Set([...(options.expectedViews || REQUIRED_SELF_SITE_VIEWS), ...discovered])];
  results.catalog = catalog;
  const views = options.views ? [...new Set(options.views)] : catalog;
  for (const view of views) {
    let status = 'passed'; let details = 'Vista renderizada.'; let documentHash = null;
    if (Date.now() >= deadline) {
      results.push({ view, status: 'external_blocker', details: 'Limite de tempo da navegacao atingido.',
        traceSha256: crypto.createHash('sha256').update(`${view}:deadline:${Date.now()}`).digest('hex') });
      continue;
    }
    try {
      const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeout() });
      if (!response?.ok()) throw new Error(`HTTP ${response?.status()}`);
      const menu = page.locator('aside[aria-label="Menu principal da Froc.IA"]');
      await menu.waitFor({ state: 'visible', timeout: timeout() });
      const before = await page.locator('body').innerText({ timeout: timeout() });
      await menu.getByRole('button', { name: view, exact: true }).click({ timeout: timeout() });
      if (!['Início', 'Conversas'].includes(view)) {
        await page.waitForFunction(previous => document.body.innerText !== previous, before, { timeout: timeout() });
      }
      await page.locator('h1, h2, h3, textarea, [role="dialog"]').first().waitFor({ state: 'visible', timeout: timeout() });
      const loginForm = page.locator('input[type="password"]');
      if (await loginForm.count() && await loginForm.first().isVisible()) {
        status = 'external_blocker'; details = 'Esta vista requer sessao autenticada de teste.';
      }
      const text = await page.locator('body').innerText({ timeout: timeout() });
      documentHash = crypto.createHash('sha256').update(text).digest('hex');
      if (text.trim().length < 30) throw new Error('Vista vazia apos navegacao.');
    } catch (error) {
      status = 'failed';
      // Nao copiar DOM privado, dados de formularios ou mensagem com credenciais.
      details = error?.message?.startsWith('HTTP ') ? error.message : 'A vista nao renderizou ou a navegacao nao respondeu dentro do prazo.';
    }
    const traceSha256 = crypto.createHash('sha256').update(JSON.stringify({ view, status, details,
      documentHash, observedAt: new Date().toISOString() })).digest('hex');
    results.push({ view, status, details, traceSha256 });
  }
  return results;
}
