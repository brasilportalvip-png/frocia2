import { describe, expect, it, vi } from 'vitest';
import { describeSelfEvolutionAuth } from '../scripts/self-evolution-auth-diagnostics.mjs';

describe('Diagnóstico da credencial que o executor realmente seleciona', () => {
  it('identifica o token padrão sem declarar que o App da Vercel está em uso', () => {
    expect(describeSelfEvolutionAuth({ GITHUB_TOKEN: 'private-actions-token', SELF_EVOLUTION_CI_DISPATCH_REQUIRED: 'true' }))
      .toMatchObject({ source: 'github_actions_token', explicitCI: true, appIdConfigured: false, privateKeyConfigured: false });
  });
  it.each([
    [{ GITHUB_TOKEN: 'private-pat', SELF_EVOLUTION_CI_DISPATCH_REQUIRED: 'false' }, 'configured_token'],
    [{ GITHUB_APP_TOKEN: 'private-app-token' }, 'github_app_token'],
    [{ GITHUB_APP_ID: 'app-id', GITHUB_APP_PRIVATE_KEY: 'private-app-key', GITHUB_APP_SLUG: 'app-slug' }, 'github_app'],
    [{ GITHUB_APP_ID: 'app-id' }, 'not_configured'],
  ])('classifica presença e prioridade sem realizar autenticação externa: %s', (environment, source) => {
    expect(describeSelfEvolutionAuth(environment).source).toBe(source);
  });
  it('reproduz a falta do slug da rodada 93 sem apresentar a configuracao como pronta', () => {
    expect(describeSelfEvolutionAuth({ GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: 'fixture-key' }))
      .toMatchObject({ source: 'not_configured', appSlugConfigured: false, missingAppFields: ['GITHUB_APP_SLUG'],
        message: expect.stringContaining('GITHUB_APP_SLUG') });
  });
  it('não imprime valores, não cobra e não chama redes ou provedores', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const diagnostic = JSON.stringify(describeSelfEvolutionAuth({
      GITHUB_TOKEN: 'sensitive-token-value', GITHUB_APP_TOKEN: 'sensitive-app-token',
      GITHUB_APP_ID: 'sensitive-identifier', GITHUB_APP_PRIVATE_KEY: 'sensitive-private-key',
    }));
    for (const value of ['sensitive-token-value', 'sensitive-app-token', 'sensitive-identifier', 'sensitive-private-key']) expect(diagnostic).not.toContain(value);
    expect(JSON.parse(diagnostic).source).toBe('configured_token');
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
});
