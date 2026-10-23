import { randomBytes } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

export const BROWSER_TEST_ACCOUNT_UID = 'frocia-maintenance-browser-test';
const TEST_ACCOUNT_CLAIM = 'frociaMaintenanceTest';

type AccountAuth = Pick<Auth, 'getUser' | 'createUser' | 'updateUser' | 'deleteUser' | 'setCustomUserClaims' | 'revokeRefreshTokens'>;

/** Conta exclusiva da auditoria. Nunca redefine a senha de uma conta pessoal. */
export async function prepareBrowserTestAccount(input: {
  auth: AccountAuth; db: Pick<Firestore, 'collection'>; projectId: string;
  configuredUser?: string; configuredPassword?: string; automaticEnabled?: boolean;
}): Promise<{ user: string; password: string; mode: 'configured' | 'automatic'; uid?: string }> {
  const configuredUser = input.configuredUser?.trim();
  const configuredPassword = input.configuredPassword;
  if (configuredUser || configuredPassword) {
    if (!configuredUser || !configuredPassword || /[\r\n]/.test(configuredUser + configuredPassword)) {
      throw new Error('Configure BROWSER_TEST_USER e BROWSER_TEST_PASSWORD juntos, sem quebras de linha.');
    }
    return { user: configuredUser, password: configuredPassword, mode: 'configured' };
  }
  if (input.automaticEnabled === false) throw new Error('Conta E2E ausente e provisionamento automatico pausado.');
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(input.projectId)) throw new Error('Projeto Firebase invalido para a conta E2E.');

  const uid = BROWSER_TEST_ACCOUNT_UID;
  const email = `${uid}@${input.projectId}.firebaseapp.com`;
  const profile = await input.db.collection('users').doc(uid).get();
  if (profile.exists && profile.data()?.role === 'admin') throw new Error('A conta E2E esta com privilegios administrativos; provisionamento interrompido.');
  let account: Awaited<ReturnType<Auth['getUser']>> | undefined;
  try { account = await input.auth.getUser(uid); }
  catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error; }

  if (account && (account.customClaims?.[TEST_ACCOUNT_CLAIM] !== true || account.email !== email ||
      account.disabled || account.customClaims?.admin === true || account.customClaims?.role === 'admin' ||
      account.customClaims?.tenantId || account.customClaims?.companyId || account.customClaims?.organizationId)) {
    throw new Error('O UID E2E pertence a uma conta desativada, privilegiada ou sem a marca da auditoria. Nenhuma senha foi alterada.');
  }
  if (!account && profile.exists) throw new Error('Ja existe perfil sem a conta E2E correspondente. Provisionamento interrompido.');

  const password = `${randomBytes(32).toString('base64url')}Aa9!`;
  if (account) {
    await input.auth.updateUser(uid, { password });
    await input.auth.revokeRefreshTokens(uid);
  } else {
    await input.auth.createUser({ uid, email, password, displayName: 'Auditoria Froc.IA', emailVerified: false });
    try { await input.auth.setCustomUserClaims(uid, { [TEST_ACCOUNT_CLAIM]: true, role: 'user' }); }
    catch (error) { await input.auth.deleteUser(uid); throw error; }
  }
  return { user: email, password, mode: 'automatic', uid };
}
