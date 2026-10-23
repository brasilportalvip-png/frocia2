import { expect, test } from '@playwright/test';
import { authenticateSelfSite } from '../worker/site-session-audit.mjs';

const production = 'https://froc-login.example/';
const preview = 'https://preview.froc-login.example/';
const user = 'audit@example.com';
const password = 'fixture-only-password';

function fixture(accept: boolean) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Login de teste</title></head><body>
  <button onclick="document.querySelector('form').hidden=false">Entrar</button>
  <form hidden><input type="email"><input type="password"><button type="submit">Acessar</button></form>
  <script>document.querySelector('form').onsubmit=e=>{e.preventDefault();
    if (${JSON.stringify(accept)} && document.querySelector('input[type=email]').value===${JSON.stringify(user)} && document.querySelector('input[type=password]').value===${JSON.stringify(password)}) {
      document.querySelector('form').remove();const b=document.createElement('button');b.title='Menu do Usuário Froc.IA';b.textContent='Auditoria';document.body.append(b);
    }else{document.querySelector('form').remove();document.body.insertAdjacentHTML('beforeend','<p>Falha ao carregar perfil</p>');}
  };</script></body></html>`;
}

test('login automatico usa o preview auditado e confirma o perfil autenticado', async ({ page }) => {
  const visited: string[] = [];
  await page.route('https://**/*', route => {
    visited.push(route.request().url());
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(true) });
  });
  await authenticateSelfSite(page, preview, {
    loginUrl: production, user, password, useTargetOrigin: true, openSelector: 'button:has-text("Entrar")',
  });
  expect(visited).toEqual([preview]);
  await expect(page.locator('button[title="Menu do Usuário Froc.IA"]')).toBeVisible();
});

test('fechar o formulario sem carregar perfil nao comprova login', async ({ page }) => {
  await page.route(`${production}**`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(false) }));
  await expect(authenticateSelfSite(page, production, {
    loginUrl: production, user, password, openSelector: 'button:has-text("Entrar")', timeout: 500,
  })).rejects.toThrow('nao confirmou um perfil autenticado');
});

test('falhas do navegador nao copiam valores de credenciais para o relatorio', async () => {
  const page = { goto: async () => { throw new Error(`Falha com ${password}`); } };
  try {
    await authenticateSelfSite(page, production, { loginUrl: production, user, password });
    throw new Error('A falha deveria ter sido detectada');
  } catch (error) {
    expect(String(error)).not.toContain(password);
    expect(String(error)).toContain('nao confirmou');
  }
});
