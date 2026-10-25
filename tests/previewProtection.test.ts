import { describe, expect, it, vi } from 'vitest';
import { previewProtectionHeaders, installPreviewProtection } from '../worker/preview-protection.mjs';
const target = 'https://frocia2-test-brasilportalvip-4274s-projects.vercel.app/';
const secret = 'automation-test-secret';
describe('credencial do preview limitada à origem autorizada', () => {
  it('envia cabeçalho somente ao preview do próprio projeto', () => {
    expect(previewProtectionHeaders(target + 'api/health', target, {}, secret)).toEqual({ 'x-vercel-protection-bypass': secret });
    for (const url of ['https://vercel.com/sso-api', 'https://other.vercel.app/', 'https://example.com/'])
      expect(previewProtectionHeaders(url, target, { 'X-Vercel-Protection-Bypass': secret, accept: 'text/html' }, secret)).toEqual({ accept: 'text/html' });
    expect(previewProtectionHeaders('https://other.vercel.app/', 'https://other.vercel.app/', {}, secret)).toEqual({});
  });
  it('mantém o navegador original quando não há segredo configurado', async () => {
    const context = { route: vi.fn() };
    await installPreviewProtection(context, target, '');
    expect(context.route).not.toHaveBeenCalled();
  });
  it('não interfere no navegador de produção quando o segredo existe', async () => {
    const context = { route: vi.fn() };
    await installPreviewProtection(context, 'https://frocia2.vercel.app/', secret);
    expect(context.route).not.toHaveBeenCalled();
    expect(previewProtectionHeaders('https://frocia2.vercel.app/api/health', 'https://frocia2.vercel.app/', {}, secret)).toEqual({});
  });
  it('não instala credencial em alvo fora do próprio projeto', async () => {
    await expect(installPreviewProtection({ route: vi.fn() }, 'https://other.vercel.app/', secret)).rejects.toThrow('target_not_allowed');
  });
  it('não segue redirects com o segredo e remove cabeçalhos de destinos externos', async () => {
    let handler: any;
    await installPreviewProtection({ route: async (_pattern: string, cb: any) => { handler = cb; } }, target, secret);
    const response = { status: () => 302 };
    const route = { request: () => ({ url: () => target, headers: () => ({}) }), fetch: vi.fn(async () => response), fulfill: vi.fn(), continue: vi.fn() };
    await handler(route);
    expect(route.fetch).toHaveBeenCalledWith({ headers: { 'x-vercel-protection-bypass': secret }, maxRedirects: 0 });
    expect(route.fulfill).toHaveBeenCalledWith({ response });
    const external = { ...route, request: () => ({ url: () => 'https://vercel.com/sso-api', headers: () => ({ 'x-vercel-protection-bypass': secret }) }), fetch: vi.fn(), continue: vi.fn() };
    await handler(external);
    expect(external.fetch).not.toHaveBeenCalled();
    expect(external.continue).toHaveBeenCalledWith({ headers: {} });
  });
});
