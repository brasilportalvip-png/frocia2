import { describe, expect, it, vi } from 'vitest';
import { BROWSER_TEST_ACCOUNT_UID, prepareBrowserTestAccount } from '../server/selfEvolution/browserTestAccountService.js';

function setup(account?: Record<string, unknown>, profile?: Record<string, unknown>) {
  const auth = {
    getUser: account ? vi.fn().mockResolvedValue(account) : vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
    createUser: vi.fn().mockResolvedValue({ uid: BROWSER_TEST_ACCOUNT_UID }),
    updateUser: vi.fn().mockResolvedValue({ uid: BROWSER_TEST_ACCOUNT_UID }),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
    revokeRefreshTokens: vi.fn().mockResolvedValue(undefined),
  };
  const db = { collection: vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({ exists: Boolean(profile), data: () => profile }),
  }) }) };
  return { auth, db, projectId: 'frocia-e07a5' };
}

const ownedAccount = {
  email: `${BROWSER_TEST_ACCOUNT_UID}@frocia-e07a5.firebaseapp.com`, disabled: false,
  customClaims: { frociaMaintenanceTest: true, role: 'user' },
};

describe('Conta dedicada para a auditoria autenticada', () => {
  it('cria uma unica conta normal, sem marcar e-mail ficticiamente como verificado', async () => {
    const deps = setup();
    const result = await prepareBrowserTestAccount(deps as any);
    expect(result).toMatchObject({ uid: BROWSER_TEST_ACCOUNT_UID, mode: 'automatic' });
    expect(result.password.length).toBeGreaterThanOrEqual(40);
    expect(deps.auth.createUser).toHaveBeenCalledWith(expect.objectContaining({
      uid: BROWSER_TEST_ACCOUNT_UID, email: ownedAccount.email, emailVerified: false, password: result.password,
    }));
    expect(deps.auth.setCustomUserClaims).toHaveBeenCalledWith(BROWSER_TEST_ACCOUNT_UID, {
      frociaMaintenanceTest: true, role: 'user',
    });
    expect(deps.auth.updateUser).not.toHaveBeenCalled();
  });

  it('reutiliza o UID de teste com senha nova e revoga sessoes antigas', async () => {
    const deps = setup(ownedAccount, { role: 'user' });
    const first = await prepareBrowserTestAccount(deps as any);
    const second = await prepareBrowserTestAccount(deps as any);
    expect(first.password).not.toBe(second.password);
    expect(deps.auth.updateUser).toHaveBeenCalledTimes(2);
    expect(deps.auth.revokeRefreshTokens).toHaveBeenCalledWith(BROWSER_TEST_ACCOUNT_UID);
    expect(deps.auth.createUser).not.toHaveBeenCalled();
  });

  it.each([
    { ...ownedAccount, customClaims: {} },
    { ...ownedAccount, disabled: true },
    { ...ownedAccount, email: 'outra-conta@example.com' },
    { ...ownedAccount, customClaims: { ...ownedAccount.customClaims, admin: true } },
    { ...ownedAccount, customClaims: { ...ownedAccount.customClaims, tenantId: 'empresa-real' } },
  ])('nao assume nem redefine uma conta pessoal, desativada ou privilegiada %#', async account => {
    const deps = setup(account);
    await expect(prepareBrowserTestAccount(deps as any)).rejects.toThrow('Nenhuma senha foi alterada');
    expect(deps.auth.updateUser).not.toHaveBeenCalled();
    expect(deps.auth.deleteUser).not.toHaveBeenCalled();
  });

  it('respeita administracao definida no perfil do Firestore', async () => {
    const deps = setup(ownedAccount, { role: 'admin' });
    await expect(prepareBrowserTestAccount(deps as any)).rejects.toThrow('administrativos');
    expect(deps.auth.updateUser).not.toHaveBeenCalled();
  });

  it('nao recria uma identidade sobre um perfil orfao existente', async () => {
    const deps = setup(undefined, { role: 'user' });
    await expect(prepareBrowserTestAccount(deps as any)).rejects.toThrow('perfil sem a conta');
    expect(deps.auth.createUser).not.toHaveBeenCalled();
  });

  it('preserva credenciais ja configuradas sem consultar ou modificar contas', async () => {
    const deps = setup();
    const result = await prepareBrowserTestAccount({ ...deps, configuredUser: 'teste@example.com', configuredPassword: 'senha-configurada' } as any);
    expect(result).toEqual({ mode: 'configured', user: 'teste@example.com', password: 'senha-configurada' });
    expect(deps.auth.getUser).not.toHaveBeenCalled();
    expect(deps.db.collection).not.toHaveBeenCalled();
  });

  it('nao mistura configuracao parcial com uma conta automatica', async () => {
    const deps = setup();
    await expect(prepareBrowserTestAccount({ ...deps, configuredUser: 'teste@example.com' } as any)).rejects.toThrow('juntos');
    expect(deps.auth.createUser).not.toHaveBeenCalled();
  });

  it('respeita a pausa do provisionamento automatico', async () => {
    const deps = setup();
    await expect(prepareBrowserTestAccount({ ...deps, automaticEnabled: false } as any)).rejects.toThrow('pausado');
    expect(deps.auth.getUser).not.toHaveBeenCalled();
  });

  it('interrompe falhas de permissao sem tentar criar outro usuario', async () => {
    const deps = setup();
    deps.auth.getUser.mockRejectedValue({ code: 'auth/insufficient-permission' });
    await expect(prepareBrowserTestAccount(deps as any)).rejects.toMatchObject({ code: 'auth/insufficient-permission' });
    expect(deps.auth.createUser).not.toHaveBeenCalled();
  });

  it('remove somente a conta recem-criada se a marca de propriedade falhar', async () => {
    const deps = setup();
    deps.auth.setCustomUserClaims.mockRejectedValue(new Error('claims_failed'));
    await expect(prepareBrowserTestAccount(deps as any)).rejects.toThrow('claims_failed');
    expect(deps.auth.deleteUser).toHaveBeenCalledExactlyOnceWith(BROWSER_TEST_ACCOUNT_UID);
  });
});
