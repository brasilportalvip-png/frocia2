import { expect, test } from '@playwright/test';
import { auditSelfSiteViews, REQUIRED_SELF_SITE_VIEWS } from '../worker/site-navigation-audit.mjs';

const target = 'https://froc-audit.example/';

function fixture(scenario: 'healthy' | 'blank' | 'login') {
  const buttons = REQUIRED_SELF_SITE_VIEWS.map(view => `<button data-site-audit-view="${view}">${view}</button>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Auditoria de navegacao</title></head><body>
    <aside aria-label="Menu principal da Froc.IA">${buttons}</aside>
    <main><h1>Como posso ajudar no projeto de hoje?</h1></main>
    <script>
      document.querySelectorAll('aside button').forEach(button => button.addEventListener('click', () => {
        const main = document.querySelector('main');
        if (${JSON.stringify(scenario)} === 'blank' && button.textContent === 'Integrações') main.innerHTML = '';
        else if (${JSON.stringify(scenario)} === 'login' && button.textContent === 'Meus projetos')
          main.innerHTML = '<h1>Entre para acessar seus projetos</h1><input type="email"><input type="password">';
        else main.innerHTML = '<h1>Vista: ' + button.textContent + '</h1><p>Conteudo operacional carregado corretamente.</p>';
      }));
    </script></body></html>`;
}

test('auditor visita todas as vistas internas sem enviar formularios ou mensagens', async ({ page }) => {
  const methods: string[] = [];
  await page.route(`${target}**`, route => {
    methods.push(route.request().method());
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture('healthy') });
  });
  const report = await auditSelfSiteViews(page, target);
  expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
  await expect(page.getByRole('button', { name: 'Início', exact: true })).toBeVisible();
  expect(report.map(view => view.view)).toEqual(REQUIRED_SELF_SITE_VIEWS);
  expect(report.every(view => view.status === 'passed')).toBe(true);
  expect(report.every(view => /^[a-f0-9]{64}$/.test(view.traceSha256))).toBe(true);
  expect(new Set(methods)).toEqual(new Set(['GET']));
});

test('auditor detecta uma vista que fica vazia apos o clique', async ({ page }) => {
  await page.route(`${target}**`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture('blank') }));
  const report = await auditSelfSiteViews(page, target);
  expect(report.find(view => view.view === 'Integrações')?.status).toBe('failed');
  expect(report.filter(view => view.status === 'failed')).toHaveLength(1);
});

test('auditor informa falta de sessao sem afirmar que validou a area privada', async ({ page }) => {
  await page.route(`${target}**`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture('login') }));
  const report = await auditSelfSiteViews(page, target);
  expect(report.find(view => view.view === 'Meus projetos')?.status).toBe('external_blocker');
  expect(report.filter(view => view.status === 'failed')).toHaveLength(0);
});

test('auditor inclui uma nova tela identificada no menu sem teto fixo de sete vistas', async ({ page }) => {
  const expanded = fixture('healthy').replace('</aside>', '<button data-site-audit-view="Ajuda">Ajuda</button></aside>');
  await page.route(`${target}**`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: expanded }));
  const report = await auditSelfSiteViews(page, target);
  expect(report.find(view => view.view === 'Ajuda')?.status).toBe('passed');
  expect(report).toHaveLength(REQUIRED_SELF_SITE_VIEWS.length + 1);
});

test('auditor retoma apenas as vistas pendentes e preserva o catalogo descoberto', async ({ page }) => {
  await page.route(`${target}**`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture('healthy') }));
  const report = await auditSelfSiteViews(page, target, { views: ['Modelos'] });
  expect(report.map(view => view.view)).toEqual(['Modelos']);
  expect(report[0].status).toBe('passed');
  expect(report.catalog).toEqual(REQUIRED_SELF_SITE_VIEWS);
});
