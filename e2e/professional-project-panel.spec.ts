import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/project-variables/project-test', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: 1, variables: [{ name: 'PAYMENT_SECRET', purpose: 'Pagamento de teste', visibility: 'secret', environment: 'preview', configured: true }] }) }));
  await page.goto('/e2e/fixtures/project-configuration.html');
  await page.getByRole('button', { name: 'Configurar projeto', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar variáveis', exact: true })).toBeEnabled();
});

test('secret editing, masking and accurate delivery state', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  const password = dialog.locator('input[type=password]');
  await expect(password).toHaveValue('');
  await expect(dialog.getByText(/já configurado/)).toBeVisible();
  await password.fill('replacement-test-secret');
  let saved: any;
  await page.route('**/api/project-variables/project-test', async route => {
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: 2, variables: saved.variables.map(({ value: _value, ...v }: any) => ({ ...v, configured: true })) }) });
  });
  await dialog.getByRole('button', { name: 'Salvar variáveis', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Variáveis salvas com criptografia.');
  expect(saved.variables[0].value).toBe('replacement-test-secret');
  await expect(password).toHaveValue('');
  await dialog.getByRole('button', { name: 'Entrega', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Certificação antes da entrega' })).toBeVisible();
});

test('catalogue, keyboard focus and accessible controls', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  const analysis = await new AxeBuilder({ page }).include('[role=dialog]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(analysis.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  await dialog.getByRole('button', { name: 'Agentes', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Inteligência', exact: true })).toBeVisible();
  await expect(dialog.locator('details')).toHaveCount(65);
  await dialog.getByRole('button', { name: 'Fechar configuração' }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Configurar projeto', exact: true })).toBeFocused();
});

test('maintenance requires an explicit choice and saves the daily credit limit', async ({ page }) => {
  const url = '**/api/professional-factory/projects/project-test/maintenance';
  let submitted: any;
  await page.route(url, async route => {
    if (route.request().method() === 'PUT') submitted = route.request().postDataJSON();
    await route.fulfill({ json: { revision: submitted ? 1 : 0, enabled: submitted?.enabled || false,
      dailyCreditLimit: submitted?.dailyCreditLimit || 95, usedCredits: 0, activeBuildId: null, lastResult: null } });
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Manutenção', exact: true }).click();
  const checkbox = dialog.getByRole('checkbox', { name: /Autorizar correções/ });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await dialog.getByRole('spinbutton', { name: 'Limite diário de créditos para manutenção' }).fill('190');
  await dialog.getByRole('button', { name: 'Salvar manutenção', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Configuração de manutenção salva.');
  expect(submitted).toEqual({ revision: 0, enabled: true, dailyCreditLimit: 190 });
  const analysis = await new AxeBuilder({ page }).include('[role=dialog]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(analysis.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});
