import { appendFile } from 'node:fs/promises';
import { prepareBrowserTestAccount } from '../server/selfEvolution/browserTestAccountService.js';

async function main(): Promise<void> {
  if (!process.argv.includes('--run')) return;
  if (!process.env.GITHUB_ENV) throw new Error('Preparacao E2E deve executar no GitHub Actions.');
  const { adminAuth, adminDb, getServiceAccountCredentials } = await import('../server/lib/firebaseAdmin.js');
  const { SelfEvolutionPolicyEngine } = await import('../server/selfEvolution/selfEvolutionPolicyEngine.js');
  if (!(await SelfEvolutionPolicyEngine.isSelfEvolutionEnabledPersisted())) {
    console.log('[browser-test-account] Autoevolucao pausada; nenhuma conta alterada.');
    return;
  }
  const loginUrl = new URL(process.env.BROWSER_TEST_LOGIN_URL || process.env.SELF_EVOLUTION_TARGET_URL || 'https://frocia2.vercel.app/');
  if (loginUrl.protocol !== 'https:' || loginUrl.username || loginUrl.password) throw new Error('BROWSER_TEST_LOGIN_URL deve ser HTTPS sem credenciais na URL.');
  const result = await prepareBrowserTestAccount({
    auth: adminAuth, db: adminDb,
    projectId: getServiceAccountCredentials()?.projectId || '',
    configuredUser: process.env.BROWSER_TEST_USER,
    configuredPassword: process.env.BROWSER_TEST_PASSWORD,
    automaticEnabled: process.env.BROWSER_TEST_AUTO_PROVISION_ENABLED !== 'false',
  });
  const mask = (value: string) => console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
  mask(result.password); mask(result.user);
  const values = {
    BROWSER_TEST_LOGIN_URL: loginUrl.toString(), BROWSER_TEST_USER: result.user, BROWSER_TEST_PASSWORD: result.password,
    BROWSER_LOGIN_USE_TARGET_ORIGIN: result.mode === 'automatic' ? 'true' : 'false',
    BROWSER_LOGIN_OPEN_SELECTOR: process.env.BROWSER_LOGIN_OPEN_SELECTOR || 'button:has-text("Entrar")',
    BROWSER_USER_SELECTOR: process.env.BROWSER_USER_SELECTOR || 'input[type=email]',
    BROWSER_PASSWORD_SELECTOR: process.env.BROWSER_PASSWORD_SELECTOR || 'input[type=password]',
    BROWSER_SUBMIT_SELECTOR: process.env.BROWSER_SUBMIT_SELECTOR || 'button[type=submit]',
    BROWSER_AUTHENTICATED_SELECTOR: process.env.BROWSER_AUTHENTICATED_SELECTOR || 'button[title="Menu do Usuário Froc.IA"]',
  };
  for (const value of Object.values(values)) if (/[\r\n]/.test(value)) throw new Error('Configuracao E2E contem quebra de linha invalida.');
  await appendFile(process.env.GITHUB_ENV, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  await adminDb.collection('self_evolution_config').doc('browser_test_account').set({
    mode: result.mode, uid: result.uid || null, preparedAt: new Date().toISOString(),
    runId: process.env.GITHUB_RUN_ID || null, passwordStored: false,
  });
  console.log(`[browser-test-account] Conta ${result.mode === 'automatic' ? 'exclusiva preparada com senha temporaria' : 'configurada recebida'}; login real ainda sera verificado pelo navegador.`);
}

void main().catch((error: unknown) => {
  // Erros de SDK podem repetir parametros; nunca gravar senha ou chave no log.
  const code = (error as { code?: unknown })?.code;
  const safeCode = typeof code === 'string' && /^[a-z0-9/_-]{1,100}$/i.test(code) ? code : 'account_setup_failed';
  console.warn(`::warning::Nao foi possivel preparar a conta E2E (${safeCode}). Confira Firebase Authentication Admin ou os secrets BROWSER_TEST_USER/BROWSER_TEST_PASSWORD. A auditoria publica continua; o login permanece pendente.`);
  process.exitCode = 1;
});
