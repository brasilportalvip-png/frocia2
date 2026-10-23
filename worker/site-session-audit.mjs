/** O destino recebido pelo worker autenticado deve ter sido validado pelo servico de preview. */
export async function authenticateSelfSite(page, target, options) {
  try {
    const login = new URL(options.loginUrl);
    if (options.useTargetOrigin) {
      const destination = new URL(target);
      login.protocol = destination.protocol;
      login.host = destination.host;
    }
    const timeout = options.timeout || 15_000;
    await page.goto(login.toString(), { waitUntil: 'domcontentloaded', timeout });
    if (options.openSelector) await page.locator(options.openSelector).click({ timeout });
    await page.locator(options.userSelector || 'input[type=email]').fill(options.user, { timeout });
    await page.locator(options.passwordSelector || 'input[type=password]').fill(options.password, { timeout });
    await page.locator(options.submitSelector || 'button[type=submit]').click({ timeout });
    await page.locator(options.authenticatedSelector || 'button[title="Menu do Usuário Froc.IA"]').waitFor({ state: 'visible', timeout });
  } catch {
    // Playwright pode incluir valores preenchidos no erro; nao devolve-los ao relatorio.
    throw new Error('O login de teste nao confirmou um perfil autenticado no destino auditado.');
  }
}
