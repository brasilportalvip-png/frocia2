import { pathToFileURL } from 'node:url';

export function describeSelfEvolutionAuth(environment) {
  const has = name => typeof environment[name] === 'string' && environment[name].trim().length > 0;
  const explicitCI = environment.SELF_EVOLUTION_CI_DISPATCH_REQUIRED === 'true';
  // A prioridade é a mesma de GithubAutomationService.resolveCredential.
  const source = has('GITHUB_TOKEN') ? explicitCI ? 'github_actions_token' : 'configured_token'
    : has('GITHUB_APP_TOKEN') ? 'github_app_token'
      : has('GITHUB_APP_ID') && has('GITHUB_APP_PRIVATE_KEY') ? 'github_app' : 'not_configured';
  return {
    source, explicitCI,
    appIdConfigured: has('GITHUB_APP_ID'), privateKeyConfigured: has('GITHUB_APP_PRIVATE_KEY'),
    message: source === 'github_actions_token'
      ? 'Este executor usa o GITHUB_TOKEN padrão. O CI explícito continua disponível; o PR nativo pode exibir Action required. O GitHub App configurado na Vercel não é compartilhado automaticamente com Actions.'
      : source === 'not_configured' ? 'Nenhuma credencial de manutenção foi confirmada neste ambiente.'
        : 'Credencial própria configurada no executor. O resultado das operações reais confirma suas permissões.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('[self-evolution-auth]', JSON.stringify(describeSelfEvolutionAuth(process.env)));
}
