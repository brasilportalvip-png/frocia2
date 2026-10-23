import { expect, test } from '@playwright/test';
import { auditSelfSiteViews, REQUIRED_SELF_SITE_VIEWS } from '../worker/site-navigation-audit.mjs';

const target = 'https://froc-audit.example/';

function fixture(scenario: 'healthy' | 'blank' | 'login') {
  const buttons = REQUIRED_SELF_SITE_VIEWS.map(view => `<button>${view}</button>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><title>Auditoria de navegacao</title></head><body>
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

test('auditor visita as sete vistas internas sem enviar formularios ou mensagens', async ({ page }) => {
  const methods: string[] = [];
  await page.route(`${target}**`, route => {
    methods.push(route.request().method());
    return route.fulfill({ contentType: 'text/html', body: fixture('healthy') });
  });
  const report = await auditSelfSiteViews(page, target);
  expect(report.map(view => view.view)).toEqual(REQUIRED_SELF_SITE_VIEWS);
  expect(report.every(view => view.status === 'passed')).toBe(true);
  expect(report.every(view => /^[a-f0-9]{64}$/.test(view.traceSha256))).toBe(true);
  expect(new Set(methods)).toEqual(new Set(['GET']));
});

test('auditor detecta uma vista que fica vazia apos o clique', async ({ page }) => {
  await page.route(`${target}**`, route => route.fulfill({ contentType: 'text/html', body: fixture('blank') }));
  const report = await auditSelfSiteViews(page, target);
  expect(report.find(view => view.view === 'Integrações')?.status).toBe('failed');
  expect(report.filter(view => view.status === 'failed')).toHaveLength(1);
});

test('auditor informa falta de sessao sem afirmar que validou a area privada', async ({ page }) => {
  await page.route(`${target}**`, route => route.fulfill({ contentType: 'text/html', body: fixture('login') }));
  const report = await auditSelfSiteViews(page, target);
  expect(report.find(view => view.view === 'Meus projetos')?.status).toBe('external_blocker');
  expect(report.filter(view => view.status === 'failed')).toHaveLength(0);
});
