import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('Gates públicos da Froc.IA', () => {
  test('frontend e backend iniciam e sobrevivem a refresh', async ({ page, request }) => {
    const live = await request.get('/api/live');
    expect(live.status()).toBe(200);
    await expect(live.json()).resolves.toMatchObject({ status: 'live' });

    await page.goto('/');
    await expect(page.locator('#froc-app-root')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();

    await page.reload();
    await expect(page.locator('#froc-app-root')).toBeVisible();
  });

  test('autenticação apresenta validação local sem chamada externa', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Acesse seu ecossistema inteligente de criação')).toBeVisible();

    await dialog.getByPlaceholder('seuemail@exemplo.com').fill('e2e@example.com');
    await dialog.getByPlaceholder('••••••••').fill('123');
    await dialog.getByRole('button', { name: 'Entrar na Froc.IA' }).click();
    await expect(dialog.getByText('A senha deve conter no mínimo 6 caracteres.')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('cadastro, recuperação e foco do modal funcionam por teclado', async ({ page }) => {
    await page.goto('/');
    const enterButton = page.getByRole('button', { name: 'Entrar', exact: true });
    await enterButton.click();

    const dialog = page.getByRole('dialog');
    const email = dialog.getByLabel('E-mail');
    await expect(email).toBeFocused();

    await dialog.getByRole('button', { name: 'Cadastre-se grátis' }).click();
    await email.fill('cadastro-e2e@example.com');
    await dialog.getByLabel('Senha').fill('Senha1!');
    await dialog.getByRole('button', { name: 'Criar Minha Conta Grátis' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Por favor, informe seu nome.'
    );

    await dialog.getByRole('button', { name: 'Fazer Login' }).click();
    await dialog.getByRole('button', { name: 'Esqueceu a senha?' }).click();
    await expect(
      dialog.getByRole('button', { name: 'Enviar E-mail de Recuperação' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Voltar ao Login' }).click();

    await email.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(
      dialog.getByRole('button', { name: 'Fechar janela de autenticação' })
    ).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(
      dialog.getByRole('button', { name: 'Cadastre-se grátis' })
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(enterButton).toBeFocused();
  });

  test('layout público não cria rolagem horizontal nem erro de página', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('#froc-app-root')).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));

    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(pageErrors).toEqual([]);
  });

  test('respostas públicas usam contrato e cabeçalhos seguros', async ({ request }) => {
    const response = await request.get('/api/rota-inexistente-e2e');
    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'api_route_not_found' },
    });

    const page = await request.get('/');
    expect(page.headers()['x-content-type-options']).toBe('nosniff');
    expect(page.headers()['content-security-policy']).toContain("default-src 'self'");
  });

  test('não possui violações críticas WCAG na tela inicial', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#froc-app-root')).toBeVisible();

    const scan = await new AxeBuilder({ page })
      .exclude('iframe')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const critical = scan.violations.filter(
      (violation) => violation.impact === 'critical'
    );
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });
});
