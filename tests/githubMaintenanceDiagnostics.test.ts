import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAppService } from '../server/services/githubAppService.js';
import { GithubAutomationService } from '../server/selfEvolution/githubAutomationService.js';
import { formatGithubFailure, inspectGithubFailure } from '../server/services/githubApiDiagnostics.js';
import { formatSelfSiteControlReceipt } from '../server/ai/selfSiteChatControlService.js';

describe('Credencial efetiva e motivo verificavel do bloqueio GitHub', () => {
  beforeEach(() => {
    for (const key of ['GITHUB_TOKEN', 'GITHUB_APP_TOKEN', 'GITHUB_APP_PRIVATE_KEY']) vi.stubEnv(key, '');
    vi.stubEnv('GITHUB_OWNER', 'brasilportalvip-png'); vi.stubEnv('GITHUB_REPO', 'frocia2');
    vi.stubEnv('GITHUB_BASE_BRANCH', 'main');
    vi.spyOn(GithubAppService, 'isConfigured').mockReturnValue(true);
    vi.spyOn(GithubAppService, 'inspectRepositoryInstallation').mockResolvedValue({ installationId: 123, appId: 456, appSlug: 'app-real-da-vercel' });
    vi.spyOn(GithubAppService, 'installationToken').mockResolvedValue({ token: 'ghs_abcdefghijklmnopqrstuvwxyz',
      expiresAt: '2026-10-24T03:00:00Z', permissions: { actions: 'read', contents: 'write', pull_requests: 'write' } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state: 'active' })));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('identifica o App real da instalacao, sem confiar no slug declarado na variavel', async () => {
    vi.stubEnv('GITHUB_APP_SLUG', 'outro-app-que-o-dono-editou');
    const result = await GithubAutomationService.inspectMaintenanceConnection();
    expect(result).toMatchObject({ status: 'blocked', appSlug: 'app-real-da-vercel', appId: 456, installationId: 123,
      credentialEnvironment: 'GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY', permissions: { actions: 'read', contents: 'write', pull_requests: 'write' } });
    expect(JSON.stringify(result)).not.toContain('ghs_');
    expect(JSON.stringify(result)).not.toContain('outro-app-que-o-dono-editou');
  });

  it.each(['read', undefined])('preserva a fila e explica Actions:%s sem disparar com permissao insuficiente', async actions => {
    vi.mocked(GithubAppService.installationToken).mockResolvedValue({ token: 'private-installation-token', expiresAt: '',
      permissions: actions ? { actions } : {} });
    const result = await GithubAutomationService.dispatchSelfMaintenance();
    expect(result).toMatchObject({ success: false, diagnostic: { installationId: 123, appId: 456, code: 'chat_actions_write_missing' } });
    expect(result.message).toContain('Actions:write');
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private-installation-token');
  });

  it('solicita o workflow quando a instalacao renovada concede Actions:write', async () => {
    vi.mocked(GithubAppService.installationToken).mockResolvedValue({ token: 'fresh-app-token', expiresAt: '', permissions: { actions: 'write' } });
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    expect(await GithubAutomationService.dispatchSelfMaintenance()).toMatchObject({ success: true, diagnostic: { appId: 456, httpStatus: 204 } });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/self-evolution-runner.yml/dispatches'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ref: 'main' }) }));
  });

  it('mostra que GITHUB_TOKEN tem prioridade sobre o App alterado e nao troca credenciais apos 403', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'static-private-token');
    const connection = await GithubAutomationService.inspectMaintenanceConnection();
    expect(connection).toMatchObject({ credential: 'token', credentialEnvironment: 'GITHUB_TOKEN', actionsWrite: 'not_verified' });
    expect(connection.selectionNotice).toContain('antes do GitHub App');
    vi.mocked(fetch).mockResolvedValue(Response.json({ message: 'Resource not accessible by integration' }, {
      status: 403, headers: { 'X-Accepted-GitHub-Permissions': 'actions=write', 'X-GitHub-Request-Id': '1234:ABCD' },
    }));
    const dispatch = await GithubAutomationService.dispatchSelfMaintenance();
    expect(dispatch).toMatchObject({ success: false, diagnostic: { credentialEnvironment: 'GITHUB_TOKEN',
      httpStatus: 403, requiredPermissions: 'actions=write', requestId: '1234:ABCD' } });
    expect(dispatch.message).toContain('Resource not accessible by integration');
    expect(GithubAppService.installationToken).not.toHaveBeenCalled();
    expect(JSON.stringify(dispatch)).not.toContain('static-private-token');
  });

  it('usa GITHUB_APP_TOKEN quando GITHUB_TOKEN contem apenas espacos', async () => {
    vi.stubEnv('GITHUB_TOKEN', '  '); vi.stubEnv('GITHUB_APP_TOKEN', 'the-static-app-token');
    expect(await GithubAutomationService.inspectMaintenanceConnection()).toMatchObject({ credentialEnvironment: 'GITHUB_APP_TOKEN' });
    expect(GithubAppService.installationToken).not.toHaveBeenCalled();
  });

  it('distingue workflow desativado de Actions:write concedido', async () => {
    vi.mocked(GithubAppService.installationToken).mockResolvedValue({ token: 'app-token', expiresAt: '', permissions: { actions: 'write' } });
    vi.mocked(fetch).mockResolvedValue(Response.json({ state: 'disabled_manually' }));
    const result = await GithubAutomationService.inspectMaintenanceConnection();
    expect(result).toMatchObject({ status: 'blocked', code: 'chat_workflow_inactive', actionsWrite: 'granted' });
    expect(result.message).toContain('disabled_manually');
  });

  it('conserva somente campos permitidos do erro e oculta tokens, JWT e chave privada', async () => {
    const activeToken = 'installation-secret-arbitrary';
    vi.stubEnv('GITHUB_TOKEN', 'configured-secret-arbitrary');
    const secret = '-----BEGIN PRIVATE KEY-----\nsecret-key-data\n-----END PRIVATE KEY-----';
    const response = Response.json({ message: `Erro ${activeToken} configured-secret-arbitrary ghs_abcdefghijklmnopqrstuvwxyz ${secret}`,
      token: 'must-never-be-returned', errors: [{ privateKey: secret }] }, {
      status: 403, headers: { 'X-GitHub-Request-Id': 'AAAA:1234', 'X-Accepted-GitHub-Permissions': 'actions=write',
        'X-RateLimit-Remaining': '0', 'Retry-After': '60', 'Authorization': 'private-header' },
    });
    const diagnostic = await inspectGithubFailure(response, [activeToken]);
    expect(diagnostic).toMatchObject({ httpStatus: 403, requestId: 'AAAA:1234', requiredPermissions: 'actions=write', rateLimitRemaining: 0, retryAfterSeconds: 60 });
    const serialized = JSON.stringify(diagnostic);
    for (const value of [activeToken, 'configured-secret-arbitrary', 'ghs_', 'secret-key-data', 'must-never-be-returned', 'private-header']) expect(serialized).not.toContain(value);
    expect(formatGithubFailure('Falha', diagnostic)).toContain('limite de requisicoes');
  });

  it('preserva o codigo HTTP em erros vazios ou HTML e ignora cabecalhos inesperados', async () => {
    expect(await inspectGithubFailure(new Response('<html>private error</html>', { status: 502, headers: {
      'X-GitHub-Request-Id': 'unexpected secret', 'X-Accepted-GitHub-Permissions': 'invalid-private-value',
    } }))).toEqual({ httpStatus: 502 });
  });

  it('o recibo mostra identidade e data do erro antigo; habilitar nao esconde falha do dispatch', async () => {
    const connection = await GithubAutomationService.inspectMaintenanceConnection();
    const receipt = formatSelfSiteControlReceipt({ status: 'checked', connection, action: { status: 'enabled',
      dispatch: { success: false, message: 'GitHub recusou iniciar: HTTP 403.' } },
      operations: { lastRunner: { state: 'patch_created', recordedAt: '2026-10-23T23:36:04.051Z', message: 'Erro anterior.' } } });
    for (const part of ['app-real-da-vercel', 'ID 456', 'instalacao 123', 'actions=read', '2026-10-23T23:36:04.051Z', 'HTTP 403']) expect(receipt).toContain(part);
    expect(receipt).not.toContain('ghs_');
  });
});
